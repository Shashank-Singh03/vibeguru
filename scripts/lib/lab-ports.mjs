import { createServer } from "node:net";

export async function assertPortAvailable(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid lab port");
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", error => reject(new Error(`Lab port ${port} is unavailable (${error.code}); existing listeners are left running`)));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => probe.close(resolve));
  });
}

// Only the owned child's listen callback can satisfy this per-run handshake.
export function fixtureReadiness(port, instance) {
  let buffer = "", ready = false;
  return {
    consume(chunk) {
      buffer += String(chunk);
      let boundary;
      while ((boundary = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
        try {
          const value = JSON.parse(line);
          if (value.vibeguru_lab_ready === instance && value.port === port) ready = true;
        } catch { /* Other startup diagnostics do not establish ownership. */ }
      }
      if (buffer.length > 8192) buffer = "";
    },
    get ready() { return ready; }
  };
}
