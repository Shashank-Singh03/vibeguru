"use strict";

// crawl.js decides what gets looked at, and the coverage number is only honest if
// this file is. Two properties matter more than any individual behaviour:
//
//   1. Navigation is client-side ONLY. A page.goto() reloads the document and resets
//      the JS heap, so leaks never accumulate and every app falsely passes. That is
//      the single most destructive regression available in this codebase, and it
//      would be completely invisible — the run still produces samples, findings, and
//      a confident clean result.
//   2. A route that could not be reached is never counted as reached. The whole point
//      of coverage is that silence means something.

const test = require("node:test");
const assert = require("node:assert/strict");

const { fakePage } = require("./helpers/fake-page");

const load = () => import("../driver-node/lib/crawl.js");

const declared = (...paths) =>
  paths.map((p) => (typeof p === "string" ? { path: p, dynamic: false } : p));

const cfg = (over = {}) => ({ routesLimit: 12, declaredRoutes: [], routeParams: {}, ...over });

const paths = (routes) => routes.map((r) => r.path);
const reasons = (skipped) => Object.fromEntries(skipped.map((s) => [s.path, s.reason]));

// --- the invariant --------------------------------------------------------

test("navigation never reloads the document", async () => {
  // If this ever fails, every memory finding in the product silently becomes wrong.
  const { visitRoute } = await load();

  const viaLink = fakePage({ links: [{ path: "/a", hrefAttr: "/a" }] });
  await visitRoute(viaLink, { path: "/a", hrefAttr: "/a" }, 0);

  const viaHistory = fakePage();
  await visitRoute(viaHistory, { path: "/b", hrefAttr: null }, 0);

  const afterFailedClick = fakePage({ clickFails: true });
  await visitRoute(afterFailedClick, { path: "/c", hrefAttr: "/c" }, 0);

  for (const [name, page] of [
    ["link click", viaLink],
    ["history fallback", viaHistory],
    ["recovery from a failed click", afterFailedClick],
  ]) {
    assert.equal(page.calls.goto, 0, `${name} must not call page.goto — it resets the heap`);
  }
});

// --- planning -------------------------------------------------------------

test("declared routes lead, and discovered extras follow", async () => {
  const { plan } = await load();
  const page = fakePage({
    links: [
      { path: "/about", hrefAttr: "/about" },
      { path: "/surprise", hrefAttr: "/surprise" },
    ],
  });

  const { routes, declaredCount, discoveredCount } = await plan(
    page,
    cfg({ declaredRoutes: declared("/", "/about") })
  );

  assert.deepEqual(paths(routes), ["/", "/about", "/surprise"]);
  assert.equal(declaredCount, 2);
  assert.equal(discoveredCount, 2);
});

test("a declared route reuses the app's own link when one exists", async () => {
  // Clicking the real link exercises the app's navigation; pushing history does not.
  const { plan } = await load();
  const page = fakePage({ links: [{ path: "/about", hrefAttr: "/about?ref=nav" }] });

  const { routes } = await plan(page, cfg({ declaredRoutes: declared("/about", "/hidden") }));

  assert.equal(routes.find((r) => r.path === "/about").hrefAttr, "/about?ref=nav");
  assert.equal(routes.find((r) => r.path === "/hidden").hrefAttr, null, "no link, so history nav");
});

test("a route is planned once even when declared and discovered", async () => {
  const { plan } = await load();
  const page = fakePage({ links: [{ path: "/dup", hrefAttr: "/dup" }] });

  const { routes } = await plan(page, cfg({ declaredRoutes: declared("/dup") }));

  assert.deepEqual(paths(routes), ["/dup"]);
});

test("dynamic segments are filled from config, not invented", async () => {
  const { plan } = await load();
  const page = fakePage();

  const { routes, skipped } = await plan(
    page,
    cfg({
      declaredRoutes: declared({ path: "/users/[id]", dynamic: true }),
      routeParams: { id: "42" },
    })
  );

  assert.deepEqual(paths(routes), ["/users/42"]);
  assert.deepEqual(skipped, []);
});

test("an unfillable dynamic route is skipped, never guessed", async () => {
  // Visiting /users/[id] literally renders a 404 or an error boundary. Reporting
  // that page as healthy is worse than admitting the route was never seen.
  const { plan } = await load();

  const { routes, skipped } = await plan(
    fakePage(),
    cfg({ declaredRoutes: declared({ path: "/users/[id]", dynamic: true }) })
  );

  assert.deepEqual(routes, []);
  assert.equal(reasons(skipped)["/users/[id]"], "dynamic");
  assert.match(skipped[0].detail, /id/, "should name which parameter is missing");
});

