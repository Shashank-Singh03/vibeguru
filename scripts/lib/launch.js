"use strict";
const fs = require("fs");

// Native release assets launch directly. Development escripts require the Erlang
// launcher, including on Windows where a shebang is not executable by spawn().
function launchSpec(binary, args) {
  const descriptor = fs.openSync(binary, "r");
  const header = Buffer.alloc(160);
  try { fs.readSync(descriptor, header, 0, header.length, 0); }
  finally { fs.closeSync(descriptor); }
  if (/^#![^\n]*\bescript\b/.test(header.toString("utf8"))) {
    return { command: process.platform === "win32" ? "escript.exe" : "escript", args: [binary, ...args] };
  }
  return { command: binary, args };
}

function binaryOverride() {
  const binary = process.env.VIBEGURU_BINARY;
  if (binary && !fs.existsSync(binary)) throw new Error(`VIBEGURU_BINARY points at ${binary}, which does not exist`);
  return binary || null;
}
module.exports = { launchSpec, binaryOverride };
