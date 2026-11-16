// Preparacion y verificacion del almacenamiento persistente local (Sprint 7, T-S7-01.2).
//
// Uso (desde backend/, con backend/.env presente):
//   node scripts/prepare-local-storage.cjs           # inspeccion sin mutaciones
//   node scripts/prepare-local-storage.cjs --apply   # crea/corrige tras validar TODO
//
// Verifica PRODUCT_IMAGE_STORAGE_DIR, RECEIPT_STORAGE_DIR e IMPORT_STORAGE_DIR:
// - rutas absolutas, sin NUL ni espacios en los extremos (mismas reglas de Joi);
// - fuera del checkout de Git (comportamiento exigido a comprobantes por
//   backend/src/services/receipts/receipt-storage.ts);
// - sin enlaces simbolicos ni junctions en NINGUN componente de la ruta,
//   incluidos los directorios ancestrales;
// - directorios reales, distintos entre si y sin relaciones de contencion
//   (comprobaciones por pares);
// - permiso real de lectura, escritura y acceso (R/W/X);
// - comprobantes con permisos privados (sin bits para grupo u otros) en POSIX;
// - creacion por defecto 0700, sin relajar un 0700 preexistente a 0755.
//
// --apply valida las tres variables y todas las rutas antes de tocar el
// filesystem. Si una configuracion es invalida no crea ni modifica nada. Si una
// operacion falla a mitad de camino, informa exactamente que pudo modificarse:
// el filesystem no permite prometer atomicidad entre tres directorios.
//
// Windows: chmod NO proporciona el aislamiento de una ACL NTFS. El script
// verifica lo que Node puede comprobar (tipo de objeto y acceso efectivo) y
// documenta que la proteccion final depende de las ACL del perfil de usuario.
//
// Sin fallback silencioso: si falta una variable se informa y se sugiere la ruta
// para backend/.env; el script nunca escribe en .env ni en archivos versionados.

require('dotenv/config');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHECKOUT_MARKERS = ['.git', 'database', 'frontend'];
const VARIABLES = [
    { name: 'PRODUCT_IMAGE_STORAGE_DIR', label: 'fotos de productos', createMode: 0o700, maxMode: 0o755 },
    { name: 'RECEIPT_STORAGE_DIR', label: 'comprobantes', createMode: 0o700, maxMode: 0o700 },
    { name: 'IMPORT_STORAGE_DIR', label: 'importaciones', createMode: 0o700, maxMode: 0o755 },
];
const APPLICABLE_STATES = new Set(['ok', 'crear', 'corregir']);

const isWindows = process.platform === 'win32';
const modeText = mode => (mode & 0o777).toString(8).padStart(3, '0');
const normalizeForCompare = value => (isWindows ? value.toLowerCase() : value);

const samePath = (a, b) => normalizeForCompare(path.resolve(a)) === normalizeForCompare(path.resolve(b));

function contains(parent, child) {
    const relativePath = path.relative(normalizeForCompare(parent), normalizeForCompare(child));
    return relativePath === '' ||
        (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith('..' + path.sep));
}

