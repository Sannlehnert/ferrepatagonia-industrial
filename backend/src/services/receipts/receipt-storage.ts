import { constants, existsSync } from 'node:fs';
import { lstat, open, realpath, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { isReceiptId, ReceiptError, receiptUnavailable, type ReceiptMime } from './receipt-types';

function contains(parent: string, child: string): boolean {
  const location = relative(parent, child);
  return location === '' || (!isAbsolute(location) && location !== '..' && !location.startsWith('..' + sep));
}

export async function receiptDirectory(): Promise<string> {
  const configured = process.env.RECEIPT_STORAGE_DIR;
  if (!configured || !isAbsolute(configured)) throw receiptUnavailable();
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

export async function validateReceiptContent(bytes: Buffer, mime: ReceiptMime, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!bytes.length) throw new ReceiptError(400, 'ARCHIVO_VACIO', 'Seleccioná un archivo con contenido.');
  const input = new Uint8Array(bytes);
  const worker = new Worker(join(__dirname, 'receipt-file.worker.js'), {
    workerData: { bytes: input, mime },
    transferList: [input.buffer],
    env: {},
    resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
    execArgv: [],
  });

  const valid = await new Promise<boolean>(resolve => {
    const finish = (result: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      resolve(result);
    };
    const cancel = () => finish(false);
    const timer = setTimeout(cancel, 6000);
    worker.once('message', result => finish(result === true));
    worker.once('error', cancel);
    worker.once('exit', cancel);
    signal.addEventListener('abort', cancel, { once: true });
  }).finally(() => worker.terminate());

  signal.throwIfAborted();
  if (!valid) {
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
