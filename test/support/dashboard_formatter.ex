defmodule VibeGuru.DashboardFormatter do
  @moduledoc false
  use GenServer

  def init(options) do
    root = Keyword.get(options, :dashboard_root, Path.expand("../..", __DIR__))
    started = System.system_time(:millisecond)

    scope =
      if Keyword.get(options, :dashboard_scope, System.get_env("VIBEGURU_TEST_SCOPE")) ==
           "repository",
         do: "repository",
         else: "unspecified"

    revision =
      case System.find_executable("node") do
        nil ->
          nil

        node ->
          case System.cmd(node, ["scripts/checks.mjs", "--revision"],
                 cd: root,
                 stderr_to_stdout: true
               ) do
            {output, 0} -> String.trim(output)
            _ -> nil
          end
      end

    record = %{
      schema_version: 1,
      id: "elixir-#{started}-#{System.unique_integer([:positive])}",
      suite: "Elixir tests",
      command: if(scope == "repository", do: "mix test", else: "mix test (scope not recorded)"),
      scope: scope,
      status: "RUNNING",
      started_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      finished_at: nil,
      duration_ms: nil,
      tests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      doctests: 0,
      failures: [],
      log_path: nil,
      source_revision: revision
    }

    state = %{root: root, started: started, record: record}
    persist(state)
    {:ok, state}
  end

  def handle_cast({:test_finished, test}, state) do
    record = Map.update!(state.record, :tests, &(&1 + 1))

    record =
      if test.tags[:test_type] == :doctest,
        do: Map.update!(record, :doctests, &(&1 + 1)),
        else: record

    record =
      case test.state do
        nil ->
          Map.update!(record, :passed, &(&1 + 1))

        {:failed, failures} ->
          message =
            Enum.map_join(failures, "\n", fn {kind, reason, stack} ->
              Exception.format(kind, reason, stack)
            end)

          failure = %{
            name: "#{inspect(test.module)}: #{test.name}",
            message: String.slice(message, 0, 6000)
          }

          record |> Map.update!(:failed, &(&1 + 1)) |> Map.update!(:failures, &[failure | &1])

        {state, _reason} when state in [:skipped, :excluded] ->
          Map.update!(record, :skipped, &(&1 + 1))

        other ->
          failure = %{
            name: "#{inspect(test.module)}: #{test.name}",
            message: "Test did not complete: #{inspect(other, limit: 30)}"
          }

          record |> Map.update!(:failed, &(&1 + 1)) |> Map.update!(:failures, &[failure | &1])
      end

    {:noreply, %{state | record: record}}
  end

  def handle_cast({:suite_finished, _times}, state) do
    record = %{
      state.record
      | status:
          cond do
            state.record.failed > 0 -> "FAIL"
            state.record.passed > 0 -> "PASS"
            true -> "ERROR"
          end,
        finished_at: DateTime.utc_now() |> DateTime.to_iso8601(),
        duration_ms: System.system_time(:millisecond) - state.started,
        failures: Enum.reverse(state.record.failures)
    }

    persist(%{state | record: record})
    {:noreply, %{state | record: record}}
  end

  def handle_cast(_event, state), do: {:noreply, state}

  defp persist(state) do
    directory = Path.join(state.root, "reports/test-history")
    target = Path.join(directory, state.record.id <> ".json")
    temporary = target <> ".tmp"

    with :ok <- File.mkdir_p(directory),
         :ok <- File.write(temporary, Jason.encode!(state.record, pretty: true)),
         :ok <- File.rename(temporary, target) do
      :ok
    else
      {:error, reason} -> IO.warn("Dashboard test recording failed: #{inspect(reason)}")
    end
  end
end
