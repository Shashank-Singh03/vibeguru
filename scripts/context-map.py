"""Refresh the repository's static file index and context graph (stdlib only).

Run from any directory: python scripts/context-map.py
This inventories tracked and non-ignored source files without dependency trees or session files.
Relationships are static declarations/imports, not a complete runtime call graph.
"""

import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "context"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode("utf-8").strip()


def area(path):
    if path.startswith("dashboard/"):
        return "local-dashboard"
    if path.startswith("benchmarks/"):
        return "evaluation"
    if path.startswith("site/"):
        return "public-site"
    if path.startswith("examples/"):
        return "example-reports"
    if path.startswith("lib/vibe_guru/investigation"):
        return "investigation"
    if path.startswith("lib/"):
        return "elixir-engine"
    if path.startswith("driver-node/"):
        return "browser-driver"
    if path.startswith("mcp/"):
        return "mcp"
    if path.startswith(("bin/", "scripts/")):
        return "tooling-distribution"
    if path.startswith(("test/", "test-node/")):
        return "tests"
    if path.startswith("test-app/"):
        return "fixture-app"
    if path.startswith(".github/") or path == "Jenkinsfile":
        return "ci-release"
    if path.startswith("docs/") or path.endswith(".md"):
        return "documentation"
    return "root-config"


