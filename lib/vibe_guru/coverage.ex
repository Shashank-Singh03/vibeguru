defmodule VibeGuru.Coverage do
  @moduledoc """
  How much of the app a run actually exercised — and what it could not reach.

  This exists because the tool previously could not tell **clean** from **blind**. A
  run that reached three of nineteen routes and found nothing wrong printed the same
  confident "no issues found" as a run that reached all nineteen. For a product whose
  whole claim is that its findings are real and its silence is meaningful, a false
  all-clear is the worst failure available: it is not a missing feature, it is the
  tool lying.

  So every run now reports what it saw. Low coverage is deliberately **not** a
  `Finding` — a finding is a defect in the app, this is a limitation of the analysis,
  and conflating the two is exactly the noise this codebase works to avoid. It rides
  alongside the findings instead, in every output.
  """

  @type unreachable :: %{path: String.t(), reason: String.t(), detail: String.t() | nil}

  @type t :: %__MODULE__{
          declared: non_neg_integer(),
          discovered: non_neg_integer(),
          visited: [String.t()],
          unreachable: [unreachable()],
          known: non_neg_integer(),
          ratio: float()
        }

  defstruct declared: 0, discovered: 0, visited: [], unreachable: [], known: 0, ratio: 1.0

  # Below this, a clean result says more about the analysis than about the app.
  @low_coverage 0.7

  @doc "Pull the coverage evidence out of a run's evidence list."
  @spec from_evidence([VibeGuru.Evidence.t()]) :: t() | nil
  def from_evidence(evidences) do
    case Enum.find(evidences, &(&1.kind == :coverage)) do
      nil -> nil
      %{data: data} -> build(data)
    end
  end

  defp build(data) do
    visited = list(data["visited"])
    unreachable = Enum.map(list(data["unreachable"]), &normalize_unreachable/1)

    known = length(Enum.uniq(visited ++ Enum.map(unreachable, & &1.path)))

    %__MODULE__{
      declared: data["declared"] || 0,
      discovered: data["discovered"] || 0,
      visited: visited,
      unreachable: unreachable,
      known: known,
      ratio: if(known == 0, do: 1.0, else: length(visited) / known)
    }
  end

  defp normalize_unreachable(%{"path" => path} = entry),
    do: %{path: path, reason: entry["reason"] || "unknown", detail: entry["detail"]}

  defp normalize_unreachable(other), do: %{path: to_string(other), reason: "unknown", detail: nil}

  defp list(v) when is_list(v), do: v
  defp list(_), do: []

  @doc "True when a clean result should not be presented as an all-clear."
  @spec low?(t() | nil) :: boolean()
  def low?(nil), do: false
  def low?(%__MODULE__{known: 0}), do: true
  def low?(%__MODULE__{ratio: ratio}), do: ratio < @low_coverage

  @doc "One-line summary, e.g. `Exercised 3 of 19 routes (16%)`."
  @spec summary(t() | nil) :: String.t() | nil
  def summary(nil), do: nil

  def summary(%__MODULE__{known: 0}),
    do:
      "No routes could be exercised — nothing was declared in the source and nothing was linked."

  def summary(%__MODULE__{visited: visited, known: known, ratio: ratio}),
    do: "Exercised #{length(visited)} of #{known} routes (#{round(ratio * 100)}%)."

  @doc """
  Human explanations for what was missed, grouped by cause and ordered by how many
  routes each accounts for — so the biggest gap is the first thing read.
  """
  @spec gaps(t() | nil) :: [String.t()]
  def gaps(nil), do: []

  def gaps(%__MODULE__{unreachable: []}), do: []

  def gaps(%__MODULE__{unreachable: unreachable}) do
    unreachable
    |> Enum.group_by(& &1.reason)
    |> Enum.sort_by(fn {_reason, entries} -> -length(entries) end)
    |> Enum.map(fn {reason, entries} -> explain(reason, entries) end)
  end

  defp explain("auth_required", entries) do
    "#{count(entries)} redirected to a sign-in page — the app needs authentication to " <>
      "reach them (#{paths(entries)})."
  end

  defp explain("dynamic", entries) do
    "#{count(entries)} take a dynamic segment with no value configured, so visiting " <>
      "them would only render an error page. Set `routeParams` in vibeguru.json " <>
      "(#{paths(entries)})."
  end

  defp explain("over_limit", entries) do
    "#{count(entries)} were beyond the route limit — raise `--routes` to include them " <>
      "(#{paths(entries)})."
  end

  defp explain("redirected", entries) do
    "#{count(entries)} redirected elsewhere, so the route was never rendered " <>
      "(#{paths(entries)})."
  end

  defp explain("navigation_failed", entries) do
    "#{count(entries)} could not be navigated to at all (#{paths(entries)})."
  end

  defp explain(other, entries), do: "#{count(entries)} unreachable (#{other}): #{paths(entries)}."

  defp count([_one]), do: "1 route"
  defp count(entries), do: "#{length(entries)} routes"

  # Enough to act on without turning the summary into a wall of paths.
  defp paths(entries) do
    shown = entries |> Enum.map(& &1.path) |> Enum.take(5) |> Enum.join(", ")
    if length(entries) > 5, do: shown <> ", …", else: shown
  end

  @doc "Plain-map form for JSON reporters."
  @spec to_map(t() | nil) :: map() | nil
  def to_map(nil), do: nil

  def to_map(%__MODULE__{} = c) do
    %{
      declared: c.declared,
      discovered: c.discovered,
      visited: c.visited,
      unreachable: c.unreachable,
      routes_known: c.known,
      ratio: Float.round(c.ratio, 3),
      low: low?(c)
    }
  end
end
