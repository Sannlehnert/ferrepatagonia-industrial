const { fork } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
exports.startHttpApp = async overrides => {
  const child = fork(path.join(__dirname, 'http-app-worker.cjs'), [], {
    cwd: path.join(__dirname, '../..'), execArgv: [],
    env: { ...process.env, ...overrides }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  // Keep raw driver data out of assertion output even if startup fails.
  child.stderr.resume();
  const [message] = await Promise.race([
    once(child, 'message'), once(child, 'exit').then(() => { throw Error('HTTP test worker exited before listening'); }),
  ]);
  return { base: `http://127.0.0.1:${message.port}`, child,
    async stats() { const reply = once(child, 'message'); child.send('stats'); return (await reply)[0].stats; },
    async close() { const exited = once(child, 'exit'); child.send('close'); await exited; },
  };
};
