defmodule VibeGuru.CLI.Init do
  @moduledoc """
  `vibeguru init` — step one. Detects the app's stack, dev command and serving URL,
  then writes `vibeguru.json` so `vibeguru run` needs no arguments.
  """

  alias VibeGuru.{Config, Project}
  alias VibeGuru.CLI.Presenter

  @switches [root: :string, url: :string, port: :integer, cycles: :integer]

  @spec run([String.t()]) :: :ok | {:halt, non_neg_integer()}
  def run(argv) do
    {opts, _args, _invalid} = OptionParser.parse(argv, switches: @switches)
    root = Keyword.get(opts, :root, File.cwd!())
    project = Project.detect(root)
    config = build_config(project, opts)

    case Config.save(config, root) do
      {:ok, path} ->
        Presenter.init_done(project, config, path)
        :ok

      {:error, reason} ->
        Presenter.error({:config_write_failed, reason})
    end
  end

  # CLI flags override detected values; detection fills the rest.
  defp build_config(project, opts) do
    defaults = %Config{}

    %Config{
      url: Keyword.get(opts, :url, project.url),
      dev_command: project.dev_command,
      port: Keyword.get(opts, :port, project.port),
      cycles: Keyword.get(opts, :cycles, defaults.cycles),
      settle_ms: defaults.settle_ms,
      routes_limit: defaults.routes_limit,
      flow: nil
    }
  end
end
