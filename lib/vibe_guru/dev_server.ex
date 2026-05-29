defmodule VibeGuru.DevServer do
  @moduledoc """
  Starts the target app's dev server, waits until it accepts TCP connections, and tears
  the whole process tree down again. This is what lets `vibeguru run` be a single step:
  the user never has to start their app in a separate terminal.

  Design notes:
    * We spawn the bare command (no shell output-redirection) to avoid Windows `cmd /c`
      nested-quote pitfalls, and **drain** the process's output ourselves into a log
      file — so the spawned process never floods the owning process's mailbox and we
      still have output to show if startup fails.
    * Readiness is a dependency-free TCP probe across all resolved addresses (IPv4 and
      IPv6 — dev servers often bind `localhost` to `::1` on Windows).
    * Teardown kills the process *tree* (npm → node → bundler) via the OS, because
      closing the Erlang port alone would orphan the grandchildren.
  """

  @poll_ms 250
  @default_timeout_ms 60_000

  @type t :: %__MODULE__{
          port_ref: port(),
          os_pid: non_neg_integer() | nil,
          host: String.t(),
          port: pos_integer(),
          url: String.t(),
          log: Path.t(),
          device: File.io_device() | nil
        }

  @enforce_keys [:port_ref, :host, :port, :url, :log]
  defstruct [:port_ref, :os_pid, :host, :port, :url, :log, :device]

  @doc """
  Start `command` (e.g. `"npm run dev"`) in directory `:cd` and wait until `url` is
  listening. On timeout / early exit it stops the process and returns an error whose
  payload includes the captured log path.

  Options: `:cd` (default cwd), `:timeout_ms` (default 60s).
  """
  @spec start(String.t(), String.t(), keyword()) :: {:ok, t()} | {:error, term()}
  def start(command, url, opts \\ []) do
    cd = Keyword.get(opts, :cd, File.cwd!())
    timeout = Keyword.get(opts, :timeout_ms, @default_timeout_ms)
    %{host: host, port: port} = target(url)
    log = log_path()

    device = File.open!(log, [:write, :binary])
    port_ref = spawn_shell(command, cd)

    server = %__MODULE__{
      port_ref: port_ref,
      os_pid: os_pid(port_ref),
      host: host,
      port: port,
      url: url,
      log: log,
      device: device
    }

    case await(server, deadline(timeout)) do
      :ok -> {:ok, server}
      {:error, reason} -> stop(server) && {:error, reason}
    end
  end

  @doc "Stop the dev server and its child processes. Always returns `:ok`."
  @spec stop(t()) :: :ok
  def stop(%__MODULE__{} = server) do
    drain(server.port_ref, server.device)
    close_device(server.device)
    kill_tree(server.os_pid)
    close_port(server.port_ref)
    :ok
  end

  @doc "True when something is already listening on the URL's host:port."
  @spec reachable?(String.t()) :: boolean()
  def reachable?(url) do
    %{host: host, port: port} = target(url)
    listening?(host, port)
  end

  # --- readiness ----------------------------------------------------------

  defp await(server, deadline) do
    drain(server.port_ref, server.device)

    cond do
      listening?(server.host, server.port) -> :ok
      exited?(server.port_ref) -> {:error, {:dev_server_exited, server.log}}
      past?(deadline) -> {:error, {:timeout, server.log}}
      true -> Process.sleep(@poll_ms) && await(server, deadline)
    end
  end

  # Move any buffered output out of the mailbox and into the log file.
  defp drain(port_ref, device) do
    receive do
      {^port_ref, {:data, data}} ->
        if device, do: IO.binwrite(device, data)
        drain(port_ref, device)
    after
      0 -> :ok
    end
  end

  # Try every resolved address (IPv4 *and* IPv6). "localhost" often resolves to ::1
  # on Windows while dev servers bind there, so an IPv4-only probe gives false negatives.
  defp listening?(host, port) do
    host
    |> addresses()
    |> Enum.any?(&connectable?(&1, port))
  end

  defp addresses(host) do
    charlist = String.to_charlist(host)
    getaddrs(charlist, :inet) ++ getaddrs(charlist, :inet6)
  end

  defp getaddrs(host, family) do
    case :inet.getaddrs(host, family) do
      {:ok, addrs} -> addrs
      {:error, _} -> []
    end
  end

  defp connectable?(address, port) do
    case :gen_tcp.connect(address, port, [active: false], 400) do
      {:ok, socket} -> :gen_tcp.close(socket) == :ok
      {:error, _} -> false
    end
  end

  defp exited?(port_ref), do: is_nil(Port.info(port_ref))

  defp deadline(timeout_ms), do: System.monotonic_time(:millisecond) + timeout_ms
  defp past?(deadline), do: System.monotonic_time(:millisecond) > deadline

  # --- process spawning ---------------------------------------------------

  defp spawn_shell(command, cd) do
    {executable, prefix} = shell()

    Port.open({:spawn_executable, executable}, [
      :binary,
      :exit_status,
      :hide,
      {:cd, String.to_charlist(cd)},
      {:args, prefix ++ [command]}
    ])
  end

  defp shell do
    case :os.type() do
      {:win32, _} -> {System.find_executable("cmd"), ["/c"]}
      _ -> {"/bin/sh", ["-c"]}
    end
  end

  defp os_pid(port_ref) do
    case Port.info(port_ref, :os_pid) do
      {:os_pid, pid} -> pid
      _ -> nil
    end
  end

  # --- teardown -----------------------------------------------------------

  defp kill_tree(nil), do: :ok

  defp kill_tree(os_pid) do
    pid = Integer.to_string(os_pid)

    case :os.type() do
      {:win32, _} -> run("taskkill", ["/PID", pid, "/T", "/F"])
      _ -> run("pkill", ["-TERM", "-P", pid]) && run("kill", ["-TERM", pid])
    end

    :ok
  end

  defp close_device(nil), do: :ok
  defp close_device(device), do: File.close(device)

  defp close_port(port_ref) do
    if Port.info(port_ref), do: Port.close(port_ref)
    :ok
  rescue
    ArgumentError -> :ok
  end

  # Best-effort external command; never raises out of teardown.
  defp run(executable, args) do
    case System.find_executable(executable) do
      nil -> false
      _ -> match?({_, _}, System.cmd(executable, args, stderr_to_stdout: true))
    end
  rescue
    _ -> false
  end

  # --- helpers ------------------------------------------------------------

  defp target(url) do
    uri = URI.parse(url)
    %{host: uri.host || "localhost", port: uri.port || default_port(uri.scheme)}
  end

  defp default_port("https"), do: 443
  defp default_port(_), do: 80

  defp log_path do
    Path.join(System.tmp_dir!(), "vibeguru_devserver_#{System.unique_integer([:positive])}.log")
  end
end
