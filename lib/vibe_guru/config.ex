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
          flow: String.t() | nil,
          route_params: map(),
          route_expectations: map(),
          census_targets: [String.t()],
          thresholds: map()
        }

  defstruct url: nil,
            dev_command: nil,
            port: nil,
            cycles: 12,
            settle_ms: 400,
            routes_limit: 8,
            flow: nil,
            route_params: %{},
            route_expectations: %{},
            census_targets: [],
            thresholds: %{}

  @threshold_keys ~w(per_route_min_nodes per_route_min_listeners per_route_min_heap consistency_min recovery_leak recovery_slow_hi bundle_heap_bytes render_loop_mutations_per_s render_loop_consistency per_route_min_instances census_consistency_min)a

  @doc "Absolute path to the config file under `root`."
  @spec path(Path.t()) :: Path.t()
  def path(root), do: Path.join(root, @filename)

  @doc "Load and decode the config. Returns `{:error, :not_found}` when absent."
  @spec load(Path.t()) :: {:ok, t()} | {:error, :not_found | term()}
  def load(root) do
    file = path(root)

    with {:ok, body} <- read(file),
         {:ok, map} <- Jason.decode(body),
         :ok <- validate(map) do
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
      flow: c.flow,
      route_params: c.route_params,
      route_expectations: c.route_expectations,
      census_targets: c.census_targets,
      thresholds: c.thresholds
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
      flow: map["flow"],
      route_params: map["routeParams"] || map["route_params"] || %{},
      route_expectations: map["routeExpectations"] || %{},
      census_targets: map["censusTargets"] || map["census_targets"] || [],
      thresholds:
        Map.new(
          @threshold_keys |> Enum.filter(&is_number(get_in(map, ["thresholds", to_string(&1)]))),
          &{&1, map["thresholds"][to_string(&1)]}
        )
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
      "flow" => c.flow,
      "routeParams" => c.route_params,
      "routeExpectations" => c.route_expectations,
      "censusTargets" => c.census_targets,
      "thresholds" => c.thresholds
    }
  end

  defp read(file) do
    case File.read(file) do
      {:ok, body} -> {:ok, body}
      {:error, :enoent} -> {:error, :not_found}
      error -> error
    end
  end

  defp validate(map) when is_map(map) do
    valid =
      Enum.all?(~w(cycles settle_ms routes_limit), fn key ->
        is_nil(map[key]) or (is_integer(map[key]) and map[key] > 0)
      end) and
        Enum.all?(~w(routeParams route_params routeExpectations thresholds), fn key ->
          is_nil(map[key]) or is_map(map[key])
        end) and
        Enum.all?(~w(censusTargets census_targets), fn key ->
          is_nil(map[key]) or (is_list(map[key]) and Enum.all?(map[key], &is_binary/1))
        end) and
        Enum.all?(map["thresholds"] || %{}, fn {_k, v} -> is_number(v) and v >= 0 end)

    if valid, do: :ok, else: {:error, :invalid_config}
  end

  defp validate(_), do: {:error, :invalid_config}
end
