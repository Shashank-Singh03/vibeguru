"use strict";

// Minimal dependency-free HTTPS downloader. GitHub Release asset URLs redirect to
// a signed object store, so we follow redirects. Writes to a temp file and renames
// on success so an interrupted download never leaves a half-written binary behind.

const fs = require("fs");
const https = require("https");
const path = require("path");

const MAX_REDIRECTS = 10;

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      return reject(new Error(`too many redirects fetching ${url}`));
    }

    const req = https.get(url, { headers: { "User-Agent": "vibeguru-installer" } }, (res) => {
      const { statusCode, headers } = res;

      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        return resolve(download(headers.location, dest, redirects + 1));
      }

      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} fetching ${url}`));
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.download`;
      const file = fs.createWriteStream(tmp);

      res.pipe(file);
      file.on("error", (err) => {
        fs.rmSync(tmp, { force: true });
        reject(err);
      });
      file.on("finish", () =>
        file.close(() => {
          fs.renameSync(tmp, dest);
          resolve(dest);
        })
      );
    });

    req.on("error", reject);
  });
}

module.exports = { download };
