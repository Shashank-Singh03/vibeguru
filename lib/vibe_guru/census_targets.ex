defmodule VibeGuru.CensusTargets do
  @moduledoc """
  Decides which classes are worth counting live instances of.

  Two sources, both deterministic:

    * **Universal** — built-ins that are created constantly and released rarely.
      An observer nobody disconnects or a socket nobody closes retains everything it
      closes over, and none of it shows up as a DOM node or an event listener, so the
      existing signatures are blind to it entirely.

    * **Library** — classes belonging to libraries the detector already found in
      `package.json`. If an app has no chart library there is no point asking the page
      about `Chart`, and asking anyway would be a round trip per sample for a
      guaranteed null.

  Counting is not free — each target costs a few CDP round trips per sample — so the
  list stays short and is derived from evidence rather than hopefully enumerated.
  """

  # Present in every browser, and leaked constantly. Each one retains its callback,
  # and through it whatever that closure captured.
  @universal ~w(
    MutationObserver
    ResizeObserver
    IntersectionObserver
    PerformanceObserver
    WebSocket
    EventSource
    Worker
  )

  # Library atom (as detected) => the classes worth counting for it. Only libraries
  # that expose a real constructor holding real memory are listed; a library whose API
  # is plain functions has nothing to count.
  @by_library %{
    chartjs: ~w(Chart),
    three: ~w(WebGLRenderer Scene Texture),
    echarts: ~w(ECharts)
  }

  # A hard ceiling, because this multiplies out: targets × routes × cycles round trips.
  @max_targets 12

  @doc """
  The class names to census for a detected stack.

  `extra` comes from user config, and wins a place ahead of the universal list —
  someone who names their own class knows something the detector does not.
  """
  @spec for_profile(VibeGuru.StackProfile.t() | nil, [String.t()]) :: [String.t()]
  def for_profile(profile, extra \\ []) do
    (normalize(extra) ++ library_targets(profile) ++ @universal)
    |> Enum.uniq()
    |> Enum.take(@max_targets)
  end

  @doc "Every class this module knows about, for documentation and tests."
  @spec known() :: [String.t()]
  def known,
    do: Enum.uniq(@universal ++ Enum.flat_map(@by_library, fn {_lib, names} -> names end))

  defp library_targets(%{chart_libs: libs}) when is_list(libs) do
    Enum.flat_map(libs, &Map.get(@by_library, &1, []))
  end

  defp library_targets(_), do: []

  # Config is user input on its way to being evaluated inside the page, so anything
  # that is not a plain identifier is dropped here rather than relied on being
  # rejected further down.
  defp normalize(extra) when is_list(extra) do
    extra
    |> Enum.filter(&is_binary/1)
    |> Enum.map(&String.trim/1)
    |> Enum.filter(&Regex.match?(~r/^[A-Za-z_$][A-Za-z0-9_$.]*$/, &1))
  end

  defp normalize(_), do: []
end
