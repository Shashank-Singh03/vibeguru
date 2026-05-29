defmodule VibeGuru.Config do
  @moduledoc """
  The `vibeguru.json` project config — written by `vibeguru init`, read by `vibeguru run`.

  It exists so the second step is zero-argument: everything the run needs (target URL,
  how to start the app, how hard to push) lives here. Unknown keys are ignored on load
  so the file stays forward-compatible.
  """

  @filename "vibeguru.json"

  @type t :: %__MODULE__{
          url: String.t() | nil,
          dev_command: String.t() | nil,
          port: pos_integer() | nil,
          cycles: pos_integer(),
          settle_ms: pos_integer(),
          routes_limit: pos_integer(),
          flow: String.t() | nil
        }

  defstruct url: nil,
            dev_command: nil,
            port: nil,
            cycles: 12,
            settle_ms: 400,
            routes_limit: 8,
            flow: nil

  @doc "Absolute path to the config file under `root`."
  @spec path(Path.t()) :: Path.t()
  def path(root), do: Path.join(root, @filename)

  @doc "Load and decode the config. Returns `{:error, :not_found}` when absent."
  @spec load(Path.t()) :: {:ok, t()} | {:error, :not_found | term()}
  def load(root) do
    file = path(root)

    with {:ok, body} <- read(file),
         {:ok, map} <- Jason.decode(body) do
      {:ok, from_map(map)}
    end
  end

  @doc "Serialize the config to `root/vibeguru.json` (pretty JSON)."
  @spec save(t(), Path.t()) :: {:ok, Path.t()} | {:error, term()}
  def save(%__MODULE__{} = config, root) do
    file = path(root)

    case File.write(file, Jason.encode!(to_map(config), pretty: true) <> "\n") do
      :ok -> {:ok, file}
      error -> error
    end
  end

  @doc "Translate the config into keyword options for `VibeGuru.Pipeline.memory_client/2`."
  @spec to_run_opts(t()) :: keyword()
  def to_run_opts(%__MODULE__{} = c) do
    [
      cycles: c.cycles,
      settle_ms: c.settle_ms,
      routes_limit: c.routes_limit,
      flow: c.flow
    ]
  end

  # --- mapping ------------------------------------------------------------

  defp from_map(map) do
    %__MODULE__{
      url: map["url"],
      dev_command: map["dev_command"],
      port: map["port"],
      cycles: map["cycles"] || %__MODULE__{}.cycles,
      settle_ms: map["settle_ms"] || %__MODULE__{}.settle_ms,
      routes_limit: map["routes_limit"] || %__MODULE__{}.routes_limit,
      flow: map["flow"]
    }
  end

  defp to_map(%__MODULE__{} = c) do
    %{
      "url" => c.url,
      "dev_command" => c.dev_command,
      "port" => c.port,
      "cycles" => c.cycles,
      "settle_ms" => c.settle_ms,
      "routes_limit" => c.routes_limit,
      "flow" => c.flow
    }
  end

  defp read(file) do
    case File.read(file) do
      {:ok, body} -> {:ok, body}
      {:error, :enoent} -> {:error, :not_found}
      error -> error
    end
  end
end
