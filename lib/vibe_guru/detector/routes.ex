defmodule VibeGuru.Detector.Routes do
  @moduledoc """
  Reads an app's routes from its own source, rather than discovering them by crawling.

  Crawling can only find what is linked from the page it starts on, which on a real
  app is a small and unrepresentative slice: anything behind a login, behind a
  collapsed menu, or reachable only from a page two clicks in simply does not exist
  as far as the crawler is concerned. Worse, the tool could not tell that apart from
  an app with three routes — so it reported a confident all-clear having seen almost
  nothing.

  Frameworks already know their own routes, so we ask them. For file-system routers
  (Next, SvelteKit, Nuxt) the answer is exact and free — it is a directory listing.
  For declarative routers (React Router, Vue Router) routes are written down in
  source, and the common forms are recoverable without parsing JavaScript.

  This is the same kind of detection `VibeGuru.Detector` already does: file presence
  and structure, no code execution, no AI.

  ## What this deliberately does not do

  Dynamic segments (`/users/[id]`, `/post/:slug`) are reported but marked
  `dynamic: true`, because there is no way to know a valid id from the filesystem.
  A run either fills them from `config.route_params` or counts them as uncovered.
  Inventing `/users/1` and reporting the 404 page as healthy would be worse than
  admitting the gap.
  """

  @type route :: %{path: String.t(), dynamic: boolean(), source: atom()}

  # Page files for the file-system routers, by framework.
  @page_exts ~w(.js .jsx .ts .tsx)
  @next_app_page ~w(page.js page.jsx page.ts page.tsx)
  @sveltekit_page ~w(+page.svelte)

  # Files that live in a routes directory but are not routes.
  @next_pages_special ~w(_app _document _error middleware)

  @doc """
  Return the routes declared by the app at `root`, given the detected `router`.

  Always returns a list; an unknown or unsupported router yields `[]`, which callers
  must treat as "we could not read the routes", never as "this app has no routes".
  """
  @spec detect(atom(), String.t() | nil) :: [route()]
  def detect(_router, nil), do: []

  def detect(router, root) do
    if File.dir?(root), do: extract(router, root), else: []
  end

  defp extract(:next, root), do: next_routes(root)
  defp extract(:sveltekit, root), do: sveltekit_routes(root)
  defp extract(:nuxt, root), do: nuxt_routes(root)
  defp extract(:react_router, root), do: source_routes(root, ~w(react-router))
  defp extract(:vue_router, root), do: source_routes(root, ~w(vue-router))
  defp extract(_other, _root), do: []

  # --- file-system routers ------------------------------------------------

  # Next supports both routers, and apps mid-migration have both directories.
  defp next_routes(root) do
    app = first_existing(root, ["app", "src/app"])
    pages = first_existing(root, ["pages", "src/pages"])

    (next_app_routes(app) ++ next_pages_routes(pages))
    |> normalize()
  end

  defp next_app_routes(nil), do: []

  defp next_app_routes(dir) do
    dir
    |> walk()
    |> Enum.filter(&(Path.basename(&1) in @next_app_page))
    |> Enum.map(&(&1 |> Path.dirname() |> relative_to(dir) |> to_route(:filesystem)))
  end

  defp next_pages_routes(nil), do: []

  defp next_pages_routes(dir) do
    dir
    |> walk()
    |> Enum.filter(&page_file?/1)
    |> Enum.reject(&next_special?(&1, dir))
    |> Enum.map(&(&1 |> strip_ext() |> relative_to(dir) |> drop_index() |> to_route(:filesystem)))
  end

  defp next_special?(file, dir) do
    rel = relative_to(file, dir)
    base = file |> Path.basename() |> strip_ext()

    String.starts_with?(rel, "/api/") or base in @next_pages_special
  end

  defp sveltekit_routes(root) do
    case first_existing(root, ["src/routes"]) do
      nil ->
        []

      dir ->
        dir
        |> walk()
        |> Enum.filter(&(Path.basename(&1) in @sveltekit_page))
        |> Enum.map(&(&1 |> Path.dirname() |> relative_to(dir) |> to_route(:filesystem)))
        |> normalize()
    end
  end

  defp nuxt_routes(root) do
    case first_existing(root, ["pages", "src/pages", "app/pages"]) do
      nil ->
        []

      dir ->
        dir
        |> walk()
        |> Enum.filter(&(Path.extname(&1) == ".vue"))
        |> Enum.map(
          &(&1
            |> strip_ext()
            |> relative_to(dir)
            |> drop_index()
            |> to_route(:filesystem))
        )
        |> normalize()
    end
  end

  # --- declarative routers ------------------------------------------------

  # `<Route path="/x">` (JSX) and `{ path: "/x" }` (createBrowserRouter / Vue Router).
  @jsx_route ~r/<Route\b[^>]*?\bpath\s*=\s*\{?["'`]([^"'`]*)["'`]/
  @object_route ~r/\bpath\s*:\s*["'`]([^"'`]*)["'`]/

  # Only files that actually import the router are scanned. `path:` is a common key
  # in build config, aliases and test fixtures, so parsing every file would invent
  # routes that do not exist — and a fabricated route is worse than a missing one,
  # because it lands in the coverage report as a real gap.
  defp source_routes(root, router_packages) do
    root
    |> source_dirs()
    |> Enum.flat_map(&walk/1)
    |> Enum.filter(&source_file?/1)
    |> Enum.flat_map(&routes_in_file(&1, router_packages))
    |> normalize()
  end

  defp routes_in_file(file, router_packages) do
    case File.read(file) do
      {:ok, content} ->
        if imports_any?(content, router_packages) do
          paths =
            Regex.scan(@jsx_route, content, capture: :all_but_first) ++
              Regex.scan(@object_route, content, capture: :all_but_first)

          paths
          |> List.flatten()
          |> Enum.map(&to_route(&1, :source))
        else
          []
        end

      _ ->
        []
    end
  end

  defp imports_any?(content, packages) do
    Enum.any?(packages, fn pkg ->
      String.contains?(content, ~s("#{pkg}")) or String.contains?(content, ~s('#{pkg}')) or
        String.contains?(content, ~s("#{pkg}-dom")) or String.contains?(content, ~s('#{pkg}-dom'))
    end)
  end

  defp source_dirs(root) do
    ["src", "app", "pages", "routes"]
    |> Enum.map(&Path.join(root, &1))
    |> Enum.filter(&File.dir?/1)
    |> case do
      [] -> [root]
      dirs -> dirs
    end
  end

  defp source_file?(file), do: Path.extname(file) in (@page_exts ++ [".vue", ".svelte"])

  # --- shared helpers -----------------------------------------------------

  # Skip directories that are never app source. node_modules especially: walking it
  # on a real project is thousands of files and would find routes belonging to
  # dependencies, not the app.
  @skip_dirs ~w(node_modules .git .next .nuxt .svelte-kit dist build coverage out .vercel)

  defp walk(dir) do
    case File.ls(dir) do
      {:ok, entries} ->
        Enum.flat_map(entries, fn entry ->
          full = Path.join(dir, entry)

          cond do
            entry in @skip_dirs -> []
            File.dir?(full) -> walk(full)
            true -> [full]
          end
        end)

      _ ->
        []
    end
  end

  defp first_existing(root, candidates) do
    candidates
    |> Enum.map(&Path.join(root, &1))
    |> Enum.find(&File.dir?/1)
  end

  defp page_file?(file), do: Path.extname(file) in @page_exts

  defp strip_ext(file), do: Path.rootname(file)

  defp relative_to(path, base) do
    path
    |> Path.relative_to(base)
    |> case do
      "." -> "/"
      rel -> "/" <> String.replace(rel, "\\", "/")
    end
  end

  defp drop_index("/index"), do: "/"
  defp drop_index(path), do: String.replace_suffix(path, "/index", "")

  # Route groups — Next's `(marketing)` and SvelteKit's `(app)` — organise files
  # without appearing in the URL, so they are stripped rather than treated as segments.
  defp to_route(path, source) do
    cleaned =
      path
      |> String.split("/")
      |> Enum.reject(&(&1 =~ ~r/^\(.*\)$/))
      |> Enum.join("/")
      |> ensure_leading_slash()

    %{path: cleaned, dynamic: dynamic?(cleaned), source: source}
  end

  defp ensure_leading_slash(""), do: "/"
  defp ensure_leading_slash("/" <> _ = path), do: path
  defp ensure_leading_slash(path), do: "/" <> path

  # `[id]` / `[...slug]` (Next, SvelteKit, Nuxt 3), `:id` (React Router, Vue Router),
  # `_id` (Nuxt 2), and `*` catch-alls.
  defp dynamic?(path) do
    path =~ ~r/\[.*\]/ or path =~ ~r/(^|\/):[^\/]+/ or path =~ ~r/\*/ or path =~ ~r/(^|\/)_[^\/]+/
  end

  defp normalize(routes) do
    routes
    |> Enum.map(&%{&1 | path: trim_trailing_slash(&1.path)})
    |> Enum.reject(&(&1.path == ""))
    |> Enum.uniq_by(& &1.path)
    |> Enum.sort_by(& &1.path)
  end

  defp trim_trailing_slash("/"), do: "/"
  defp trim_trailing_slash(path), do: String.replace_suffix(path, "/", "")
end
