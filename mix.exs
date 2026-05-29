defmodule VibeGuru.MixProject do
  use Mix.Project

  def project do
    [
      app: :vibe_guru,
      version: "0.1.0",
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      escript: escript(),
      deps: deps()
    ]
  end

  defp escript do
    [main_module: VibeGuru.CLI, name: "vibeguru"]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger],
      mod: {VibeGuru.Application, []}
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:jason, "~> 1.4"}
    ]
  end
end
