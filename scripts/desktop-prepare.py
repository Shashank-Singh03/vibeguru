"""Copy explicitly selected local apps into an isolated evaluation directory.

No Git mutations, symlinks, dependency trees, environment files or browser sessions
are copied. Source hashes let a later check confirm the originals stayed unchanged.
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build", ".vibeguru", ".venv", "venv", "__pycache__", "coverage"}


def source_files(root):
    for current, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not Path(current, d).is_symlink()]
        for name in files:
            file = Path(current, name)
            if name.startswith(".env") or name.endswith((".pem", ".key")) or file.is_symlink():
                continue
            yield file, file.relative_to(root).as_posix()


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def main():
    mode, manifest_path = sys.argv[1:]
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    if mode == "verify":
        changes = []
        for app in manifest["apps"]:
            original = Path(app["source"])
            actual = {relative: digest(file) for file, relative in source_files(original)}
            if actual != app["source_hashes"]:
                changes.append(app["id"])
        print(json.dumps({"originals_unchanged": not changes, "changed": changes}))
        return 1 if changes else 0
    if mode != "prepare":
        raise ValueError("Expected prepare or verify")
    workspace = Path(manifest["workspace"]).resolve()
    if workspace.exists():
        raise ValueError("Use a new evaluation directory; existing output is never replaced")
    workspace.mkdir(parents=True)
    for app in manifest["apps"]:
        source = Path(app["source"]).resolve()
        destination = (workspace / app["id"]).resolve()
        if destination.parent != workspace or workspace.is_relative_to(source):
            raise ValueError("Unsafe evaluation path")
        app["snapshot"] = str(destination)
        app["source_hashes"] = {}
        for file, relative in source_files(source):
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
            app["source_hashes"][relative] = digest(file)
        print(json.dumps({"app": app["id"], "copied_files": len(app["source_hashes"])}))
    Path(manifest_path).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
