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

  Returns the shape the loop wants — a result with hypothesis updates — rather than
  `Evidence`, because nothing downstream re-analyzes it. The measurement is the answer.
  """

  alias VibeGuru.Driver

  # Growth in one of these is a container filling up rather than an object nobody
  # released. Different hypothesis, different fix.
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
    growth = growth_from(events)
    hint = Map.get(focus, :constructor_hint)

    %{
      cost_ms: (result && Map.get(result, "durationMs")) || 0,
      summary: summarize(growth),
      growth: growth,
      updates: updates(growth, hint)
    }
  end

  defp growth_from(events) do
    events
    |> Enum.find(%{}, &(Map.get(&1, "kind") == "heap_census"))
    |> Map.get("data", %{})
    |> Map.get("growth", %{})
  end

  # Nothing grew across the whole heap. That is a real answer, not an absence of one:
  # the snapshot saw everything, so it rules both object-retention hypotheses out.
  defp updates(growth, _hint) when map_size(growth) == 0 do
    %{
      retained_library_object: {:eliminated, "no constructor grew across visits"},
      unbounded_cache: {:eliminated, "no container grew across visits"}
    }
  end

  defp updates(growth, hint) do
    {containers, objects} = Enum.split_with(growth, fn {class, _} -> class in @containers end)
    confirmed = confirmed_class(objects, hint)

    %{}
    |> object_update(objects, hint)
    |> container_update(containers, confirmed)
  end

  # The class the investigation suspected, when the snapshot found it. Everything else
  # that grew alongside is then likely to be its internals rather than a second problem.
  defp confirmed_class(objects, hint) do
    if hint && Enum.any?(objects, fn {class, _} -> class == hint end), do: hint, else: nil
  end

  defp object_update(updates, [], _hint),
    do: Map.put(updates, :retained_library_object, {:eliminated, "no object constructor grew"})

  defp object_update(updates, objects, hint) do
    # The class the investigation already suspected wins, even if something else grew
    # more — a bigger number elsewhere is not a better answer to the question asked.
    {class, detail} =
      Enum.find(objects, fn {class, _} -> class == hint end) ||
        Enum.max_by(objects, fn {_class, g} -> g["retained"] end)

    Map.put(
      updates,
      :retained_library_object,
      {:supported, "#{detail["retained"]} #{class} instance(s) retained across visits"}
    )
  end

  defp container_update(updates, [], _confirmed),
    do: Map.put(updates, :unbounded_cache, {:eliminated, "no container grew"})

  # Containers held BY a confirmed object are that object's internals, not a separate
  # cache. Chart.js keeps Maps and Sets inside every chart, so a retained chart drags
  # them along — calling that a second bug would send someone hunting for a cache that
  # does not exist. Stated explicitly so the claim can be argued with.
  defp container_update(updates, containers, confirmed) when is_binary(confirmed) do
    names = names_of(containers)

    Map.put(
      updates,
      :unbounded_cache,
      {:eliminated, "#{names} growth is consistent with the retained #{confirmed}'s internals"}
    )
  end

  defp container_update(updates, containers, _confirmed),
    do:
      Map.put(
        updates,
        :unbounded_cache,
        {:supported, "#{names_of(containers)} grew across visits"}
      )

  defp names_of(containers),
    do: containers |> Enum.map(fn {class, _} -> class end) |> Enum.sort() |> Enum.join(", ")

  defp summarize(growth) when map_size(growth) == 0, do: "nothing retained across visits"

  defp summarize(growth) do
    growth
    |> Enum.sort_by(fn {_class, g} -> -g["retained"] end)
    |> Enum.take(3)
    |> Enum.map_join(", ", fn {class, g} -> "#{class} +#{g["retained"]}" end)
  end
end
