defmodule VibeGuru.CoverageTest do
  use ExUnit.Case, async: true

  alias VibeGuru.{Coverage, Evidence}

  defp evidence(data) do
    [Evidence.new(:"memory.client", :coverage, phase: :cooldown, data: data)]
  end

  defp unreachable(path, reason, detail \\ nil),
    do: %{"path" => path, "reason" => reason, "detail" => detail}

  describe "from_evidence/1" do
    test "returns nil when a run produced no coverage evidence" do
      # Older runs, and flow-mode runs, carry no coverage. Callers must be able to
      # tell "not measured" from "measured and bad".
      assert Coverage.from_evidence([]) == nil
    end

    test "counts what was reached against what was known" do
      c =
        Coverage.from_evidence(
          evidence(%{
            "declared" => 10,
            "discovered" => 4,
            "visited" => ["/", "/about"],
            "unreachable" => [unreachable("/admin", "auth_required")]
          })
        )

      assert c.declared == 10
      assert c.discovered == 4
      assert c.known == 3
      assert_in_delta c.ratio, 2 / 3, 0.001
    end

    test "survives a malformed or partial payload" do
      c = Coverage.from_evidence(evidence(%{}))

      assert c.visited == []
      assert c.known == 0
      assert c.ratio == 1.0
    end
  end

  describe "low?/1" do
    test "unmeasured coverage is not treated as low" do
      refute Coverage.low?(nil)
    end

    test "reaching nothing is always low" do
      c = Coverage.from_evidence(evidence(%{"visited" => [], "unreachable" => []}))
      assert Coverage.low?(c)
    end

    test "full coverage is not low" do
      c = Coverage.from_evidence(evidence(%{"visited" => ["/", "/a", "/b"]}))
      refute Coverage.low?(c)
    end

    test "a minority of routes reached is low" do
      c =
        Coverage.from_evidence(
          evidence(%{
            "visited" => ["/"],
            "unreachable" => Enum.map(1..9, &unreachable("/r#{&1}", "auth_required"))
          })
        )

      assert Coverage.low?(c)
    end
  end

  describe "summary/1" do
    test "names both the numerator and the denominator" do
      c =
        Coverage.from_evidence(
          evidence(%{
            "visited" => ["/", "/a", "/b"],
            "unreachable" => [unreachable("/c", "dynamic"), unreachable("/d", "dynamic")]
          })
        )

      assert Coverage.summary(c) == "Exercised 3 of 5 routes (60%)."
    end

    test "says so plainly when nothing could be exercised" do
      c = Coverage.from_evidence(evidence(%{"visited" => []}))

      assert Coverage.summary(c) =~ "No routes could be exercised"
    end
  end

  describe "gaps/1" do
    test "no gaps when everything was reached" do
      assert Coverage.gaps(Coverage.from_evidence(evidence(%{"visited" => ["/"]}))) == []
    end

    test "auth walls are named as such, because the fix is different" do
      c =
        Coverage.from_evidence(
          evidence(%{
            "visited" => ["/"],
            "unreachable" => [unreachable("/admin", "auth_required")]
          })
        )

      [gap] = Coverage.gaps(c)

      assert gap =~ "1 route"
      assert gap =~ "sign-in"
      assert gap =~ "/admin"
    end

    test "dynamic routes point at the setting that would fix them" do
      c =
        Coverage.from_evidence(
          evidence(%{
            "visited" => ["/"],
            "unreachable" => [unreachable("/users/[id]", "dynamic")]
          })
        )

      assert hd(Coverage.gaps(c)) =~ "routeParams"
    end

    test "causes are grouped and ordered by how much they account for" do
      c =
        Coverage.from_evidence(
          evidence(%{
            "visited" => ["/"],
            "unreachable" => [
              unreachable("/a", "over_limit"),
              unreachable("/admin", "auth_required"),
              unreachable("/b", "over_limit"),
              unreachable("/c", "over_limit")
            ]
          })
        )

      [first, second] = Coverage.gaps(c)

      assert first =~ "3 routes"
      assert first =~ "route limit"
      assert second =~ "1 route"
      assert second =~ "sign-in"
    end

    test "long lists are truncated rather than dumped" do
      c =
        Coverage.from_evidence(
          evidence(%{
            "visited" => ["/"],
            "unreachable" => Enum.map(1..12, &unreachable("/r#{&1}", "over_limit"))
          })
        )

      gap = hd(Coverage.gaps(c))

      assert gap =~ "12 routes"
      assert gap =~ "…"
    end

    test "an unrecognised reason still produces a usable line" do
      c =
        Coverage.from_evidence(
          evidence(%{"visited" => ["/"], "unreachable" => [unreachable("/x", "some_new_reason")]})
        )

      assert hd(Coverage.gaps(c)) =~ "some_new_reason"
      assert hd(Coverage.gaps(c)) =~ "/x"
    end
  end

  describe "to_map/1" do
    test "carries the low flag so consumers need not recompute the threshold" do
      c =
        Coverage.from_evidence(
          evidence(%{
            "visited" => ["/"],
            "unreachable" => Enum.map(1..9, &unreachable("/r#{&1}", "auth_required"))
          })
        )

      map = Coverage.to_map(c)

      assert map.low == true
      assert map.routes_known == 10
      assert map.ratio == 0.1
    end

    test "nil coverage maps to nil, not an empty report" do
      assert Coverage.to_map(nil) == nil
    end
  end
end
