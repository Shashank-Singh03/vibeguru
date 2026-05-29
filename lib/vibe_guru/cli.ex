defmodule VibeGuru.CLI do
  @moduledoc """
  Escript entry point. Parses the sub-command and delegates; all real work lives in the
  command modules (`CLI.Init`, `CLI.Run`) and `CLI.Presenter`.

      vibeguru init                      # step 1: detect + write vibeguru.json
      vibeguru run                       # step 2: start app, analyze, write CLAUDE.md
      vibeguru memory:client <url>       # low-level: analyze a running URL directly
  """

  alias VibeGuru.CLI.{Init, Run, Presenter}

  @spec main([String.t()]) :: no_return()
  def main(argv), do: argv |> dispatch() |> halt()

  defp dispatch(["init" | rest]), do: Init.run(rest)
  defp dispatch(["run" | rest]), do: Run.run(rest)
  defp dispatch(["memory:client", url | rest]), do: Run.direct(url, rest)
  defp dispatch(_), do: Presenter.usage()

  defp halt(:ok), do: System.halt(0)
  defp halt({:halt, code}), do: System.halt(code)
end
