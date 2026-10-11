defmodule VibeGuru.DriverSecurityTest do
  use ExUnit.Case, async: true
  alias VibeGuru.Driver

  @fixture Path.expand("../fixtures/security-driver.cjs", __DIR__)

  test "driver config uses a random private scratch directory and is removed after execution" do
    assert {:ok, first} = Driver.run(%{"url" => "http://127.0.0.1"}, driver_path: @fixture)
    assert {:ok, second} = Driver.run(%{"url" => "http://127.0.0.1"}, driver_path: @fixture)
    paths = [first.result["configPath"], second.result["configPath"]]
    refute hd(paths) == List.last(paths)

    for path <- paths do
      assert Path.basename(path) == "config.json"
      assert Path.basename(Path.dirname(path)) =~ ~r/^vibeguru-driver-[A-Za-z0-9_-]{22}$/
      refute File.exists?(path)
      refute File.exists?(Path.dirname(path))
    end
  end

  @tag skip: match?({:win32, _}, :os.type())
  test "Unix config-file contents and directory are accessible only to the owner" do
    assert {:ok, run} = Driver.run(%{}, driver_path: @fixture)
    assert run.result["mode"] == 0o600
    assert run.result["dirMode"] == 0o700
  end
end
