defmodule VibeGuru.AuthTest do
  use ExUnit.Case, async: true

  alias VibeGuru.Auth

  setup do
    root = Path.join(System.tmp_dir!(), "vg_auth_#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf(root) end)
    {:ok, root: root}
  end

  defp state, do: %{"cookies" => [%{"name" => "sid", "value" => "abc"}], "origins" => []}

  describe "locating a session" do
    test "path is inside the project, under .vibeguru", %{root: root} do
      assert Auth.path(root) == Path.join([root, ".vibeguru", "auth.json"])
    end

    test "a project with no session reports none", %{root: root} do
      refute Auth.exists?(root)
      assert Auth.session(root) == nil
    end

    test "session/1 tolerates a nil root", %{root: _root} do
      # A run against a bare URL has no project directory at all.
      assert Auth.session(nil) == nil
    end

    test "once saved, the session is found", %{root: root} do
      {:ok, _} = Auth.save(root, state())

      assert Auth.exists?(root)
      assert Auth.session(root) == Auth.path(root)
    end
  end

  describe "save/2" do
    test "writes the state as readable JSON", %{root: root} do
      {:ok, path} = Auth.save(root, state())

      assert File.exists?(path)
      assert {:ok, decoded} = path |> File.read!() |> Jason.decode()
      assert decoded == state()
    end

    test "the directory ignores itself, so a live session cannot be committed", %{root: root} do
      # This is the security property, not a nicety: the file is equivalent to being
      # logged in, and it must be safe even in a repo whose .gitignore we never touch.
      {:ok, _} = Auth.save(root, state())

      ignore = Path.join([root, ".vibeguru", ".gitignore"])
      assert File.exists?(ignore)

      contents = File.read!(ignore)
      assert contents =~ "*"
      assert contents =~ "Never commit"
    end

    test "saving again replaces the previous session", %{root: root} do
      {:ok, _} = Auth.save(root, state())
      {:ok, path} = Auth.save(root, %{"cookies" => [], "origins" => [%{"origin" => "http://x"}]})

      decoded = path |> File.read!() |> Jason.decode!()
      assert decoded["cookies"] == []
      assert length(decoded["origins"]) == 1
    end

    test "creates the directory when it does not exist", %{root: root} do
      refute File.dir?(Path.join(root, ".vibeguru"))
      assert {:ok, _} = Auth.save(root, state())
      assert File.dir?(Path.join(root, ".vibeguru"))
    end
  end
end
