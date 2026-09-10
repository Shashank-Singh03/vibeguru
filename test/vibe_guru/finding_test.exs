defmodule VibeGuru.FindingTest do
  use ExUnit.Case, async: true

  alias VibeGuru.Finding

  defp finding(signature, severity) do
    %Finding{
      id: "test.#{signature}",
      vector: :test,
      signature: signature,
      severity: severity,
      title: "#{signature} title"
    }
  end

  defp severities(findings), do: Enum.map(findings, & &1.severity)

  describe "sort/1" do
    test "orders most severe first" do
      findings = [
        finding(:a, :low),
        finding(:b, :critical),
        finding(:c, :medium),
        finding(:d, :info),
        finding(:e, :high)
      ]

      assert severities(Finding.sort(findings)) == [:critical, :high, :medium, :low, :info]
    end

    test "is stable within a severity" do
      findings = [finding(:first, :high), finding(:second, :high), finding(:third, :high)]

      assert Enum.map(Finding.sort(findings), & &1.signature) == [:first, :second, :third]
    end

    test "concatenating two already-sorted lists does NOT give a sorted list" do
      # The trap this guards against. Every analyzer sorts what it returns, so it is
      # tempting to treat the concatenation as sorted — it is not, and a consumer that
      # promises "most severe first" would then be lying.
      memory = Finding.sort([finding(:leak, :high), finding(:slow, :low)])
      runtime = Finding.sort([finding(:crash, :critical), finding(:log, :high)])

      assert severities(memory ++ runtime) == [:high, :low, :critical, :high]
      assert severities(Finding.sort(memory ++ runtime)) == [:critical, :high, :high, :low]
    end

    test "handles an empty list" do
      assert Finding.sort([]) == []
    end
  end

  describe "to_map/1" do
    test "round-trips the fields a reporter and an agent both need" do
      f = %{finding(:listener_leak, :high) | metrics: %{count: 3}, fix: %{summary: "remove it"}}
      map = Finding.to_map(f)

      assert map.signature == :listener_leak
      assert map.severity == :high
      assert map.metrics == %{count: 3}
      assert map.fix == %{summary: "remove it"}
      assert Map.has_key?(map, :ai_prompt)
    end
  end
end
