defmodule VibeGuru.CLI.Auth do
  @moduledoc """
  `vibeguru auth` — sign in once, so later runs can reach the app behind the login.

  Starts the dev server if it is not already up (the same way `run` does — being
  asked to start your own server first is a pointless step), opens a real browser,
  and waits. Nothing is typed on the user's behalf.
  """

  alias VibeGuru.{Auth, Config, DevServer}
  alias VibeGuru.CLI.Presenter

  @switches [root: :string, url: :string, timeout: :integer]
  @dev_server_timeout_ms 90_000

  @spec run([String.t()]) :: :ok | {:halt, non_neg_integer()}
  def run(argv) do
    {opts, _args, _invalid} = OptionParser.parse(argv, switches: @switches)
    root = Keyword.get(opts, :root, File.cwd!())

    case target(opts, root) do
      {:ok, url, config} -> authenticate(url, root, config, opts)
      {:error, reason} -> Presenter.error(reason)
    end
  end

  # An explicit --url wins; otherwise fall back to what init detected.
  defp target(opts, root) do
    case {Keyword.get(opts, :url), Config.load(root)} do
      {url, {:ok, config}} when is_binary(url) -> {:ok, url, config}
      {nil, {:ok, config}} -> from_config(config)
      {url, _} when is_binary(url) -> {:ok, url, %Config{}}
      {nil, {:error, :not_found}} -> {:error, :no_config_for_auth}
      {nil, {:error, reason}} -> {:error, reason}
    end
  end

  defp from_config(%Config{url: url} = config) when is_binary(url), do: {:ok, url, config}

  defp from_config(%Config{port: port} = config) when is_integer(port),
    do: {:ok, "http://localhost:#{port}", config}

  defp from_config(_), do: {:error, :no_target}

  defp authenticate(url, root, config, opts) do
    Presenter.auth_banner(url, Auth.exists?(root))

    with_target(config, url, root, opts, fn ->
      timeout = Keyword.get(opts, :timeout, 600_000)

      case Auth.capture(url, root, on_log: Presenter.log_fn(false), timeout_ms: timeout) do
        {:ok, saved} -> Presenter.auth_saved(saved)
        {:error, reason} -> Presenter.error(reason)
      end
    end)
  end

  # Same contract as `run`: start a dev server only if nothing is already serving,
  # and stop whatever we started.
  defp with_target(config, url, root, opts, fun) do
    cond do
      DevServer.reachable?(url) ->
        fun.()

      is_binary(config.dev_command) ->
        Presenter.info("  starting dev server: #{config.dev_command}")
        timeout = Keyword.get(opts, :timeout, @dev_server_timeout_ms)

        case DevServer.start(config.dev_command, url, cd: root, timeout_ms: timeout) do
          {:ok, server} ->
            Presenter.info("  dev server ready at #{url}")

            try do
              fun.()
            after
              DevServer.stop(server)
            end

          {:error, reason} ->
            Presenter.error({:dev_server, reason})
        end

      true ->
        Presenter.error(:no_target)
    end
  end
end