function overlap(a, b) {
    return samePath(a, b) || contains(a, b) || contains(b, a);
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

// Recorre TODOS los componentes desde la raiz. Un symlink/junction en cualquier
// ancestro invalida la ruta antes de crear nada. Devuelve la ruta canonica aun
// cuando el directorio final todavia no existe.
function inspectPath(resolved) {
    const root = path.parse(resolved).root;
    const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
    let current = root;
    let existing = root;
    let missing = [];
    for (let index = 0; index < parts.length; index += 1) {
        current = path.join(current, parts[index]);
        let info;
        try {
            info = fs.lstatSync(current);
        } catch (error) {
            if (error.code === 'ENOENT') {
                missing = parts.slice(index);
                break;
            }
            return { ok: false, detail: `No se pudo inspeccionar ${current}: ${error.code ?? error.message}.` };
        }
        if (info.isSymbolicLink()) {
            return { ok: false, detail: `${current} es un enlace simbolico o junction; usar una ruta real.` };
        }
        if (!info.isDirectory()) {
            return { ok: false, detail: `${current} existe pero no es un directorio.` };
        }
        existing = current;
    }
    let realExisting;
    try {
        realExisting = fs.realpathSync(existing);
    } catch (error) {
        return { ok: false, detail: `realpath fallo para ${existing}: ${error.code ?? error.message}.` };
    }
    if (!samePath(realExisting, existing)) {
        return { ok: false, detail: `${existing} resuelve a ${realExisting}; la ruta contiene un enlace.` };
    }
    const canonical = missing.length === 0 ? realExisting : path.resolve(realExisting, ...missing);
    return { ok: true, canonical, exists: missing.length === 0, existing, info: missing.length === 0 ? fs.lstatSync(resolved) : null };
}

function resolveDir(variable, checkoutCanonical) {
    const raw = process.env[variable.name];
    if (typeof raw !== 'string' || raw.trim() === '') {
        return { name: variable.name, estado: 'falta', detail: 'Variable no configurada en backend/.env.' };
    }
    if (raw.includes('\0') || raw.trim() !== raw || !path.isAbsolute(raw)) {
        return { name: variable.name, estado: 'invalida', path: raw, detail: 'Debe ser una ruta absoluta sin NUL ni espacios en los extremos.' };
    }
    const resolved = path.resolve(raw);
    const inspected = inspectPath(resolved);
    if (!inspected.ok) {
        return { name: variable.name, estado: 'invalida', path: resolved, detail: inspected.detail };
    }
    const canonical = inspected.canonical;
    if (contains(checkoutCanonical, canonical) || contains(canonical, checkoutCanonical)) {
        return { name: variable.name, estado: 'invalida', path: resolved, canonical, detail: 'No puede estar dentro ni contener al checkout de Git.' };
    }
    if (!inspected.exists) {
        try {
            fs.accessSync(inspected.existing, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        } catch {
            return { name: variable.name, estado: 'error', path: resolved, canonical,
                detail: `El proceso no puede crear dentro de ${inspected.existing} (R/W/X).` };
        }
        return { name: variable.name, estado: 'crear', path: resolved, canonical, mode: variable.createMode,
            detail: `Se creara con permisos ${modeText(variable.createMode)}${isWindows ? ' (sujeto a ACL NTFS)' : ''}.` };
    }
    let accessOk = true;
    try {
        fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    } catch {
        accessOk = false;
    }
    if (isWindows) {
        if (!accessOk) {
            return { name: variable.name, estado: 'error', path: resolved, canonical,
                detail: 'Windows: el proceso no tiene acceso efectivo R/W/X; revisar ACL NTFS manualmente.' };
        }
        return { name: variable.name, estado: 'ok', path: resolved, canonical,
            detail: 'Acceso efectivo verificado; ACL NTFS no verificada por el script.' };
    }
    const mode = inspected.info.mode & 0o777;
    const tooBroad = (mode & ~variable.maxMode) !== 0;
    if (!accessOk || tooBroad) {
        const reason = !accessOk
            ? 'faltan permisos efectivos de lectura/escritura/acceso'
            : `permisos ${modeText(mode)} mas amplios que ${modeText(variable.maxMode)}`;
        return { name: variable.name, estado: 'corregir', path: resolved, canonical, mode: variable.createMode,
            detail: `${reason}; se ajustara a ${modeText(variable.createMode)}.` };
    }
    return { name: variable.name, estado: 'ok', path: resolved, canonical };
}

function applyState(state) {
    if (state.estado === 'crear') {
        fs.mkdirSync(state.path, { recursive: true, mode: state.mode });
        if (!isWindows) fs.chmodSync(state.path, state.mode);
        const info = fs.lstatSync(state.path);
        if (info.isSymbolicLink() || !info.isDirectory()) {
            throw new Error('La ruta creada dejo de ser un directorio real (posible enlace inesperado).');
        }
        fs.accessSync(state.path, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        state.estado = 'ok';
        state.detail = 'Directorio creado.';
        return true;
    }
    if (state.estado === 'corregir') {
        if (isWindows) throw new Error('Windows no permite corregir permisos POSIX con chmod.');
        fs.chmodSync(state.path, state.mode);
        fs.accessSync(state.path, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
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
    let checkoutCanonical;
    try {
        checkoutCanonical = fs.realpathSync(checkoutRoot);
    } catch {
        checkoutCanonical = path.resolve(checkoutRoot);
    }

    if (isWindows) {
        console.log('Nota Windows: chmod no equivale a una ACL NTFS. El script verifica acceso efectivo y tipo de ruta,');
        console.log('pero la proteccion de comprobantes depende de las ACL del perfil de usuario. Revisar con icacls si hace falta.');
    }

    const states = VARIABLES.map(variable => resolveDir(variable, checkoutCanonical));

    // Comprobaciones por pares: ningun almacenamiento puede ser igual, contener
    // ni estar contenido en otro. Se evalua la ruta canonica (sin enlaces).
    for (let first = 0; first < states.length; first += 1) {
        for (let second = first + 1; second < states.length; second += 1) {
            const a = states[first];
            const b = states[second];
            if (!a.canonical || !b.canonical || !overlap(a.canonical, b.canonical)) continue;
            const relation = samePath(a.canonical, b.canonical) ? 'es el mismo directorio que' : 'se solapa con';
            for (const state of [a, b]) {
                const other = state === a ? b : a;
                state.estado = 'invalida';
                state.detail = `${relation} ${other.name}; los tres almacenamientos deben ser independientes.`;
            }
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

    // Preflight completo: una sola configuracion invalida cancela TODO --apply
    // antes de crear o modificar directorios.
    const blocked = states.filter(s => !APPLICABLE_STATES.has(s.estado));
    if (blocked.length > 0) {
        console.error('ERROR: configuracion incompleta o invalida; no se creo ni modifico ningun directorio.');
        for (const state of blocked) {
            console.error(`  ${state.name}: ${state.estado.toUpperCase()}${state.detail ? ` — ${state.detail}` : ''}`);
            if (state.estado === 'falta' || state.estado === 'invalida') {
                console.error(`  ${state.name}=${suggestedPath(state.name)}`);
            }
        }
        process.exitCode = 1;
        return;
    }

    const applied = [];
    for (const state of states) {
        if (state.estado === 'ok') continue;
        try {
            if (applyState(state)) {
                applied.push({ name: state.name, path: state.path });
                console.log(`- ${state.name}: aplicado — ${state.path}`);
            }
        } catch (error) {
            console.error(`ERROR: fallo al aplicar ${state.name}: ${error.code ?? error.message}.`);
            console.error('Pueden haberse modificado (la operacion no es atomica):');
            for (const item of applied) console.error(`  ${item.name} — ${item.path} (completado)`);
            console.error(`  ${state.name} — ${state.path} (posible creacion o cambio parcial)`);
            console.error('Verificar manualmente esas rutas; no se promete atomicidad entre los tres directorios.');
            process.exitCode = 1;
            return;
        }
    }
    if (applied.length === 0) {
        console.log('Almacenamiento verificado: rutas absolutas, fuera del checkout, separadas y persistentes.');
        return;
    }
    console.log('Almacenamiento preparado: rutas absolutas, fuera del checkout, separadas, sin enlaces y persistentes.');
}

main();
