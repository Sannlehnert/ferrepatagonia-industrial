import { constants, existsSync } from 'node:fs';
import { lstat, open, realpath, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { readStorageDir } from '../../config/storage-env.config';
import { isReceiptId, ReceiptError, receiptUnavailable, type ReceiptMime } from './receipt-types';
import type { ReceiptValidationFailure, ReceiptValidationResult } from './receipt-file.worker';

const validationMessages: Record<ReceiptValidationFailure, string> = {
  ARCHIVO_DANADO: 'El archivo está dañado o incompleto. Probá con otro archivo.',
  CONTENIDO_NO_PERMITIDO: 'El archivo contiene elementos activos o incrustados no permitidos. Probá con un PDF o una imagen simple.',
  TIPO_INCOMPATIBLE: 'El archivo no coincide con el formato declarado. Verificá que sea PDF, JPG o PNG.',
};

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

// En desarrollo `tsx` ejecuta el código fuente, donde solo existe el worker
// `.ts`. En producción `tsc` genera el `.js` junto a este módulo. Se resuelve
// siempre el artefacto adyacente para no depender del directorio de trabajo.
function receiptWorker() {
  const compiled = join(__dirname, 'receipt-file.worker.js');
  if (existsSync(compiled)) return { file: compiled, execArgv: [] };

  const source = join(__dirname, 'receipt-file.worker.ts');
  if (!existsSync(source)) throw receiptUnavailable();
  let loader: string;
  try {
    loader = require.resolve('tsx');
  } catch {
    throw receiptUnavailable();
  }
  return { file: source, execArgv: ['--import', pathToFileURL(loader).href] };
}

type ValidationOutcome =
  | { status: 'result'; value: ReceiptValidationResult }
  | { status: 'unavailable' };

export async function validateReceiptContent(bytes: Buffer, mime: ReceiptMime, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!bytes.length) throw new ReceiptError(400, 'ARCHIVO_VACIO', 'Seleccioná un archivo con contenido.');
  const location = receiptWorker();
  const input = new Uint8Array(bytes);

  let worker: Worker;
  try {
    worker = new Worker(location.file, {
      workerData: { bytes: input, mime },
      transferList: [input.buffer],
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
      execArgv: location.execArgv,
    });
  } catch {
    console.error('receipt.validation.worker.unavailable');
    throw receiptUnavailable();
  }

  const outcome = await new Promise<ValidationOutcome>(resolve => {
    let settled = false;
    const finish = (value: ValidationOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      resolve(value);
    };
    const unavailable = () => finish({ status: 'unavailable' });
    const cancel = () => unavailable();
    const timer = setTimeout(unavailable, 6000);
    worker.once('message', value => {
      if (value && typeof value === 'object' && value.ok === true) {
        finish({ status: 'result', value: { ok: true } });
      } else if (value && typeof value === 'object' && value.ok === false
        && typeof value.code === 'string' && Object.hasOwn(validationMessages, value.code)) {
        finish({ status: 'result', value: { ok: false, code: value.code as ReceiptValidationFailure } });
      } else {
        unavailable();
      }
    });
    worker.once('error', unavailable);
    worker.once('exit', unavailable);
    signal.addEventListener('abort', cancel, { once: true });
  }).finally(() => worker.terminate());

  signal.throwIfAborted();
  if (outcome.status === 'unavailable') {
    console.error('receipt.validation.worker.failed');
    throw receiptUnavailable();
  }
  const result = outcome.value;
  if (!result.ok) {
    throw new ReceiptError(422, result.code, validationMessages[result.code]);
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
