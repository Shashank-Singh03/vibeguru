Code.require_file("support/dashboard_formatter.ex", __DIR__)
ExUnit.start(formatters: [ExUnit.CLIFormatter, VibeGuru.DashboardFormatter])
