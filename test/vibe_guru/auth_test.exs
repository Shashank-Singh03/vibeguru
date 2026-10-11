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

    test "the directory ignores itself to reduce accidental live-session commits", %{root: root} do
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

    @tag skip: match?({:win32, _}, :os.type())
    test "Unix session directory and file are private, including after replacement", %{root: root} do
      import Bitwise
      dir = Path.join(root, ".vibeguru")
      File.mkdir_p!(dir)
      File.chmod!(dir, 0o755)
      assert {:ok, session} = Auth.save(root, state())
      assert band(File.stat!(dir).mode, 0o777) == 0o700
      assert band(File.stat!(session).mode, 0o777) == 0o600
      File.chmod!(session, 0o644)
      assert {:ok, ^session} = Auth.save(root, state())
      assert band(File.stat!(session).mode, 0o777) == 0o600
      assert Enum.sort(File.ls!(dir)) == [".gitignore", "auth.json"]
    end

    @tag skip: match?({:win32, _}, :os.type())
    test "a linked session directory is rejected without changing its target", %{root: root} do
      target = Path.join(root, "external")
      File.mkdir!(target)
      File.ln_s!(target, Path.join(root, ".vibeguru"))

      assert {:error, {:session_write_failed, :unsafe_session_directory}} =
               Auth.save(root, state())

      assert File.ls!(target) == []
    end

    @tag skip: match?({:win32, _}, :os.type())
    test "atomic session and ignore-file replacement never follows existing file links", %{
      root: root
    } do
      dir = Path.join(root, ".vibeguru")
      File.mkdir_p!(dir)
      target = Path.join(root, "untouched.txt")
      File.write!(target, "keep")
      File.ln_s!(target, Path.join(dir, "auth.json"))
      File.ln_s!(target, Path.join(dir, ".gitignore"))
      assert {:ok, _} = Auth.save(root, state())
      assert File.read!(target) == "keep"
      assert File.lstat!(Path.join(dir, "auth.json")).type == :regular
      assert File.lstat!(Path.join(dir, ".gitignore")).type == :regular
    end
  end
end
