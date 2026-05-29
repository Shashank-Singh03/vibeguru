defmodule VibeGuru.Detector.Stack do
  @moduledoc """
  Structural stack detection from `package.json`. No AI, no code parsing — just
  manifest reading. Determines framework, bundler and overall surface.
  """

  @doc """
  Read `<root>/package.json` and return a partial map of detected attributes.
  Missing/unreadable manifest yields `:unknown` values (never raises).
  """
  @spec detect(String.t() | nil) :: map()
  def detect(nil), do: empty()

  def detect(root) do
    path = Path.join(root, "package.json")

    with {:ok, body} <- File.read(path),
         {:ok, json} <- Jason.decode(body) do
      deps = merged_deps(json)
      stack = stack_from(deps)

      %{
        stack: stack,
        bundler: bundler_from(deps),
        surface: surface_from(stack),
        deps: deps
      }
    else
      _ -> empty()
    end
  end

  defp empty, do: %{stack: :unknown, bundler: nil, surface: :unknown, deps: %{}}

  defp merged_deps(json) do
    Map.merge(
      Map.get(json, "dependencies", %{}),
      Map.get(json, "devDependencies", %{})
    )
  end

  defp stack_from(deps) do
    cond do
      has?(deps, "next") -> :next
      has?(deps, "react") -> :react
      has?(deps, "vue") -> :vue
      has?(deps, "svelte") -> :svelte
      true -> :unknown
    end
  end

  defp bundler_from(deps) do
    cond do
      has?(deps, "next") -> :next
      has?(deps, "vite") -> :vite
      has?(deps, "react-scripts") -> :cra
      has?(deps, "webpack") -> :webpack
      true -> nil
    end
  end

  defp surface_from(stack) when stack in [:react, :next, :vue, :svelte], do: :frontend
  defp surface_from(_), do: :unknown

  defp has?(deps, name), do: Map.has_key?(deps, name)
end
