defmodule VibeGuru.Detector.RoutesTest do
  use ExUnit.Case, async: true

  alias VibeGuru.Detector.Routes

  # Fixtures are built on disk because the thing under test IS filesystem structure —
  # mocking it would test a mock. Each app is a throwaway tree in tmp.
  setup do
    root = Path.join(System.tmp_dir!(), "vg_routes_#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf(root) end)
    {:ok, root: root}
  end

  defp write(root, rel, content \\ "") do
    path = Path.join(root, rel)
    path |> Path.dirname() |> File.mkdir_p!()
    File.write!(path, content)
    path
  end

  defp paths(routes), do: Enum.map(routes, & &1.path)

  defp dynamic(routes), do: routes |> Enum.filter(& &1.dynamic) |> paths()

  # --- Next (app router) --------------------------------------------------

  describe "next app router" do
    test "maps page files to their directory path", %{root: root} do
      write(root, "app/page.tsx")
      write(root, "app/about/page.tsx")
      write(root, "app/blog/archive/page.jsx")

      assert paths(Routes.detect(:next, root)) == ["/", "/about", "/blog/archive"]
    end

    test "route groups organise files without appearing in the URL", %{root: root} do
      write(root, "app/(marketing)/pricing/page.tsx")
      write(root, "app/(app)/dashboard/page.tsx")

      assert paths(Routes.detect(:next, root)) == ["/dashboard", "/pricing"]
    end

    test "dynamic segments are reported but flagged", %{root: root} do
      write(root, "app/page.tsx")
      write(root, "app/users/[id]/page.tsx")
      write(root, "app/docs/[...slug]/page.tsx")

      routes = Routes.detect(:next, root)

      assert "/users/[id]" in paths(routes)
      assert dynamic(routes) == ["/docs/[...slug]", "/users/[id]"]
      refute "/" in dynamic(routes)
    end

    test "non-page files in the app directory are not routes", %{root: root} do
      write(root, "app/page.tsx")
      write(root, "app/layout.tsx")
      write(root, "app/globals.css")
      write(root, "app/components/Button.tsx")

      assert paths(Routes.detect(:next, root)) == ["/"]
    end

    test "finds the app directory under src/", %{root: root} do
      write(root, "src/app/page.tsx")
      write(root, "src/app/settings/page.tsx")

      assert paths(Routes.detect(:next, root)) == ["/", "/settings"]
    end
  end

  # --- Next (pages router) ------------------------------------------------

  describe "next pages router" do
    test "maps files to routes and collapses index", %{root: root} do
      write(root, "pages/index.tsx")
      write(root, "pages/about.tsx")
      write(root, "pages/blog/index.tsx")

      assert paths(Routes.detect(:next, root)) == ["/", "/about", "/blog"]
    end

    test "api handlers and framework specials are excluded", %{root: root} do
      write(root, "pages/index.tsx")
      write(root, "pages/_app.tsx")
      write(root, "pages/_document.tsx")
      write(root, "pages/api/users.ts")

      assert paths(Routes.detect(:next, root)) == ["/"]
    end

    test "an app mid-migration reports routes from both routers", %{root: root} do
      write(root, "pages/legacy.tsx")
      write(root, "app/modern/page.tsx")

      assert paths(Routes.detect(:next, root)) == ["/legacy", "/modern"]
    end
  end

  # --- SvelteKit / Nuxt ---------------------------------------------------

  describe "sveltekit" do
    test "maps +page.svelte to its directory", %{root: root} do
      write(root, "src/routes/+page.svelte")
      write(root, "src/routes/about/+page.svelte")
      write(root, "src/routes/blog/[slug]/+page.svelte")
      write(root, "src/routes/+layout.svelte")

      routes = Routes.detect(:sveltekit, root)

      assert paths(routes) == ["/", "/about", "/blog/[slug]"]
      assert dynamic(routes) == ["/blog/[slug]"]
    end
  end

  describe "nuxt" do
    test "maps .vue pages, collapsing index", %{root: root} do
      write(root, "pages/index.vue")
      write(root, "pages/contact.vue")
      write(root, "pages/users/[id].vue")

      routes = Routes.detect(:nuxt, root)

      assert paths(routes) == ["/", "/contact", "/users/[id]"]
      assert dynamic(routes) == ["/users/[id]"]
    end
  end

  # --- declarative routers ------------------------------------------------

  describe "react router" do
    test "reads paths out of JSX Route elements", %{root: root} do
      write(root, "src/App.jsx", """
      import { Routes, Route } from "react-router-dom";
      export default function App() {
        return (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/users/:id" element={<User />} />
          </Routes>
        );
      }
      """)

      routes = Routes.detect(:react_router, root)

      assert paths(routes) == ["/", "/checkout", "/users/:id"]
      assert dynamic(routes) == ["/users/:id"]
    end

    test "reads paths out of createBrowserRouter objects", %{root: root} do
      write(root, "src/router.ts", """
      import { createBrowserRouter } from "react-router-dom";
      export const router = createBrowserRouter([
        { path: "/", element: <Root /> },
        { path: "/settings", element: <Settings /> },
      ]);
      """)

      assert paths(Routes.detect(:react_router, root)) == ["/", "/settings"]
    end

    test "files that do not import the router are ignored", %{root: root} do
      # `path:` is everywhere — build config, aliases, test fixtures. Inventing a
      # route from one is worse than missing a real route, because a fabricated
      # route shows up in the coverage report as a gap that can never be closed.
      write(root, "src/vite.config.ts", """
      export default { resolve: { alias: { path: "/src/utils" } } };
      """)

      write(root, "src/api.ts", """
      const endpoint = { path: "/v1/users" };
      """)

      assert Routes.detect(:react_router, root) == []
    end

    test "duplicate paths across files collapse to one route", %{root: root} do
      write(root, "src/a.jsx", ~s|import "react-router-dom";\n<Route path="/shared" />|)
      write(root, "src/b.jsx", ~s|import "react-router-dom";\n<Route path="/shared" />|)

      assert paths(Routes.detect(:react_router, root)) == ["/shared"]
    end
  end

  describe "vue router" do
    test "reads paths from the routes array", %{root: root} do
      write(root, "src/router/index.js", """
      import { createRouter } from "vue-router";
      const routes = [
        { path: "/", component: Home },
        { path: "/products/:sku", component: Product },
      ];
      """)

      routes = Routes.detect(:vue_router, root)

      assert paths(routes) == ["/", "/products/:sku"]
      assert dynamic(routes) == ["/products/:sku"]
    end
  end

  # --- guards -------------------------------------------------------------

  describe "when routes cannot be read" do
    test "an unsupported or absent router yields an empty list", %{root: root} do
      write(root, "src/App.jsx", ~s|<Route path="/x" />|)

      assert Routes.detect(nil, root) == []
      assert Routes.detect(:some_future_router, root) == []
    end

    test "a missing or nil root does not crash", %{root: _root} do
      assert Routes.detect(:next, nil) == []
      assert Routes.detect(:next, "/definitely/not/here") == []
    end

    test "node_modules is never walked", %{root: root} do
      # A dependency's own routes are not this app's routes, and walking
      # node_modules on a real project is tens of thousands of files.
      write(root, "src/App.jsx", ~s|import "react-router-dom";\n<Route path="/mine" />|)

      write(root, "node_modules/some-lib/src/App.jsx", """
      import "react-router-dom";
      <Route path="/theirs" />
      """)

      assert paths(Routes.detect(:react_router, root)) == ["/mine"]
    end
  end
end
