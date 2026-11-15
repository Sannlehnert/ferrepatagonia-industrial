// Preparacion y verificacion del almacenamiento persistente local (Sprint 7, T-S7-01.2).
//
// Uso (desde backend/, con backend/.env presente):
//   node scripts/prepare-local-storage.cjs           # inspeccion sin mutaciones
//   node scripts/prepare-local-storage.cjs --apply   # crea/corrige directorios
//
// Verifica PRODUCT_IMAGE_STORAGE_DIR, RECEIPT_STORAGE_DIR e IMPORT_STORAGE_DIR:
// - rutas absolutas, sin NUL ni espacios en los extremos (mismas reglas de Joi);
// - fuera del checkout de Git (comportamiento exigido a comprobantes por
//   backend/src/services/receipts/receipt-storage.ts);
// - directorios reales, sin enlaces simboloidos (lstat + realpath) y con permiso
//   de lectura/escritura;
// - comprobantes con modo 0700 en POSIX (restriccion vigente del servicio);
// - comprobantes y fotos de productos en directorios separados.
//
// Sin fallback silencioso: si falta una variable se informa y se sugiere la ruta
// para backend/.env; el script nunca escribe en .env ni en archivos versionados.

require('dotenv/config');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHECKOUT_MARKERS = ['.git', 'database', 'frontend'];
const VARIABLES = [
    { name: 'PRODUCT_IMAGE_STORAGE_DIR', label: 'fotos de productos', mode: 0o755 },
    { name: 'RECEIPT_STORAGE_DIR', label: 'comprobantes', mode: 0o700 },
    { name: 'IMPORT_STORAGE_DIR', label: 'importaciones', mode: 0o755 },
];

const samePath = (a, b) =>
    process.platform === 'win32'
        ? a.toLowerCase() === b.toLowerCase()
        : a === b;

function contains(parent, child) {
    const relativePath = path.relative(parent, child);
    return relativePath === '' ||
        (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith('..' + path.sep));
}

