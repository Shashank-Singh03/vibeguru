defmodule VibeGuru.Probes.Heap.Snapshot do
  @moduledoc """
  The focused probe that sees what the census structurally cannot.

  `census.client` asks the page for instances by prototype, which only reaches classes
  on global scope. `import { Chart } from "chart.js"` is module-scoped, so a bundled
  app's own classes are invisible there — the census reports null and the question stays
  open. A heap snapshot carries every object's constructor name regardless of scope.

  It costs seconds rather than milliseconds, which is why it is not in the survey. The
  investigation loop reaches for it only after something cheaper has narrowed the
  question to one route.

  Returns the captured observations and qualified hypothesis updates. Constructor
  counts do not establish retaining paths, ownership, a source line or a specific fix.
  """

  alias VibeGuru.Driver

  # Growing container instance counts are an investigation lead, not proof that any
  # particular cache is unbounded or that its entries are responsible for other growth.
  @containers ~w(Map Set WeakMap WeakSet)

  @default_visits 3
  @timeout_ms 180_000

  @doc """
  Exercise one route and report what it retained.

  `focus` carries `:route` and optionally `:constructor_hint` — a class an earlier,
  cheaper probe already suspects, which is reported whatever its count.
  """
  @spec investigate(VibeGuru.StackProfile.t(), map(), keyword()) ::
          {:ok, map()} | {:error, term()}
  def investigate(profile, focus, opts \\ []) do
    config = %{
      "url" => profile.url,
      "mode" => "snapshot",
      "route" => Map.get(focus, :route, "/"),
      "cycles" => Keyword.get(opts, :visits, @default_visits),
      "settleMs" => Keyword.get(opts, :settle_ms, 500),
      "headless" => Keyword.get(opts, :headless, true),
      "constructorHints" => focus |> Map.get(:constructor_hint) |> List.wrap(),
      "routeExpectations" => Keyword.get(opts, :route_expectations, %{}),
      "storageState" => Keyword.get(opts, :storage_state)
    }

    driver_opts = [
      on_log: Keyword.get(opts, :on_log, fn _ -> :ok end),
      timeout_ms: Keyword.get(opts, :timeout_ms, @timeout_ms)
    ]

    case Driver.run(config, driver_opts) do
      {:ok, %{events: events, result: result}} -> {:ok, interpret(events, result, focus)}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  Turn a snapshot result into hypothesis updates.

  Public because this is the judgment worth testing, and it needs no browser to exercise.
  """
  @spec interpret([map()], map() | nil, map()) :: map()
  def interpret(events, result, focus \\ %{}) do
    captured = Enum.filter(events, &(is_map(&1) and &1["kind"] == "heap_census"))

    data =
      case captured do
        [%{"data" => data}] when is_map(data) -> data
        _ -> %{}
      end

    growth = data["growth"]
    reasons = measurement_reasons(captured, data, result, focus)
    complete = reasons == []

    %{
      cost_ms:
        if(is_map(result) and is_number(result["durationMs"]),
          do: max(result["durationMs"], 0),
          else: 0
        ),
      summary:
        if(complete,
          do: summarize(growth),
          else: "snapshot measurement unavailable: " <> Enum.join(reasons, ", ")
        ),
      growth: if(is_map(growth), do: growth, else: %{}),
      evidence: captured,
      completion: result,
      measurement_validity: %{
        status: if(complete, do: :complete, else: :unavailable),
        reasons: reasons
      },
      updates: if(complete, do: updates(growth), else: %{})
    }
  end

  defp measurement_reasons(captured, data, result, focus) do
    result = if is_map(result), do: result, else: %{}

    route =
      case captured do
        [%{"context" => context}] when is_map(context) -> context["route"]
        _ -> nil
      end

    []
    |> reason(length(captured) != 1, "missing_or_duplicate_heap_census")
    |> reason(not valid_growth?(data["growth"]), "missing_or_invalid_growth")
    |> reason(result["ok"] != true, "driver_completion_unconfirmed")
    |> reason(data["gcOk"] != true or result["gcOk"] != true, "snapshot_gc_unconfirmed")
    |> reason(
      data["navigationOk"] != true or result["navigationOk"] != true,
      "snapshot_navigation_unconfirmed"
    )
    |> reason(
      not is_integer(data["visits"]) or data["visits"] < 1 or
        data["visitsCompleted"] != data["visits"] or
        result["visitsCompleted"] != data["visits"] or result["visits"] != data["visits"],
      "incomplete_snapshot_visits"
    )
    |> reason(
      not is_binary(route) or route == "" or route != result["route"] or
        (Map.has_key?(focus, :route) and route != focus.route),
      "snapshot_route_mismatch"
    )
  end

  defp valid_growth?(growth) when is_map(growth) do
    Enum.all?(growth, fn {class, detail} ->
      is_binary(class) and class != "" and is_map(detail) and
        is_integer(detail["retained"]) and detail["retained"] > 0 and
        is_number(detail["perVisit"]) and detail["perVisit"] >= 0 and
        is_number(detail["bytes"])
    end)
  end

  defp valid_growth?(_), do: false
  defp reason(reasons, true, value), do: reasons ++ [value]
  defp reason(reasons, _, _), do: reasons

  # This is a ranked constructor summary, not a complete retaining graph. No observed
  # growth cannot eliminate retention; co-growth cannot establish common ownership.
  defp updates(growth) do
    {containers, objects} = Enum.split_with(growth, fn {class, _} -> class in @containers end)

    %{}
    |> support(
      objects,
      :retained_library_object,
      "object constructor counts increased; retaining paths and ownership are unverified"
    )
    |> support(
      containers,
      :unbounded_cache,
      "container counts increased; cache ownership and bounds are unverified"
    )
  end

  defp support(updates, [], _hypothesis, _description), do: updates

  defp support(updates, entries, hypothesis, description),
    do: Map.put(updates, hypothesis, {:supported, names_of(entries) <> ": " <> description})

  defp names_of(containers),
    do: containers |> Enum.map(fn {class, _} -> class end) |> Enum.sort() |> Enum.join(", ")

  defp summarize(growth) when map_size(growth) == 0,
    do: "no growth in the compared constructor summary; retention remains unresolved"

  defp summarize(growth) do
    growth
    |> Enum.sort_by(fn {_class, g} -> -g["retained"] end)
    |> Enum.take(3)
    |> Enum.map_join(", ", fn {class, g} -> "#{class} +#{g["retained"]}" end)
  end
end
