defmodule VibeGuru.MixProject do
  use Mix.Project

  def project do
    [
      app: :vibe_guru,
      version: "0.1.0",
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      escript: escript(),
      releases: releases(),
      deps: deps()
    ]
  end

  # Kept for the local dev workflow (`mix escript.build` -> ./vibeguru). An escript
  # still needs Erlang on PATH; shippable, self-contained binaries come from the
  # Burrito release below.
  defp escript do
    [main_module: VibeGuru.CLI, name: "vibeguru"]
  end

  # Self-contained binaries (bundle ERTS + BEAM, no Erlang/Elixir on the user's
  # machine). Burrito cross-compiles via Zig; CI builds one target per OS runner
  # (set BURRITO_TARGET) and uploads the result to GitHub Releases, where the
  # `npx vibeguru` wrapper fetches the right one. The boot path is in
  # VibeGuru.Application.start/2 (release mode -> VibeGuru.CLI.boot/0).
  defp releases do
    [
      vibeguru: [
        steps: [:assemble, &Burrito.wrap/1],
        burrito: [
          targets: [
            macos_arm: [os: :darwin, cpu: :aarch64],
            macos_x86: [os: :darwin, cpu: :x86_64],
            linux: [os: :linux, cpu: :x86_64],
            windows: [os: :windows, cpu: :x86_64]
          ]
        ]
      ]
    ]
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
      {:jason, "~> 1.4"},
      {:burrito, "~> 1.0"}
    ]
  end
end