function findCheckoutRoot() {
    let current = path.resolve(__dirname, '..', '..');
    for (;;) {
        if (CHECKOUT_MARKERS.some(marker => fs.existsSync(path.join(current, marker)))) return current;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

// Sugerencia estable por usuario: fuera del checkout, para Windows y Linux.
const suggestedBase = () => path.join(os.homedir(), 'ferrepatagonia-datos');
const suggestedPath = name =>
    name === 'PRODUCT_IMAGE_STORAGE_DIR' ? path.join(suggestedBase(), 'fotos-productos')
        : name === 'RECEIPT_STORAGE_DIR' ? path.join(suggestedBase(), 'comprobantes')
            : path.join(suggestedBase(), 'importaciones');

function resolveDir(name, checkoutRoot) {
    const raw = process.env[name];
    if (typeof raw !== 'string' || raw.trim() === '') {
        return { name, estado: 'falta', detail: `Variable no configurada en backend/.env.` };
    }
    if (raw.includes('\0') || raw.trim() !== raw || !path.isAbsolute(raw)) {
        return { name, estado: 'invalida', path: raw, detail: 'Debe ser una ruta absoluta sin NUL ni espacios en los extremos.' };
    }
    const resolved = path.resolve(raw);
    if (checkoutRoot && (contains(checkoutRoot, resolved) || contains(resolved, checkoutRoot))) {
        return { name, estado: 'invalida', path: resolved, detail: 'No puede estar dentro ni contener al checkout de Git.' };
    }
    let info;
    try {
        info = fs.lstatSync(resolved);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { name, estado: 'crear', path: resolved, mode: VARIABLES.find(v => v.name === name).mode };
        }
        return { name, estado: 'error', path: resolved, detail: `No se pudo inspeccionar: ${error.code ?? error.message}.` };
    }
    if (info.isSymbolicLink()) {
        return { name, estado: 'invalida', path: resolved, detail: 'Es un enlace simbolico; usar un directorio real.' };
    }
    if (!info.isDirectory()) {
        return { name, estado: 'invalida', path: resolved, detail: 'La ruta existe pero no es un directorio.' };
    }
    let real;
    try {
        real = fs.realpathSync(resolved);
    } catch (error) {
        return { name, estado: 'error', path: resolved, detail: `realpath fallo: ${error.code ?? error.message}.` };
    }
    if (!samePath(real, resolved)) {
        return { name, estado: 'invalida', path: resolved, detail: `Resuelve via enlace simbolico a ${real}; usar un directorio real.` };
    }
    try {
        fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
        return { name, estado: 'error', path: resolved, detail: 'El proceso no tiene permiso de lectura/escritura.' };
    }
    const desiredMode = VARIABLES.find(v => v.name === name).mode;
    if (process.platform !== 'win32' && (info.mode & 0o077) !== (desiredMode & 0o077)) {
        return { name, estado: 'corregir', path: resolved, mode: desiredMode,
            detail: `Permisos ${(info.mode & 0o777).toString(8)}; ${(desiredMode & 0o777).toString(8)} es lo requerido.` };
    }
    return { name, estado: 'ok', path: resolved };
}

function applyState(state) {
    if (state.estado === 'crear') {
        fs.mkdirSync(state.path, { recursive: true, mode: state.mode });
        if (process.platform !== 'win32') fs.chmodSync(state.path, state.mode);
        state.estado = 'ok';
        state.detail = 'Directorio creado.';
        return true;
    }
    if (state.estado === 'corregir') {
        fs.chmodSync(state.path, state.mode);
        state.estado = 'ok';
        state.detail = 'Permisos corregidos.';
        return true;
    }
    return false;
}

function main() {
    const apply = process.argv.slice(2).includes('--apply');
    if (process.argv.slice(2).some(a => a !== '--apply')) {
        console.error('ERROR: Modo valido: sin argumentos (inspeccion) o --apply.');
        process.exitCode = 1;
        return;
    }
    const checkoutRoot = findCheckoutRoot();
    if (!checkoutRoot) {
        console.error('ERROR: No se detecto el checkout del proyecto.');
        process.exitCode = 1;
        return;
    }

    const states = VARIABLES.map(variable => resolveDir(variable.name, checkoutRoot));

    // Regla vigente: fotos y comprobantes no comparten directorio.
    const receipts = states.find(s => s.name === 'RECEIPT_STORAGE_DIR');
    const images = states.find(s => s.name === 'PRODUCT_IMAGE_STORAGE_DIR');
    if (receipts.path && images.path && (contains(receipts.path, images.path) || contains(images.path, receipts.path))) {
        for (const state of [receipts, images]) {
            state.estado = 'invalida';
            state.detail = 'Comparte directorio con el otro almacenamiento; deben ser separados.';
        }
    }

    for (const state of states) {
        const label = VARIABLES.find(v => v.name === state.name).label;
        console.log(`- ${state.name} (${label}): ${state.estado.toUpperCase()}${state.path ? ` — ${state.path}` : ''}${state.detail ? ` — ${state.detail}` : ''}`);
    }

    if (!apply) {
        const pending = states.filter(s => s.estado !== 'ok');
        console.log(pending.length
            ? `Inspeccion sin mutaciones. ${pending.length} estado(s) pendiente(s); revisar backend/.env y ejecutar con --apply si corresponde.`
            : 'Inspeccion sin mutaciones. Todo el almacenamiento configurado es valido y persistente.');
        if (pending.length) process.exitCode = 1;
        return;
    }

    let failure = false;
    for (const state of states) {
        if (state.estado === 'ok') continue;
        if (applyState(state)) {
            console.log(`- ${state.name}: aplicado — ${state.path}`);
            continue;
        }
        failure = true; // falta / invalida / error: requieren decision manual, no se corrigen solas.
    }
    if (failure) {
        const missing = states.filter(s => s.estado === 'falta' || s.estado === 'invalida' || s.estado === 'error');
        console.error('ERROR: Estados que requieren ajuste manual en backend/.env (el script no modifica .env):');
        for (const state of missing) {
            const sugerida = suggestedPath(state.name);
            console.error(`  ${state.name}=${sugerida}`);
        }
        process.exitCode = 1;
        return;
    }
    console.log('Almacenamiento verificado: rutas absolutas, fuera del checkout, separadas y persistentes.');
}

main();
