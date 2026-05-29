defmodule VibeGuru.Project do
  @moduledoc """
  Detects how to *run* the target app — the dev command and the URL it serves on —
  purely from `package.json`. This is the runtime counterpart to `VibeGuru.Detector`
  (which describes the app for analysis); together they let `vibeguru init` write a
  complete config with zero questions in the common case.
  """

  alias VibeGuru.Detector.Stack

  @dev_script_candidates ~w(dev start develop serve)
  @default_ports %{vite: 5173, next: 3000, cra: 3000, webpack: 8080}
  @fallback_port 3000

  @type t :: %{
          framework: atom(),
          bundler: atom() | nil,
          dev_command: String.t() | nil,
          port: pos_integer(),
          url: String.t()
        }

  @doc "Detect framework, dev command and serving URL for the project at `root`."
  @spec detect(Path.t()) :: t()
  def detect(root) do
    stack = Stack.detect(root)
    {dev_command, script_value} = dev_command(scripts(root))
    port = port_from_command(script_value) || default_port(stack.bundler)

    %{
      framework: stack.stack,
      bundler: stack.bundler,
      dev_command: dev_command,
      port: port,
      url: "http://localhost:#{port}"
    }
  end

  # --- internals ----------------------------------------------------------

  defp scripts(root) do
    with {:ok, body} <- File.read(Path.join(root, "package.json")),
         {:ok, %{"scripts" => scripts}} when is_map(scripts) <- Jason.decode(body) do
      scripts
    else
      _ -> %{}
    end
  end

  # Returns {command_to_run, script_value} or {nil, nil}. We run the script via npm
  # (`npm run dev`) but parse the port from the script's *value* (`vite --port 5173`).
  defp dev_command(scripts) do
    case Enum.find(@dev_script_candidates, &Map.has_key?(scripts, &1)) do
      nil -> {nil, nil}
      name -> {"npm run #{name}", scripts[name]}
    end
  end

  defp port_from_command(nil), do: nil

  defp port_from_command(script) do
    case Regex.run(~r/(?:--port[=\s]+|-p\s+)(\d{2,5})/, script) do
      [_, port] -> String.to_integer(port)
      nil -> nil
    end
  end

  defp default_port(bundler), do: Map.get(@default_ports, bundler, @fallback_port)
end