def main():
    paths = set(git("ls-files", "--cached", "--others", "--exclude-standard").splitlines())
    # Include the context pack before its first commit; never inspect arbitrary ignored files.
    paths.update(p.relative_to(ROOT).as_posix() for p in OUT.glob("*.md"))
    paths.update(["PROJECT_CONTEXT.md", "scripts/context-map.py"])
    paths.discard("docs/context/graph.json")
    paths.discard("docs/context/FILE_INDEX.md")
    files = []
    texts = {}
    for path in sorted(paths):
        file = ROOT / path
        if not file.is_file():
            continue
        raw = file.read_bytes()
        body = raw.decode("utf-8", errors="replace")
        texts[path] = body
        modules = re.findall(r"^defmodule\s+([\w.]+)", body, re.M)
        exports = re.findall(r"^\s*def\s+([\w?!]+)", body, re.M) if path.endswith((".ex", ".exs")) else re.findall(r"^export\s+(?:async\s+)?function\s+(\w+)", body, re.M)
        if path.endswith((".js", ".mjs")):
            exports += re.findall(r"module\.exports\s*=\s*\{([^}]+)\}", body)
        tests = len(re.findall(r'^\s*test\s+"|^\s*test\(', body, re.M)) if area(path) == "tests" else 0
        files.append({"id": path, "type": "file", "area": area(path), "bytes": len(raw), "lines": len(body.splitlines()), "sha256": hashlib.sha256(raw).hexdigest(), "modules": modules, "exports": sorted(set(exports)), "test_declarations": tests})

    edges = []
    for item in files:
        edges.append({"source": item["area"], "target": item["id"], "relation": "contains", "basis": "path"})
    file_ids = {f["id"] for f in files}
    modules = {module: f["id"] for f in files for module in f["modules"]}
    for path, body in texts.items():
        if path.endswith((".js", ".mjs", ".jsx")):
            imports = re.findall(r'(?:from\s+|(?:require|import)\s*\(\s*)[\x22\x27]([^\x22\x27]+)[\x22\x27]', body)
            for spec in set(imports):
                if not spec.startswith("."):
                    continue
                candidate = (ROOT / path).parent / spec
                possibilities = [candidate, Path(str(candidate) + ".js"), candidate / "index.js"]
                for target in possibilities:
                    rel = target.resolve().relative_to(ROOT).as_posix()
                    if rel in file_ids:
                        edges.append({"source": path, "target": rel, "relation": "imports", "basis": "literal import/require"})
                        break
        if path.endswith((".ex", ".exs")):
            refs = set(re.findall(r"\bVibeGuru(?:\.[A-Z]\w*)+", body))
            for prefix, names in re.findall(r"alias\s+(VibeGuru(?:\.\w+)*)\.\{([^}]+)\}", body, re.S):
                refs.update(prefix + "." + n.strip() for n in names.split(","))
            for ref in refs:
                target = modules.get(ref)
                if target and target != path:
                    edges.append({"source": path, "target": target, "relation": "references_module", "basis": "static module/alias reference; may occur in docs/types"})

    architecture = [
        ("tooling-distribution", "local-dashboard", "serves localhost dashboard and discovers current test artifacts"),
        ("local-dashboard", "evaluation", "displays saved campaign outcomes, vector scope and evidence relationships"),
        ("tests", "local-dashboard", "validates collectors, event refresh, test recording and report access"),
        ("tooling-distribution", "elixir-engine", "launches packaged binary"),
        ("tooling-distribution", "mcp", "intercepts mcp command"),
        ("mcp", "elixir-engine", "spawns CLI and reads findings JSON"),
        ("elixir-engine", "browser-driver", "temp config + Node Port + NDJSON"),
        ("browser-driver", "fixture-app", "exercises via Playwright Chromium/CDP"),
        ("ci-release", "tests", "runs suites"),
        ("ci-release", "fixture-app", "runs browser fixtures"),
        ("investigation", "browser-driver", "focused snapshot via Driver; explicit invocation"),
        ("tests", "elixir-engine", "validates"),
        ("tests", "investigation", "validates with synthetic probe results"),
        ("tests", "browser-driver", "validates crawl/sampler/snapshot"),
        ("tests", "mcp", "validates rendering and real stdio protocol"),
        ("public-site", "example-reports", "links to the fixture demonstration report"),
        ("elixir-engine", "example-reports", "renders standalone HTML with evidence and local comparison"),
    ]
    edges += [{"source": a, "target": b, "relation": r, "basis": "manually verified architecture"} for a, b, r in architecture]
    areas = sorted({f["area"] for f in files})
    graph = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_commit": git("rev-parse", "HEAD"),
        "source_branch": git("branch", "--show-current"),
        "source_state": "working-tree",
        "contains_uncommitted_changes": bool(git("status", "--porcelain")),
        "scope": "Tracked and non-ignored repository source files; excludes vendor trees, local generated reports/binaries, and auth/session data. Public sample reports are explicitly included.",
        "limitations": ["Static import/module references can occur in documentation, types or tests; edges do not prove runtime invocation.", "No dynamic imports, resolved Elixir short aliases/call graph, or dependency internals are exhaustively analyzed.", "The standard Pipeline does not invoke Investigation; no edge asserts that it does.", "The generated graph and index exclude themselves to avoid recursive hashes."],
        "nodes": [{"id": a, "type": "subsystem"} for a in areas] + files,
        "edges": sorted(edges, key=lambda e: (e["source"], e["target"], e["relation"])),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "graph.json").write_text(json.dumps(graph, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    lines = ["# Repository file index", "", f"Generated from `{graph['source_branch']}` at `{graph['source_commit']}`.", "", "Refresh with `python scripts/context-map.py`. SHA-256 and static edges live in [graph.json](graph.json).", "", "This index covers repository-owned files. Dependencies, build output, session data, and generated analysis reports are excluded. Public names are a static inventory, not a full API specification."]
    for group in areas:
        lines += ["", f"## {group}", "", "| File | Lines | Module / public names | Test declarations |", "|---|---:|---|---:|"]
        for f in files:
            if f["area"] != group:
                continue
            detail = "; ".join(f["modules"] + f["exports"]).replace("|", "\\|") or "—"
            lines.append(f"| [{f['id']}](../../{f['id']}) | {f['lines']} | {detail} | {f['test_declarations'] or '—'} |")
    (OUT / "FILE_INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"files": len(files), "subsystems": len(areas), "edges": len(edges), "graph": str(OUT / "graph.json"), "index": str(OUT / "FILE_INDEX.md")}))


if __name__ == "__main__":
    main()
