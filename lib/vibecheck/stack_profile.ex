defmodule Vibecheck.StackProfile do
  @moduledoc """
  The structurally-detected description of the target app.

  Produced by `Vibecheck.Detector` purely from file presence + manifest parsing
  (package.json, lockfiles, build config) — **no AI, no code semantics**. Probes use
  it to decide `applies_to?/1` and to tune their behaviour (e.g. enable the
  canvas/WebGL signature only when a chart lib is present; warn when source maps are
  absent because allocation attribution will be coarse).
  """

  @type surface :: :frontend | :backend | :fullstack | :unknown
  @type stack :: :react | :next | :vue | :svelte | :unknown
  @type tristate :: :present | :absent | :unknown

  @type t :: %__MODULE__{
          root: String.t() | nil,
          url: String.t() | nil,
          surface: surface(),
          stack: stack(),
          bundler: atom() | nil,
          router: atom() | nil,
          chart_libs: [atom()],
          source_maps: tristate(),
          meta: map()
        }

  defstruct root: nil,
            url: nil,
            surface: :unknown,
            stack: :unknown,
            bundler: nil,
            router: nil,
            chart_libs: [],
            source_maps: :unknown,
            meta: %{}

  @doc "Plain-map form for JSON reporters."
  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = p) do
    %{
      root: p.root,
      url: p.url,
      surface: p.surface,
      stack: p.stack,
      bundler: p.bundler,
      router: p.router,
      chart_libs: p.chart_libs,
      source_maps: p.source_maps,
      meta: p.meta
    }
  end
end
