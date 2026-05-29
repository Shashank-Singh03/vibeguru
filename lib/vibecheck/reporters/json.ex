defmodule Vibecheck.Reporter.Json do
  @moduledoc """
  Writes `vibecheck-findings.json` — the machine-readable artifact for piping into
  other tools or programmatic consumption. Includes the detected profile, a severity
  summary, and the full findings (each with its `ai_prompt`).
  """

  @behaviour Vibecheck.Reporter

  alias Vibecheck.{Finding, StackProfile}

  @impl true
  def id, do: :json

  @impl true
  def render(findings, config) do
    out_dir = Map.fetch!(config, :out_dir)
    path = Path.join(out_dir, "vibecheck-findings.json")

    payload = %{
      tool: "vibecheck",
      schema_version: 1,
      vector: Map.get(config, :vector, "memory.client"),
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      profile: profile_map(config[:profile]),
      summary: summary(findings),
      evidence_count: length(Map.get(config, :evidence, [])),
      findings: Enum.map(findings, &Finding.to_map/1)
    }

    case File.write(path, Jason.encode!(payload, pretty: true)) do
      :ok -> {:ok, path}
      {:error, reason} -> {:error, reason}
    end
  end

  defp profile_map(%StackProfile{} = p), do: StackProfile.to_map(p)
  defp profile_map(_), do: nil

  defp summary(findings) do
    by_sev = Enum.frequencies_by(findings, & &1.severity)

    %{
      total: length(findings),
      by_severity: by_sev
    }
  end
end
