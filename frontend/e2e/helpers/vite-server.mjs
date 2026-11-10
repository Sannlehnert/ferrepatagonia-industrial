import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer, preview } from "vite";

assert.equal(process.env.E2E_ISOLATED, "1");
assert.ok(process.send, "Iniciar desde el ejecutor E2E.");

const apiURL = new URL(process.env.E2E_API_URL);

assert.equal(apiURL.protocol, "http:");
assert.equal(apiURL.hostname, "127.0.0.1");
assert.ok(apiURL.port, "La API aislada debe indicar su puerto.");
assert.equal(apiURL.username, "");
assert.equal(apiURL.password, "");

const frontend = fileURLToPath(new URL("../../", import.meta.url));
const webPort = Number(process.env.E2E_WEB_PORT);
assert.ok(Number.isInteger(webPort) && webPort > 0 && webPort <= 65535,
  "El ejecutor debe fijar el puerto público E2E.");

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
  const configFile = fileURLToPath(new URL("../../vite.config.ts", import.meta.url));
  const proxy = {
    "/api": {
      target: apiURL.origin,
      changeOrigin: true,
    },
    "/socket.io/": { target: apiURL.origin, ws: true },
  };
  const shared = {
    root: frontend,
    configFile,
    envDir: false,
    clearScreen: false,
  };

  if (process.env.E2E_PRODUCTION_BUILD === "1") {
    assert.ok(
      process.env.NODE_ENV === "test",
      "El preview de producción solo se permite en E2E aislado.",
    );
    server = await preview({
      ...shared,
      preview: {
        host: "127.0.0.1",
        port: webPort,
        strictPort: true,
        open: false,
        proxy,
      },
    });
  } else {
    server = await createServer({
      ...shared,
      server: {
        host: "127.0.0.1",
        port: webPort,
        strictPort: true,
        open: false,
        proxy,
      },
    });
  }

  if (stopping) return;

  if (process.env.E2E_PRODUCTION_BUILD !== "1") {
    await server.listen();
  }

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
