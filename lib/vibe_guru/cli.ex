defmodule VibeGuru.CLI do
  @moduledoc """
  Escript entry point. Parses the sub-command and delegates; all real work lives in the
  command modules (`CLI.Init`, `CLI.Run`) and `CLI.Presenter`.

      vibeguru init                      # step 1: detect + write vibeguru.json
      vibeguru run                       # step 2: start app, analyze, write CLAUDE.md
      vibeguru memory:client <url>       # low-level: analyze a running URL directly
  """

  alias VibeGuru.CLI.{Init, Run, Presenter}

  @doc """
  Release entry point. An escript calls `main/1` directly with its argv, but a
  Mix/Burrito release boots the OTP application instead — so `VibeGuru.Application`
  calls this in release mode to fetch the wrapped binary's argv and dispatch.

  Uses `get_arguments/0` (reads `:init.get_plain_arguments/0` directly), NOT `argv/0`.
  `argv/0` only returns real args when the `__BURRITO` env var is set, and on Windows
  Burrito launches Erlang via a child process whose env doesn't carry that var — so
  `argv/0` silently falls back to an empty `System.argv()` and every command hit the
  usage screen. The actual args still arrive on the command line (after `-extra`),
  which `get_arguments/0` reads regardless of platform.
  """
  @spec boot() :: no_return()
  def boot, do: Burrito.Util.Args.get_arguments() |> main()

  @spec main([String.t()]) :: no_return()
  def main(argv), do: argv |> dispatch() |> halt()

  defp dispatch(["init" | rest]), do: Init.run(rest)
  defp dispatch(["run" | rest]), do: Run.run(rest)
  defp dispatch(["memory:client", url | rest]), do: Run.direct(url, rest)
  defp dispatch(_), do: Presenter.usage()

  defp halt(:ok), do: System.halt(0)
  defp halt({:halt, code}), do: System.halt(code)
end
