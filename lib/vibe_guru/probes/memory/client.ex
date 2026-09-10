defmodule VibeGuru.Probes.Memory.Client do
  @moduledoc """
  The `memory.client` probe — gathers frontend evidence by driving a headless Chrome
  through the Node/Playwright/CDP sidecar in `driver-node/`.

  `VibeGuru.Driver` owns the mechanics of talking to that sidecar. What lives here is
  the vector's own vocabulary: the config the driver needs for this kind of run, and
  how to turn its raw events into `VibeGuru.Evidence`.

  Returns raw evidence only — interpretation is the analyzer's job.
  """

  @behaviour VibeGuru.Probe

  alias VibeGuru.{Driver, Evidence}

  @impl true
  def id, do: :"memory.client"

  @impl true
  def applies_to?(%{surface: surface}), do: surface in [:frontend, :fullstack, :unknown]

  @impl true
  def cost, do: :expensive

  @impl true
  def run(profile, config) do
    opts = [
      on_log: Map.get(config, :on_log, fn _ -> :ok end),
      timeout_ms: Map.get(config, :timeout_ms, 600_000),
      driver_path: Map.get(config, :driver_path)
    ]

    case Driver.run(driver_config(profile, config), opts) do
      {:ok, %{events: events}} -> {:ok, Enum.map(events, &to_evidence/1)}
      {:error, reason} -> {:error, reason}
    end
  end

  # --- config -------------------------------------------------------------

  defp driver_config(profile, config) do
    %{
      "url" => profile.url,
      "mode" => to_string(Map.get(config, :mode, "auto")),
      "cycles" => Map.get(config, :cycles, 20),
      "settleMs" => Map.get(config, :settle_ms, 500),
      "routesLimit" => Map.get(config, :routes_limit, 8),
      "headless" => Map.get(config, :headless, true),
      "flow" => Map.get(config, :flow, nil),
      # Routes read from the app's own source. The driver visits these in addition
      # to whatever it can discover by crawling, and reports which it could not
      # reach — that gap is the coverage number.
      "declaredRoutes" => Enum.map(profile.declared_routes || [], &declared_route/1),
      # Values for dynamic segments, e.g. %{"id" => "1"}. Without them a route like
      # /users/[id] cannot be visited and is counted as uncovered rather than guessed.
      "routeParams" => Map.get(config, :route_params, %{}),
      # A session saved by `vibeguru auth`, so routes behind a login are reachable.
      "storageState" => Map.get(config, :storage_state)
    }
  end

  defp declared_route(%{path: path, dynamic: dynamic}),
    do: %{"path" => path, "dynamic" => dynamic}

  defp declared_route(path) when is_binary(path), do: %{"path" => path, "dynamic" => false}

  # --- event mapping ------------------------------------------------------

  # Safe, whitelisted string→atom mapping (never String.to_atom on dynamic input).
  @kinds %{
    "sample" => :sample,
    "snapshot" => :snapshot,
    "profile" => :profile,
    "config" => :config,
    "marker" => :marker,
    "runtime_event" => :runtime_event,
    "coverage" => :coverage
  }
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
end
