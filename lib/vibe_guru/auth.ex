defmodule VibeGuru.Auth do
  @moduledoc """
  Capture a signed-in session once, so later runs can see past the login.

  Coverage reporting made the problem visible — runs began saying "12 routes
  redirected to a sign-in page" instead of quietly calling three routes healthy — but
  naming the wall is not getting past it. Most of an app worth testing lives behind
  one.

  The flow deliberately involves no credentials. `vibeguru auth` opens a real browser
  at the app; the person signs in the way they always do, directly with their own app;
  and what gets kept is the resulting cookies and localStorage. This tool never asks
  for, types, stores, or transmits a password.

  ## The saved file is a live session

  `.vibeguru/auth.json` is equivalent to being logged in. Anyone holding it is
  logged in. So the directory ships with its own `.gitignore` containing `*` — a
  self-ignoring directory, which protects the file without editing (or depending on)
  the project's own ignore rules.
  """

  alias VibeGuru.Driver

  @dir ".vibeguru"
  # NOT @file — that is a reserved module attribute Elixir uses for stacktraces.
  @session_file "auth.json"

  # Long enough to find the password manager, do 2FA, and get distracted once.
  @default_timeout_ms 600_000

  @doc "Where a project's saved session lives."
  @spec path(String.t()) :: String.t()
  def path(root), do: Path.join([root, @dir, @session_file])

  @doc "Whether this project already has a saved session."
  @spec exists?(String.t()) :: boolean()
  def exists?(root), do: File.exists?(path(root))

  @doc """
  The saved session path if there is one, else nil — the shape the driver config
  wants, so callers can pass it straight through.
  """
  @spec session(String.t() | nil) :: String.t() | nil
  def session(nil), do: nil
  def session(root), do: if(exists?(root), do: path(root), else: nil)

  @doc """
  Open a browser at `url`, wait for the person to sign in and close it, and save the
  resulting session under `root`.

  Options: `:on_log`, `:timeout_ms`.
  """
  @spec capture(String.t(), String.t(), keyword()) ::
          {:ok, %{path: String.t(), cookies: non_neg_integer(), origins: non_neg_integer()}}
          | {:error, term()}
  def capture(url, root, opts \\ []) do
    timeout = Keyword.get(opts, :timeout_ms, @default_timeout_ms)

    config = %{
      "url" => url,
      "mode" => "auth",
      "headless" => false,
      "timeoutMs" => timeout
    }

    driver_opts = [
      on_log: Keyword.get(opts, :on_log, fn _ -> :ok end),
      # The driver is waiting on a human, so the port must outlast the browser's own
      # timeout rather than killing it midway through someone's 2FA.
      timeout_ms: timeout + 60_000
    ]

    with {:ok, %{result: result}} <- Driver.run(config, driver_opts),
         {:ok, state} <- session_from(result),
         {:ok, dest} <- write_session(root, state) do
      {:ok,
       %{
         path: dest,
         cookies: Map.get(result, "cookies", 0),
         origins: Map.get(result, "origins", 0)
       }}
    end
  end

  defp session_from(%{"storageState" => state}) when is_map(state), do: {:ok, state}
  defp session_from(_), do: {:error, :no_session_captured}

  @doc """
  Save a Playwright storage state under `root`, creating the protected directory.

  Public because it is the half of `capture/3` worth testing without a browser and a
  human, and because a session obtained some other way should be storable too.
  """
  @spec save(String.t(), map()) :: {:ok, String.t()} | {:error, term()}
  def save(root, state) when is_map(state), do: write_session(root, state)

  defp write_session(root, state) do
    dir = Path.join(root, @dir)

    with :ok <- File.mkdir_p(dir),
         :ok <- protect(dir),
         :ok <- File.write(Path.join(dir, @session_file), Jason.encode!(state, pretty: true)) do
      {:ok, path(root)}
    else
      {:error, reason} -> {:error, {:session_write_failed, reason}}
    end
  end

  # A self-ignoring directory. Committing a live session to a repo would be a real
  # security incident, and this guarantees it without touching the project's own
  # .gitignore or relying on the user having read a warning.
  defp protect(dir) do
    File.write(Path.join(dir, ".gitignore"), "# Contains a live session. Never commit.\n*\n")
  end
end
