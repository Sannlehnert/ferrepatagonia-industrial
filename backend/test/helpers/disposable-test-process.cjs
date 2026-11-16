const { spawn } = require('node:child_process');

async function withTestSignals(main) {
  const controller = new AbortController();
  const handlers = [['SIGINT', 130], ['SIGTERM', 143]].map(([signal, code]) => {
    const stop = () => {
      process.exitCode = code;
      controller.abort(Error(`Interrumpido por ${signal}`));
    };
    process.on(signal, stop);
    return [signal, stop];
  });
  try {
    await main(controller.signal);
  } finally {
    for (const [signal, stop] of handlers) process.off(signal, stop);
  }
}

function runTestProcess(args, options, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { ...options, stdio: 'inherit', signal });
    let failure;
    child.on('error', error => { failure = error; });
    // Wait for termination before removing the database it was using.
    child.once('close', status => {
      if (signal.aborted) reject(signal.reason);
      else if (failure) reject(failure);
      else resolve(status);
    });
  });
}

module.exports = { withTestSignals, runTestProcess };
