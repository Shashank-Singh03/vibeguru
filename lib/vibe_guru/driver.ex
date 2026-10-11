defmodule VibeGuru.Driver do
  @moduledoc """
  Spawns the Node/Playwright sidecar and reads its NDJSON event stream.

  Everything that needs a browser goes through here: the `memory.client` probe, and
  the interactive login `vibeguru auth` performs. They want different things out of
  the run — one wants evidence, the other wants a saved session — but the mechanics
  are identical: resolve `node`, resolve the driver, hand it a config file, and read
  one JSON object per line off stdout until it exits.

  Events are returned raw. Interpreting them (into `Evidence`, or into anything else)
  belongs to the caller, which keeps this module free of any one vector's vocabulary.
  """

  # Dev fallback only: resolved at compile time relative to this source file. In a
  # packaged Burrito release this path points at the *build* machine and won't exist,
  # so resolution falls through to VIBEGURU_DRIVER_PATH (set by the npm wrapper).
  @project_root Path.expand("../..", __DIR__)
  @default_driver Path.join(@project_root, "driver-node/index.js")

  @default_timeout_ms 600_000

  @type event :: map()

  @doc """
  Run the driver with `config` (encoded to a temp JSON file) and collect its events.

  Options: `:on_log` (called with each `log` event), `:timeout_ms`, `:driver_path`.
  """
  @spec run(map(), keyword()) ::
          {:ok, %{events: [event()], result: event() | nil}} | {:error, term()}
  def run(config, opts \\ []) do
    with {:ok, node} <- find_node(),
         {:ok, driver} <- find_driver(opts),
         {:ok, cfg_path} <- write_config(config) do
      try do
        drive(node, driver, cfg_path, opts)
      after
        File.rm(cfg_path)
        File.rmdir(Path.dirname(cfg_path))
      end
    end
  end

  # --- port orchestration -------------------------------------------------

  defp drive(node, driver, cfg_path, opts) do
    on_log = Keyword.get(opts, :on_log, fn _ -> :ok end)
    timeout = Keyword.get(opts, :timeout_ms, @default_timeout_ms)

    port =
      Port.open({:spawn_executable, node}, [
        :binary,
        :exit_status,
        :hide,
        {:line, 4_000_000},
        {:args, [driver, "--config", cfg_path]}
      ])

    deadline = System.monotonic_time(:millisecond) + timeout
    loop(port, %{events: [], result: nil, error: nil, buffer: "", on_log: on_log}, deadline)
  end

  defp loop(port, state, deadline) do
    receive do
      {^port, {:data, {:eol, chunk}}} ->
        line = state.buffer <> chunk
        loop(port, handle_line(line, %{state | buffer: ""}), deadline)

      {^port, {:data, {:noeol, chunk}}} ->
        loop(port, %{state | buffer: state.buffer <> chunk}, deadline)

      {^port, {:exit_status, 0}} ->
        finish(state)

      {^port, {:exit_status, status}} ->
        case state.error do
          nil -> {:error, {:driver_exit, status}}
          msg -> {:error, {:driver_error, msg}}
        end
    after
      max(0, deadline - System.monotonic_time(:millisecond)) ->
        safe_close(port)
        {:error, :driver_timeout}
    end
  end

  defp finish(%{error: msg}) when is_binary(msg), do: {:error, {:driver_error, msg}}

  defp finish(%{result: nil}), do: {:error, :missing_driver_result}

  defp finish(%{result: %{"ok" => true}, events: events} = state),
    do: {:ok, %{events: Enum.reverse(events), result: state.result}}

  defp finish(_), do: {:error, :invalid_driver_result}

  # --- line handling ------------------------------------------------------

  defp handle_line("", state), do: state

  defp handle_line(line, state) do
    case Jason.decode(line) do
      {:ok, %{"type" => type} = obj} when type in ["evidence", "marker"] ->
        %{state | events: [obj | state.events]}

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

  # --- resolution helpers -------------------------------------------------

  defp find_node do
    case System.find_executable("node") do
      nil -> {:error, :node_not_found}
      path -> {:ok, path}
    end
  end

  # Resolution order, first existing wins: explicit option -> app env ->
  # VIBEGURU_DRIVER_PATH (the npm wrapper points this at the bundled driver-node)
  # -> compile-time source path (dev only). A directory is accepted and resolved to
  # its index.js, so the wrapper can pass either form.
  defp find_driver(opts) do
    candidates =
      [
        Keyword.get(opts, :driver_path),
        Application.get_env(:vibe_guru, :driver_path),
        System.get_env("VIBEGURU_DRIVER_PATH"),
        @default_driver
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.map(&normalize_driver/1)

    case Enum.find(candidates, &File.exists?/1) do
      nil -> {:error, {:driver_not_found, candidates}}
      path -> {:ok, path}
    end
  end

  defp normalize_driver(path) do
    if File.dir?(path), do: Path.join(path, "index.js"), else: path
  end

  defp write_config(config) do
    body = Jason.encode!(config)

    dir =
      Path.join(
        System.tmp_dir!(),
        "vibeguru-driver-#{Base.url_encode64(:crypto.strong_rand_bytes(16), padding: false)}"
      )

    path = Path.join(dir, "config.json")

    with :ok <- File.mkdir(dir) do
      result =
        with :ok <- private_mode(dir, 0o700),
             {:ok, file} <- File.open(path, [:write, :binary, :exclusive]) do
          try do
            with :ok <- private_mode(path, 0o600),
                 :ok <- IO.binwrite(file, body) do
              {:ok, path}
            end
          after
            File.close(file)
          end
        end

      case result do
        {:ok, _} ->
          result

        {:error, reason} ->
          File.rm(path)
          File.rmdir(dir)
          {:error, {:config_write_failed, reason}}
      end
    else
      {:error, reason} -> {:error, {:config_write_failed, reason}}
    end
  end

  # chmod does not establish Windows ACL isolation; those inherit from TEMP.
  defp private_mode(path, mode) do
    case :os.type() do
      {:win32, _} -> :ok
      _ -> File.chmod(path, mode)
    end
  end

  defp safe_close(port) do
    if Port.info(port), do: Port.close(port)
  rescue
    _ -> :ok
  end
end
