// Safe driver fixture: report config-file metadata, never its contents.
const fs = require("node:fs");
const path = require("node:path");
const configPath = process.argv[process.argv.indexOf("--config") + 1];
process.stdout.write(JSON.stringify({
  type: "result", ok: true, configPath,
  mode: fs.statSync(configPath).mode & 0o777,
  dirMode: fs.statSync(path.dirname(configPath)).mode & 0o777,
}) + "\n");
