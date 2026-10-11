defmodule VibeGuru.CensusTargetsTest do
  use ExUnit.Case, async: true

  alias VibeGuru.{CensusTargets, StackProfile}

  defp profile(chart_libs), do: %StackProfile{chart_libs: chart_libs}

  describe "universal targets" do
    test "an app with no known libraries still gets the built-ins counted" do
      # Observers and sockets are leaked constantly and are invisible to every other
      # signature — they are neither DOM nodes nor registered event listeners.
      targets = CensusTargets.for_profile(profile([]))

      for class <- ~w(MutationObserver ResizeObserver IntersectionObserver WebSocket Worker) do
        assert class in targets
      end
    end

    test "a nil profile is safe — a run against a bare URL has no manifest" do
      assert CensusTargets.for_profile(nil) != []
    end
  end

  describe "library targets" do
    test "a chart library adds its own class" do
      assert "Chart" in CensusTargets.for_profile(profile([:chartjs]))
    end

    test "an app without that library is never asked about it" do
      # Each target costs CDP round trips on every sample. Asking a page about a class
      # it cannot have buys a guaranteed null.
      refute "Chart" in CensusTargets.for_profile(profile([]))
    end

    test "three.js contributes the classes that actually hold GPU memory" do
      targets = CensusTargets.for_profile(profile([:three]))

      assert "WebGLRenderer" in targets
      assert "Scene" in targets
      assert "Texture" in targets
    end

    test "an unrecognised library contributes nothing rather than guessing" do
      assert CensusTargets.for_profile(profile([:some_new_lib])) ==
               CensusTargets.for_profile(profile([]))
    end
  end

  describe "user-supplied targets" do
    test "a user's own class is included, and leads" do
      # Someone naming their own class knows something the detector does not, so it
      # survives the cap ahead of the generic built-ins.
      targets = CensusTargets.for_profile(profile([]), ["MyStore"])

      assert hd(targets) == "MyStore"
    end

    test "anything that is not a plain identifier is dropped" do
      # These names are about to be evaluated inside the page.
      targets =
        CensusTargets.for_profile(profile([]), [
          "fetch('/steal')",
          "a; b",
          "window.location='x'",
          "  Spaced  ",
          "",
          nil,
          42
        ])

      assert "Spaced" in targets
      refute Enum.any?(targets, &String.contains?(&1, "("))
      refute Enum.any?(targets, &String.contains?(&1, ";"))
      refute Enum.any?(targets, &String.contains?(&1, "="))
    end

    test "a dotted namespace is allowed" do
      assert "THREE.Mesh" in CensusTargets.for_profile(profile([]), ["THREE.Mesh"])
    end
  end

  describe "cost control" do
    test "the list is capped, because targets multiply by routes and cycles" do
      extra = Enum.map(1..50, &"Custom#{&1}")
      targets = CensusTargets.for_profile(profile([:chartjs, :three]), extra)

      assert length(targets) <= 12
    end

    test "no class is asked about twice" do
      targets = CensusTargets.for_profile(profile([:chartjs]), ["Chart", "Chart"])

      assert targets == Enum.uniq(targets)
    end
  end

  test "known/0 lists every class this module can ask for" do
    known = CensusTargets.known()

    assert "Chart" in known
    assert "WebSocket" in known
    assert known == Enum.uniq(known)
  end
end
