defmodule VibeGuru.DashboardFormatterTest do
  use ExUnit.Case, async: false

  setup do
    root =
      Path.join(System.tmp_dir!(), "vibeguru_formatter_#{System.unique_integer([:positive])}")

    File.mkdir_p!(root)
    {:ok, formatter} = GenServer.start_link(VibeGuru.DashboardFormatter, dashboard_root: root)

    on_exit(fn ->
      if Process.alive?(formatter), do: GenServer.stop(formatter)
      assert Path.dirname(Path.expand(root)) == Path.expand(System.tmp_dir!())
      assert String.starts_with?(Path.basename(root), "vibeguru_formatter_")
      File.rm_rf!(root)
    end)

    %{root: root, formatter: formatter}
  end

  defp finish(formatter, root) do
    GenServer.cast(formatter, {:suite_finished, %{run: 10}})
    state = :sys.get_state(formatter)
    path = Path.join([root, "reports", "test-history", state.record.id <> ".json"])
    path |> File.read!() |> Jason.decode!()
  end

  test "failed setup and failed assertions remain failed instead of skipped", context do
    failed = %ExUnit.Test{
      module: __MODULE__,
      name: :assertion,
      tags: %{},
      state: {:failed, [{:error, RuntimeError.exception("expected assertion failure"), []}]}
    }

    invalid = %{failed | name: :setup, state: {:invalid, %{state: "failed setup"}}}
    skipped = %{failed | name: :excluded, state: {:skipped, "explicitly skipped"}}

    for test <- [failed, invalid, skipped],
        do: GenServer.cast(context.formatter, {:test_finished, test})

    report = finish(context.formatter, context.root)
    assert report["status"] == "FAIL"
    assert report["tests"] == 3
    assert report["failed"] == 2
    assert report["skipped"] == 1

    assert Enum.any?(
             report["failures"],
             &String.contains?(&1["message"], "expected assertion failure")
           )

    assert Enum.any?(
             report["failures"],
             &String.contains?(&1["message"], "Test did not complete")
           )
  end

  test "no executed tests cannot PASS, and passed doctests retain their count", context do
    assert finish(context.formatter, context.root)["status"] == "ERROR"

    test = %ExUnit.Test{
      module: __MODULE__,
      name: :example,
      tags: %{test_type: :doctest},
      state: nil
    }

    GenServer.cast(context.formatter, {:test_finished, test})
    report = finish(context.formatter, context.root)
    assert report["status"] == "PASS"
    assert report["passed"] == 1
    assert report["doctests"] == 1
  end

  test "repository scope is explicit rather than inferred from a passed subset", context do
    {:ok, formatter} =
      GenServer.start_link(VibeGuru.DashboardFormatter,
        dashboard_root: context.root,
        dashboard_scope: "repository"
      )

    report = finish(formatter, context.root)
    assert report["scope"] == "repository"
    assert report["command"] == "mix test"
    GenServer.stop(formatter)
  end
end
