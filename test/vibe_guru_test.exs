defmodule VibeGuruTest do
  use ExUnit.Case
  doctest VibeGuru

  test "greets the world" do
    assert VibeGuru.hello() == :world
  end
end
