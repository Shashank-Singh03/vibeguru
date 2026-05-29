defmodule Vibecheck.Detector do
  @moduledoc """
  Orchestrates structural detection into a `Vibecheck.StackProfile`.

  Detection is **always best-effort and never blocks a run**: with only a URL and no
  local project we still return a usable profile (`surface: :unknown`) because the
  auto-crawl harness can drive any URL. Knowing the stack just lets probes tune
  themselves (e.g. enable the chart-leak signature, warn on missing source maps).
  """

  alias Vibecheck.{StackProfile, Detector}

  @doc """
  Build a profile from a target `url` and optional project `root`.

  When `root` is nil we try the current working directory; if there's no manifest
  there, detection returns `:unknown` values — that's fine.
  """
  @spec detect(String.t(), keyword()) :: StackProfile.t()
  def detect(url, opts \\ []) do
    root = resolve_root(Keyword.get(opts, :root))

    stack_info = Detector.Stack.detect(root)
    fe_info = Detector.Frontend.detect(stack_info, root)

    %StackProfile{
      root: root,
      url: url,
      surface: stack_info.surface,
      stack: stack_info.stack,
      bundler: stack_info.bundler,
      router: fe_info.router,
      chart_libs: fe_info.chart_libs,
      source_maps: fe_info.source_maps,
      meta: %{dep_count: map_size(stack_info.deps)}
    }
  end

  # Use given root if it has a package.json; else cwd if it has one; else nil.
  defp resolve_root(nil) do
    cwd = File.cwd!()
    if File.exists?(Path.join(cwd, "package.json")), do: cwd, else: nil
  end

  defp resolve_root(root) do
    if File.exists?(Path.join(root, "package.json")), do: root, else: root
  end
end
