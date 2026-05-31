defmodule VibeGuru.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = []

    opts = [strategy: :one_for_one, name: VibeGuru.Supervisor]

    with {:ok, _pid} = ok <- Supervisor.start_link(children, opts) do
      maybe_run_cli()
      ok
    end
  end

  # In a packaged release the binary's only job is the CLI, so once the (empty)
  # supervision tree is up we run it and halt. `RELEASE_NAME` is set only when
  # running as a release — never under `mix`, `iex -S mix`, the escript, or the
  # test suite — which keeps those paths from triggering a CLI run + halt.
  defp maybe_run_cli do
    if System.get_env("RELEASE_NAME"), do: VibeGuru.CLI.boot()
  end
end