test("every dynamic syntax is recognised", async () => {
  const { plan } = await load();

  const { routes } = await plan(
    fakePage(),
    cfg({
      declaredRoutes: declared(
        { path: "/a/[id]", dynamic: true }, // Next, SvelteKit, Nuxt 3
        { path: "/b/:id", dynamic: true }, // React Router, Vue Router
        { path: "/c/[...rest]", dynamic: true } // catch-all
      ),
      routeParams: { id: "1", rest: "x" },
    })
  );

  assert.deepEqual(paths(routes), ["/a/1", "/b/1", "/c/x"]);
});

test("routes past the limit are reported, not silently dropped", async () => {
  const { plan } = await load();

  const { routes, skipped } = await plan(
    fakePage(),
    cfg({ routesLimit: 2, declaredRoutes: declared("/a", "/b", "/c", "/d") })
  );

  assert.deepEqual(paths(routes), ["/a", "/b"]);
  assert.deepEqual(reasons(skipped), { "/c": "over_limit", "/d": "over_limit" });
});

test("an app with nothing declared and nothing linked plans nothing", async () => {
  const { plan } = await load();
  const { routes, skipped } = await plan(fakePage(), cfg());

  assert.deepEqual(routes, []);
  assert.deepEqual(skipped, []);
});

// --- visiting -------------------------------------------------------------

test("a route with a link is entered by clicking it", async () => {
  const { visitRoute } = await load();
  const page = fakePage({ links: [{ path: "/a", hrefAttr: "/a" }] });

  const result = await visitRoute(page, { path: "/a", hrefAttr: "/a" }, 0);

  assert.equal(result.ok, true);
  assert.equal(page.calls.clicks.length, 1);
  assert.equal(page.calls.pushes.length, 0, "no need for history when a link exists");
});

test("a route with no link is entered by pushing history", async () => {
  const { visitRoute } = await load();
  const page = fakePage();

  const result = await visitRoute(page, { path: "/hidden", hrefAttr: null }, 0);

  assert.equal(result.ok, true);
  assert.deepEqual(page.calls.pushes, ["/hidden"]);
});

test("a link that cannot be clicked falls back rather than giving up", async () => {
  // Links vanish: a nav collapses, a component unmounts, the view changes.
  const { visitRoute } = await load();
  const page = fakePage({ clickFails: true });

  const result = await visitRoute(page, { path: "/a", hrefAttr: "/a" }, 0);

  assert.equal(result.ok, true);
  assert.equal(page.calls.clicks.length, 1, "it tried the link first");
  assert.deepEqual(page.calls.pushes, ["/a"], "then pushed history");
});

test("a redirect to a sign-in page is reported as an auth wall", async () => {
  // Naming this specifically is what turns "route not covered" into "run vibeguru
  // auth" — the reason and the fix are different from any other failure.
  const { visitRoute } = await load();

  for (const login of ["/login", "/signin", "/sign-in", "/auth/start", "/unauthorized"]) {
    const page = fakePage({ guard: { "/admin": login } });
    const result = await visitRoute(page, { path: "/admin", hrefAttr: null }, 0);

    assert.equal(result.ok, false, `${login} should not count as reached`);
    assert.equal(result.reason, "auth_required", `${login} should read as an auth wall`);
    assert.match(result.detail, new RegExp(login));
  }
});

test("a redirect somewhere unrelated is reported as a redirect, not an auth wall", async () => {
  const { visitRoute } = await load();
  const page = fakePage({ guard: { "/old": "/new-home" } });

  const result = await visitRoute(page, { path: "/old", hrefAttr: null }, 0);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "redirected");
  assert.match(result.detail, /new-home/);
});

test("a trailing slash is not treated as a different route", async () => {
  const { visitRoute } = await load();
  const page = fakePage();

  assert.equal((await visitRoute(page, { path: "/about/", hrefAttr: null }, 0)).ok, true);
});

test("the run returns home after a route, so the next one starts clean", async () => {
  const { visitRoute } = await load();
  const page = fakePage({ path: "/" });

  await visitRoute(page, { path: "/a", hrefAttr: null }, 0);

  assert.equal(page.calls.back, 1);
  assert.equal(page.current, "/", "attribution depends on every cycle starting from home");
});

test("it returns home even after failing to reach a route", async () => {
  // Otherwise one auth-walled route leaves the run stranded on /login and every
  // later measurement is attributed from the wrong place.
  const { visitRoute } = await load();
  const page = fakePage({ guard: { "/admin": "/login" } });

  const result = await visitRoute(page, { path: "/admin", hrefAttr: null }, 0);

  assert.equal(result.ok, false);
  assert.equal(page.calls.back, 1);
});

test("a page that cannot be evaluated is reported, not crashed on", async () => {
  const { visitRoute } = await load();
  const page = fakePage();
  page.evaluate = async () => {
    throw new Error("execution context destroyed");
  };

  const result = await visitRoute(page, { path: "/a", hrefAttr: null }, 0);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "navigation_failed");
});
