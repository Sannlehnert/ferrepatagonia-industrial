import { constants, existsSync } from 'node:fs';
import { lstat, open, realpath, stat, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { readStorageDir } from '../../config/storage-env.config';
import { isReceiptId, ReceiptError, receiptUnavailable, type ReceiptMime } from './receipt-types';

function contains(parent: string, child: string): boolean {
  const location = relative(parent, child);
  return location === '' || (!isAbsolute(location) && location !== '..' && !location.startsWith('..' + sep));
}

export async function receiptDirectory(): Promise<string> {
  let configured: string | undefined;
  try {
    configured = readStorageDir('RECEIPT_STORAGE_DIR', process.env);
  } catch {
    throw receiptUnavailable();
  }
  if (!configured) throw receiptUnavailable();
  const backend = resolve(__dirname, '../../..');
  const parent = resolve(backend, '..');
  const projectDir = existsSync(join(parent, '.git')) ||
    (existsSync(join(parent, 'database')) && existsSync(join(parent, 'frontend'))) ? parent : backend;
  const [root, project] = await Promise.all([realpath(configured), realpath(projectDir)]);
  const info = await stat(root);
  if (contains(project, root) || contains(root, project) || !info.isDirectory() ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw receiptUnavailable();
  return root;
}

function receiptPath(root: string, id: string): string {
  if (!isReceiptId(id)) throw receiptUnavailable();
  return join(root, id);
}

const receiptWorkerTimeoutMs = 6000;
const receiptWorkerLimits = {
  maxOldGenerationSizeMb: 96,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 2,
} as const;

type WorkerLaunchConfig = {
  file: string;
  execArgv: string[];
  env: Record<string, string>;
};

type ValidationOutcome =
  | { kind: 'verdict'; valid: boolean }
  | { kind: 'operational'; reason: string; code?: string };

function safeWorkerErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : undefined;
}

function logWorkerFailure(reason: string, code?: string): void {
  console.error('receipt.worker.failed', code ? { reason, code } : { reason });
}

export const receiptWorkerRuntime = {
  resolveWorker(sourceFile = __filename): WorkerLaunchConfig {
    if (extname(sourceFile) === '.ts') {
      const tsxCjsLoader = createRequire(sourceFile).resolve('tsx/cjs');
      const tempDir = tmpdir();
      return {
        file: join(__dirname, 'receipt-file.worker.ts'),
        execArgv: ['--require', tsxCjsLoader],
        // Keep process secrets out of the worker while giving tsx an explicit OS temp dir.
        env: {
          TSX_DISABLE_CACHE: '1',
          TEMP: tempDir,
          TMP: tempDir,
          TMPDIR: tempDir,
        },
      };
    }
    return {
      file: join(__dirname, 'receipt-file.worker.js'),
      execArgv: [],
      env: {},
    };
  },
  createWorker(file: string, options: WorkerOptions): Worker {
    return new Worker(file, options);
  },
};

export async function validateReceiptContent(bytes: Buffer, mime: ReceiptMime, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!bytes.length) throw new ReceiptError(400, 'ARCHIVO_VACIO', 'Seleccioná un archivo con contenido.');
  const input = new Uint8Array(bytes);
  let worker: Worker;
  try {
    const launch = receiptWorkerRuntime.resolveWorker();
    worker = receiptWorkerRuntime.createWorker(launch.file, {
      workerData: { bytes: input, mime },
      transferList: [input.buffer],
      env: launch.env,
      resourceLimits: receiptWorkerLimits,
      execArgv: launch.execArgv,
    });
  } catch (error) {
    logWorkerFailure('worker_init_error', safeWorkerErrorCode(error));
    throw receiptUnavailable();
  }

  let outcome: ValidationOutcome;
  try {
    outcome = await new Promise<ValidationOutcome>(resolve => {
      let settled = false;
      const onError = (error: unknown) => {
        finish({ kind: 'operational', reason: 'worker_error', code: safeWorkerErrorCode(error) });
      };
      const onMessage = (result: unknown) => {
        if (typeof result === 'boolean') {
          finish({ kind: 'verdict', valid: result });
          return;
        }
        finish({ kind: 'operational', reason: 'invalid_message' });
      };
      const onExit = (exitCode: number) => {
        finish({
          kind: 'operational',
          reason: 'worker_exit',
          code: Number.isInteger(exitCode) ? `EXIT_${exitCode}` : undefined,
        });
      };
      const onAbort = () => finish({ kind: 'operational', reason: 'aborted' });
      const timer = setTimeout(() => finish({ kind: 'operational', reason: 'worker_timeout' }), receiptWorkerTimeoutMs);

      function finish(result: ValidationOutcome) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        worker.off('message', onMessage);
        worker.off('exit', onExit);
        resolve(result);
      }

      worker.on('error', onError);
      worker.once('message', onMessage);
      worker.once('exit', onExit);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  } finally {
    try {
      await worker.terminate();
    } catch {
      // Ignore worker shutdown errors after validation settles or aborts.
    }
  }

  signal.throwIfAborted();
  if (outcome.kind === 'operational') {
    logWorkerFailure(outcome.reason, outcome.code);
    throw receiptUnavailable();
  }
  if (!outcome.valid) {
    throw new ReceiptError(422, 'CONTENIDO_INVALIDO', 'El archivo está dañado, contiene elementos no permitidos o no coincide con su tipo.');
  }
}

export async function removeReceiptFile(root: string, id: string): Promise<void> {
  try {
    await unlink(receiptPath(root, id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('receipt.storage.cleanup.failed');
  }
}

export async function writeReceiptFile(root: string, id: string, bytes: Buffer): Promise<void> {
  const handle = await open(receiptPath(root, id), 'wx', 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (process.platform !== 'win32') {
      const directory = await open(root, 'r');
      try { await directory.sync(); }
      finally { await directory.close(); }
    }
  } catch (error) {
    await removeReceiptFile(root, id);
    throw error;
  }
}

export async function openReceiptFile(root: string, id: string, bytes: number) {
  const path = receiptPath(root, id);
  const entry = await lstat(path);
  if (!entry.isFile()) throw receiptUnavailable();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== bytes || info.ino !== entry.ino || info.dev !== entry.dev) throw receiptUnavailable();
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
