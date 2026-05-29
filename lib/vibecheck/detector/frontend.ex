defmodule Vibecheck.Detector.Frontend do
  @moduledoc """
  Frontend-specific detection layered on top of `Vibecheck.Detector.Stack`:
  router, chart/graphics libraries (enables the canvas/WebGL signature), and a
  source-map availability heuristic (absent → allocation attribution degrades to
  coarse, with a warning rather than a crash).
  """

  # dependency name => normalized chart-lib atom
  @chart_libs %{
    "chart.js" => :chartjs,
    "recharts" => :recharts,
    "three" => :three,
    "d3" => :d3,
    "plotly.js" => :plotly,
    "echarts" => :echarts,
    "victory" => :victory,
    "@nivo/core" => :nivo,
    "apexcharts" => :apexcharts
  }

  @spec detect(map(), String.t() | nil) :: map()
  def detect(%{deps: deps} = _stack_info, root) do
    %{
      router: router_from(deps),
      chart_libs: chart_libs_from(deps),
      source_maps: source_maps_from(deps, root)
    }
  end

  defp router_from(deps) do
    cond do
      Map.has_key?(deps, "next") -> :next
      Map.has_key?(deps, "react-router-dom") -> :react_router
      Map.has_key?(deps, "react-router") -> :react_router
      Map.has_key?(deps, "vue-router") -> :vue_router
      Map.has_key?(deps, "@sveltejs/kit") -> :sveltekit
      true -> nil
    end
  end

  defp chart_libs_from(deps) do
    @chart_libs
    |> Enum.filter(fn {name, _atom} -> Map.has_key?(deps, name) end)
    |> Enum.map(fn {_name, atom} -> atom end)
    |> Enum.sort()
  end

  # Heuristic only. A dev server (Vite/Next dev) virtually always serves source maps,
  # so when we can't see a build output we report :present for vite/next dev and
  # :unknown otherwise. Task #5 refines this by inspecting served .map files at runtime.
  defp source_maps_from(deps, _root) do
    cond do
      Map.has_key?(deps, "vite") -> :present
      Map.has_key?(deps, "next") -> :present
      true -> :unknown
    end
  end
end
