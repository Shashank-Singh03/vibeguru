defmodule VibeGuru.CLI.Run do
  @moduledoc """
  `vibeguru run` — step two. Loads `vibeguru.json`, makes sure the target is reachable
  (starting the dev server if needed), runs the `memory.client` pipeline, prints the
  summary, and tears any dev server it started back down.

  Also hosts the low-level `memory:client <url>` entry, which skips config and autostart.
  """

  alias VibeGuru.{Config, DevServer, Pipeline}
  alias VibeGuru.CLI.Presenter

  @switches [
    root: :string,
    out: :string,
    cycles: :integer,
    settle: :integer,
    routes: :integer,
    flow: :string,
    headless: :boolean,
    quiet: :boolean,
    timeout: :integer
  ]

  @dev_server_timeout_ms 90_000

  @doc "Config-driven run (`vibeguru run`)."
  @spec run([String.t()]) :: :ok | {:halt, non_neg_integer()}
  def run(argv) do
    {opts, _args, _invalid} = OptionParser.parse(argv, switches: @switches)
    root = Keyword.get(opts, :root, File.cwd!())

    case Config.load(root) do
      {:ok, config} -> execute(config, opts, root)
      {:error, :not_found} -> Presenter.no_config(root)
      {:error, reason} -> Presenter.error(reason)
    end
  end

  @doc "Low-level run against an already-running URL (`vibeguru memory:client <url>`)."
  @spec direct(String.t(), [String.t()]) :: :ok | {:halt, non_neg_integer()}
  def direct(url, argv) do
    {opts, _args, _invalid} = OptionParser.parse(argv, switches: @switches)
    out_dir = Keyword.get(opts, :out, File.cwd!())
    root = Keyword.get(opts, :root, File.cwd!())

    Presenter.banner(url)
    run_pipeline(url, pipeline_opts(%Config{}, opts, root, out_dir))
  end

  # --- config-driven path -------------------------------------------------

  defp execute(config, opts, root) do
    out_dir = Keyword.get(opts, :out, root)

    case target_url(config) do
      nil ->
        Presenter.error(:no_target)

      url ->
        Presenter.banner(url)

        with_target(config, url, root, opts, fn ->
          run_pipeline(url, pipeline_opts(config, opts, root, out_dir))
        end)
    end
  end

  # Ensure something is serving `url`, run `fun`, then stop anything we started.
  defp with_target(config, url, root, opts, fun) do
    case ensure_target(config, url, root, opts) do
      {:ok, stop} ->
        try do
          fun.()
        after
          stop.()
        end

      {:error, reason} ->
        Presenter.error(reason)
    end
  end

  # Returns {:ok, stop_fun}. stop_fun is a noop unless we started a dev server.
  defp ensure_target(config, url, root, opts) do
    cond do
      DevServer.reachable?(url) ->
        {:ok, fn -> :ok end}

      is_binary(config.dev_command) ->
        start_dev_server(config.dev_command, url, root, opts)

      true ->
        {:error, :no_target}
    end
  end

  defp start_dev_server(command, url, root, opts) do
    Presenter.info("  starting dev server: #{command}")
    timeout = Keyword.get(opts, :timeout, @dev_server_timeout_ms)

    case DevServer.start(command, url, cd: root, timeout_ms: timeout) do
      {:ok, server} ->
        Presenter.info("  dev server ready at #{url}")
        {:ok, fn -> DevServer.stop(server) end}

      {:error, reason} ->
        {:error, {:dev_server, reason}}
    end
  end

  # --- shared -------------------------------------------------------------

  defp run_pipeline(url, run_opts) do
    case Pipeline.memory_client(url, run_opts) do
      {:ok, result} ->
        Presenter.summary(result, Keyword.fetch!(run_opts, :out_dir))
        exit_code(result.findings)

      {:error, reason} ->
        Presenter.error(reason)
    end
  end

  # CLI flags override config; config overrides struct defaults.
  defp pipeline_opts(%Config{} = config, opts, root, out_dir) do
    [
      root: root,
      out_dir: out_dir,
      cycles: Keyword.get(opts, :cycles, config.cycles),
      settle_ms: Keyword.get(opts, :settle, config.settle_ms),
      routes_limit: Keyword.get(opts, :routes, config.routes_limit),
      flow: Keyword.get(opts, :flow, config.flow),
      headless: Keyword.get(opts, :headless, true),
      timeout_ms: Keyword.get(opts, :timeout, 600_000),
      on_log: Presenter.log_fn(Keyword.get(opts, :quiet, false))
    ]
  end

  defp target_url(%Config{url: url}) when is_binary(url), do: url
  defp target_url(%Config{port: port}) when is_integer(port), do: "http://localhost:#{port}"
  defp target_url(_), do: nil

  defp exit_code(findings) do
    if Enum.any?(findings, &(&1.severity in [:critical, :high])), do: {:halt, 1}, else: :ok
  end
end
