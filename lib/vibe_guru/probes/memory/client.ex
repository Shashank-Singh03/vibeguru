defmodule VibeGuru.Probes.Memory.Client do
  @moduledoc """
  The `memory.client` probe — gathers frontend memory evidence by driving a headless
  Chrome through the Node/Playwright/CDP sidecar in `driver-node/`.

  Communication is an Elixir `Port`: we write the run config to a temp JSON file, spawn
  `node driver-node/index.js --config <file>`, and read newline-delimited JSON events
  off stdout, converting `evidence`/`marker` lines into `VibeGuru.Evidence` structs.

  Returns raw evidence only — interpretation is the analyzer's job.
  """

  @behaviour VibeGuru.Probe

  alias VibeGuru.Evidence

  # Resolved at compile time relative to this source file:
  # lib/vibeguru/probes/memory -> (../../../..) -> project root.
  @project_root Path.expand("../../../..", __DIR__)
  @default_driver Path.join(@project_root, "driver-node/index.js")

  @impl true
  def id, do: :"memory.client"

  @impl true
  def applies_to?(%{surface: surface}), do: surface in [:frontend, :fullstack, :unknown]

  @impl true
  def cost, do: :expensive

  @impl true
  def run(profile, config) do
    with {:ok, node} <- find_node(),
         {:ok, driver} <- find_driver(config),
         {:ok, cfg_path} <- write_config(profile, config) do
      try do
        drive(node, driver, cfg_path, config)
      after
        File.rm(cfg_path)
      end
    end
  end

  # --- port orchestration -------------------------------------------------

  defp drive(node, driver, cfg_path, config) do
    on_log = Map.get(config, :on_log, fn _ -> :ok end)
    timeout = Map.get(config, :timeout_ms, 600_000)

    port =
      Port.open({:spawn_executable, node}, [
        :binary,
        :exit_status,
        :hide,
        {:line, 4_000_000},
        {:args, [driver, "--config", cfg_path]}
      ])

    loop(port, %{evidences: [], result: nil, error: nil, buffer: "", on_log: on_log}, timeout)
  end

  defp loop(port, state, timeout) do
    receive do
      {^port, {:data, {:eol, chunk}}} ->
        line = state.buffer <> chunk
        loop(port, handle_line(line, %{state | buffer: ""}), timeout)

      {^port, {:data, {:noeol, chunk}}} ->
        loop(port, %{state | buffer: state.buffer <> chunk}, timeout)

      {^port, {:exit_status, 0}} ->
        finish(state)

      {^port, {:exit_status, status}} ->
        case state.error do
          nil -> {:error, {:driver_exit, status}}
          msg -> {:error, {:driver_error, msg}}
        end
    after
      timeout ->
        safe_close(port)
        {:error, {:timeout, timeout}}
    end
  end

  defp finish(%{error: msg}) when is_binary(msg), do: {:error, {:driver_error, msg}}
  defp finish(%{evidences: evidences}), do: {:ok, Enum.reverse(evidences)}

  # --- line handling ------------------------------------------------------

  defp handle_line("", state), do: state

  defp handle_line(line, state) do
    case Jason.decode(line) do
      {:ok, %{"type" => "evidence"} = obj} ->
        %{state | evidences: [to_evidence(obj) | state.evidences]}

      {:ok, %{"type" => "marker"} = obj} ->
        %{state | evidences: [to_evidence(obj) | state.evidences]}

      {:ok, %{"type" => "log"} = obj} ->
        state.on_log.(obj)
        state

      {:ok, %{"type" => "result"} = obj} ->
        %{state | result: obj}

      {:ok, %{"type" => "error", "message" => msg}} ->
        %{state | error: msg}

      _ ->
        # Non-JSON noise (shouldn't happen on stdout) — ignore.
        state
    end
  end

  # Safe, whitelisted string→atom mapping (never String.to_atom on dynamic input).
  @kinds %{"sample" => :sample, "snapshot" => :snapshot, "profile" => :profile, "config" => :config, "marker" => :marker}
  @phases %{"baseline" => :baseline, "cycle" => :cycle, "cooldown" => :cooldown}

  defp to_evidence(obj) do
    Evidence.new(:"memory.client", Map.get(@kinds, obj["kind"], :marker),
      phase: Map.get(@phases, obj["phase"]),
      cycle: obj["cycle"],
      timestamp: obj["timestamp"],
      context: obj["context"] || %{},
      data: obj["data"] || %{}
    )
  end

  # --- resolution helpers -------------------------------------------------

  defp find_node do
    case System.find_executable("node") do
      nil -> {:error, :node_not_found}
      path -> {:ok, path}
    end
  end

  defp find_driver(config) do
    path =
      Map.get(config, :driver_path) ||
        Application.get_env(:vibe_guru, :driver_path) ||
        @default_driver

    if File.exists?(path), do: {:ok, path}, else: {:error, {:driver_not_found, path}}
  end

  defp write_config(profile, config) do
    cfg = %{
      "url" => profile.url,
      "mode" => to_string(Map.get(config, :mode, "auto")),
      "cycles" => Map.get(config, :cycles, 20),
      "settleMs" => Map.get(config, :settle_ms, 500),
      "routesLimit" => Map.get(config, :routes_limit, 8),
      "headless" => Map.get(config, :headless, true),
      "flow" => Map.get(config, :flow, nil)
    }

    path = Path.join(System.tmp_dir!(), "vibeguru_cfg_#{System.unique_integer([:positive])}.json")

    case File.write(path, Jason.encode!(cfg)) do
      :ok -> {:ok, path}
      {:error, reason} -> {:error, {:config_write_failed, reason}}
    end
  end

  defp safe_close(port) do
    if Port.info(port), do: Port.close(port)
  rescue
    _ -> :ok
  end
end
