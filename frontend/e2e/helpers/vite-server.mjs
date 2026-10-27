import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

assert.equal(process.env.E2E_ISOLATED, "1");
assert.ok(process.send, "Iniciar desde el ejecutor E2E.");

const apiURL = new URL(process.env.E2E_API_URL);

assert.equal(apiURL.protocol, "http:");
assert.equal(apiURL.hostname, "127.0.0.1");
assert.ok(apiURL.port, "La API aislada debe indicar su puerto.");
assert.equal(apiURL.username, "");
assert.equal(apiURL.password, "");

const frontend = fileURLToPath(new URL("../../", import.meta.url));

let server;
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();

  try {
    await server?.close();
  } catch {
    exitCode = 1;
  }

  process.exit(exitCode);
}

process.on("message", (message) => {
  if (message === "shutdown") void stop();
});
process.once("disconnect", () => void stop());
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

async function main() {
  server = await createServer({
    root: frontend,
    configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
    envDir: false,
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port: 0,
      open: false,
      proxy: {
        "/api": {
          target: apiURL.origin,
          changeOrigin: true,
        },
      },
    },
  });

  if (stopping) return;

  await server.listen();

  const address = server.httpServer.address();

  process.send({
    type: "ready",
    port: address.port,
  });
}

main().catch(() => {
  console.error("No se pudo iniciar el frontend aislado.");
  void stop(1);
});
