const assert = require("node:assert/strict");

// El ejecutor deberá proporcionar una base exclusiva para esta ejecución.
assert.equal(process.env.E2E_ISOLATED, "1");
assert.equal(process.env.DB_HOST, "127.0.0.1");
assert.match(process.env.DB_NAME || "", /^e2e_test_[a-f0-9]{32}$/);
assert.ok(process.send, "Este servidor debe iniciarse desde el ejecutor E2E.");

const { app } = require("../../dist/app");
const {
  initializeDatabase,
  destroyDatabase,
} = require("../../dist/config/database.config");

let server;
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  // Evita dejar un proceso colgado si falla el cierre.
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();

  try {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  } catch {
    exitCode = 1;
  }

  try {
    await destroyDatabase();
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
  await initializeDatabase();

  if (stopping) return;

  server = app.listen(0, "127.0.0.1");

  server.once("error", () => {
    console.error("No se pudo iniciar la API aislada.");
    void stop(1);
  });

  server.once("listening", () => {
    const address = server.address();

    process.send({
      type: "ready",
      port: address.port,
    });
  });
}

main().catch(() => {
  console.error("No se pudo inicializar la API aislada.");
  void stop(1);
});
