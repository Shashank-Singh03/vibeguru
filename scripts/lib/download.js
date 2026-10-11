"use strict";
const fs = require("fs");
const https = require("https");
const path = require("path");
const { createHash, randomUUID } = require("crypto");

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

// One deadline and byte budget cover the entire redirect chain. An idle timeout
// alone cannot stop a server which keeps sending one byte forever.
function download(url, dest, { sha256, timeoutMs = 120000, maxBytes = DEFAULT_MAX_BYTES, allowedHosts } = {}) {
  return new Promise((resolve, reject) => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      reject(new Error("Download timeout and byte limit must be positive safe integers.")); return;
    }
    if (sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(sha256)) {
      reject(new Error("Download checksum must be a SHA-256 hex digest.")); return;
    }
    const tmp = `${dest}.${randomUUID()}.download`;
    let file, request, response, finished = false, bytes = 0;
    const timer = setTimeout(() => fail(new Error("Binary download timed out.")), timeoutMs);
    const fail = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      request?.destroy();
      response?.destroy();
      file?.destroy();
      const cleanup = () => { try { fs.rmSync(tmp, { force: true }); } catch { /* Windows may still be closing the owned file. */ } };
      if (file && !file.closed) file.once("close", cleanup);
      else cleanup();
      reject(error);
    };
    const visit = (input, redirects) => {
      if (finished) return;
      if (redirects > 10) { fail(new Error("Too many download redirects.")); return; }
      let target;
      try {
        target = new URL(input);
        if (target.protocol !== "https:") throw new Error("Binary downloads require HTTPS.");
        if (target.username || target.password) throw new Error("Download URLs must not contain credentials.");
        if (allowedHosts && (!Array.isArray(allowedHosts) || !allowedHosts.includes(target.hostname) || target.port && target.port !== "443")) {
          throw new Error("Download host is outside the release allowlist.");
        }
      } catch (error) { fail(error); return; }
      try {
        const req = https.get(target.href, { headers: { "User-Agent": "vibeguru-installer" } }, res => {
          if (finished) { res.destroy(); return; }
          response = res;
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.destroy();
            try { visit(new URL(res.headers.location, target).href, redirects + 1); }
            catch (error) { fail(error); }
            return;
          }
          if (res.statusCode !== 200) { fail(new Error(`HTTP ${res.statusCode} fetching binary.`)); return; }
          const length = res.headers["content-length"];
          if (length !== undefined && Number(length) > maxBytes) { fail(new Error("Binary download exceeds the byte limit.")); return; }
          try {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            file = fs.createWriteStream(tmp, { flags: "wx", mode: 0o600 });
          } catch (error) { fail(error); return; }
          const hash = createHash("sha256");
          res.on("data", chunk => {
            bytes += chunk.length;
            if (bytes > maxBytes) { fail(new Error("Binary download exceeds the byte limit.")); return; }
            hash.update(chunk);
          });
          res.on("aborted", () => fail(new Error("Binary download was interrupted.")));
          res.on("error", fail);
          file.on("error", fail);
          file.on("close", () => {
            if (finished || !res.complete) return;
            try {
              const actual = hash.digest("hex");
              if (sha256 && actual !== sha256.toLowerCase()) throw new Error("Binary checksum does not match the release manifest.");
              fs.renameSync(tmp, dest);
              finished = true;
              clearTimeout(timer);
              resolve(dest);
            } catch (error) { fail(error); }
          });
          res.pipe(file);
        });
        request = req;
        req.setTimeout(timeoutMs, () => fail(new Error("Binary download timed out.")));
        req.on("error", error => { if (request === req) fail(error); });
      } catch (error) { fail(error); }
    };
    visit(url, 0);
  });
}
module.exports = { download };
