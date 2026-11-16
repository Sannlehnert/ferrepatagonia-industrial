#!/usr/bin/env node
'use strict';

// T-S7-05.2 — authorized local price verification.
// Deliberately NOT an HTTP endpoint: it runs with the backend's operational DB
// credential and never accepts an identity from a browser request.

const {
  PriceVerificationError,
  normalizeExpectedPrice,
  parsePositiveId,
  validateEvidenceReference,
} = require('../dist/services/pricing/price-verification.rules.js');

const VALUE_OPTIONS = new Set(['producto', 'importe', 'evidencia', 'admin', 'limite', 'confirmar-destino']);
const FLAG_OPTIONS = new Set(['confirmar', 'historial', 'json', 'ayuda']);
const argv = process.argv.slice(2);
const json = argv.includes('--json');
// dotenv can write informational messages to stdout when loading backend/.env.
if (json) {
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.DOTENV_CONFIG_DEBUG = 'false';
}
let destination;

const expectedTriggers = [
  ['fer17_producto_alta_evento', 'PRODUCTO', 'AFTER', 'INSERT'],
  ['fer17_producto_precio_evento', 'PRODUCTO', 'AFTER', 'UPDATE'],
  ['fer17_precio_evento_no_update', 'FER17_PRECIO_EVENTO', 'BEFORE', 'UPDATE'],
  ['fer17_precio_evento_no_delete', 'FER17_PRECIO_EVENTO', 'BEFORE', 'DELETE'],
];
const expectedTables = ['PRODUCTO', 'CATEGORIA', 'USUARIO', 'PRECIO_USD_EVIDENCIA', 'FER17_PRECIO_EVENTO'];
const invalid = message => new PriceVerificationError('SOLICITUD_INVALIDA', 400, message);

function emitJson(result) {
  console.log(JSON.stringify({ ...result, ...(destination && { destino: destination }) }, null, 2));
}

function reject(result) {
  if (json) emitJson(result);
  else {
    console.error(`[${result.code}] ${result.message}`);
    if (result.eventId) console.error(`Resultado registrado en auditoría: evento ${result.eventId}.`);
  }
  return 1;
}

function usage() {
  return `Uso:
  npm run precio:verificar -- --producto <id> --importe <USD> --evidencia "<referencia>" --admin <id> --confirmar --confirmar-destino <host:puerto/base>
  npm run precio:historial -- --producto <id> [--limite 50] [--json]

Opciones:
  --producto   ID del producto revisado.
  --importe    Importe exacto en USD revisado (cadena, hasta 2 decimales).
  --evidencia  Referencia comercial verificable (documento, origen y localizador).
  --admin      ID de un ADMIN activo que realiza la revisión.
  --confirmar  Confirma explícitamente la revisión manual. Obligatorio para verificar.
  --confirmar-destino  Confirma DB_HOST:DB_PORT/DB_NAME de la base a modificar.
  --historial  Consulta el historial append-only del producto.
  --limite     Filas de historial, 1–200 (por defecto 50).
  --json       Salida JSON legible por máquina.

La evidencia sintética, vacía o genérica se rechaza. El comando no puede demostrar
por sí mismo la autenticidad de un documento externo: deja constancia de la revisión
manual y de la referencia aportada por el operador autorizado.`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--') || arg.length === 2) throw invalid('Todos los argumentos deben ser opciones con --.');
    const key = arg.slice(2);
    if (!FLAG_OPTIONS.has(key) && !VALUE_OPTIONS.has(key)) throw invalid('Opción desconocida. Consultá --ayuda.');
    if (Object.hasOwn(options, key)) throw invalid(`Opción repetida: --${key}.`);
    if (FLAG_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) throw invalid(`Falta el valor de --${key}.`);
    options[key] = value;
  }
  return options;
}

function requireOption(options, key) {
  if (typeof options[key] !== 'string' || options[key].trim() === '') {
    throw invalid(`Falta --${key}.`);
  }
  return options[key];
}

async function verifyDestination(db, configuredName) {
  const [identity] = await db.query('SELECT DATABASE() AS name, VERSION() AS version');
  if (identity?.name !== configuredName || !/MariaDB/i.test(identity.version)) {
    throw new PriceVerificationError('DESTINO_INCOMPATIBLE', 409,
      'La conexión no corresponde a la base MariaDB confirmada.');
  }
  const objects = await db.query(`SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine
    FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`);
  const missing = expectedTables.filter(name => !objects.some(row =>
    row.name === name && row.kind === 'BASE TABLE' && row.engine === 'InnoDB'));
  if (!objects.some(row => row.name === 'FER17_AUDITORIA_TRIGGERS' && row.kind === 'VIEW')) {
    missing.push('FER17_AUDITORIA_TRIGGERS');
  } else {
    const triggers = await db.query(`SELECT nombre AS name, tabla AS tbl, momento AS timing,
      operacion AS operation, vigente FROM FER17_AUDITORIA_TRIGGERS WHERE esquema=DATABASE()`);
    for (const [name, tbl, timing, operation] of expectedTriggers) {
      if (!triggers.some(row => row.name === name && row.tbl === tbl && row.timing === timing
        && row.operation === operation && Number(row.vigente) === 1)) missing.push(name);
    }
  }
  if (missing.length) {
    throw new PriceVerificationError('ESQUEMA_INCOMPATIBLE', 409,
      `El esquema FER-17 en ${destination} está incompleto, es incompatible o no es visible: ${missing.join(', ')}.`);
  }
}

async function run() {
  const options = parseArgs(argv);
  if (options.ayuda) {
    if (json) emitJson({ ok: true, ayuda: usage() });
    else console.log(usage());
    return 0;
  }

  if (!options.historial && !options.confirmar) {
    throw new PriceVerificationError('CONFIRMACION_REQUERIDA', 400,
      'Revisá manualmente el importe y la evidencia, y confirmá esa revisión con --confirmar.');
  }
  const productId = parsePositiveId(requireOption(options, 'producto'), 'El producto');
  if (options.historial) {
    if (['confirmar', 'confirmar-destino', 'importe', 'evidencia', 'admin'].some(key => Object.hasOwn(options, key))) {
      throw invalid('--historial solo admite --producto, --limite y --json.');
    }
    const limit = options.limite === undefined ? 50 : parsePositiveId(options.limite, 'El límite');
    if (limit > 200) throw invalid('El límite debe ser un entero entre 1 y 200.');
    const { initializeDatabase, destroyDatabase } = require('../dist/config/database.config.js');
    const { listPriceHistory } = require('../dist/services/pricing/price-verification.js');
    let history;
    try {
      await initializeDatabase();
      history = await listPriceHistory(productId, limit);
    } finally {
      await destroyDatabase();
    }
    if (json) {
      emitJson({ producto: productId, eventos: history });
      return 0;
    }
    if (history.length === 0) {
      console.log(`Sin eventos de precio para el producto ${productId}.`);
      return 0;
    }
    console.log(`Historial del producto ${productId} (más reciente primero):`);
    for (const event of history) {
      console.log([
        event.ocurridoUtc,
        event.tipo,
        event.resultado,
        `${event.precioAnterior ?? '—'} -> ${event.precioNuevo ?? '—'} USD`,
        `admin=${event.adminId ?? 'sistema/no informado'}`,
        event.evidencia ? `evidencia="${event.evidencia}"` : null,
        event.evidenciaAnterior ? `evidencia-anterior="${event.evidenciaAnterior}"` : null,
        event.motivo ? `motivo=${event.motivo}` : null,
        `evento=${event.idEvento}`,
      ].filter(Boolean).join(' | '));
    }
    return 0;
  }

  if (Object.hasOwn(options, 'limite')) throw invalid('--limite solo se admite con --historial.');
  const input = {
    productId,
    expectedPrice: normalizeExpectedPrice(requireOption(options, 'importe')),
    evidence: validateEvidenceReference(requireOption(options, 'evidencia')),
    adminId: parsePositiveId(requireOption(options, 'admin'), 'El operador'),
    confirmed: true,
  };
  if (!options['confirmar-destino']) {
    throw new PriceVerificationError('DESTINO_NO_CONFIRMADO', 400,
      'Indicá --confirmar-destino <host:puerto/base> de acuerdo con DB_HOST, DB_PORT y DB_NAME.');
  }
  const { env } = require('../dist/config/env.config.js');
  destination = `${env.db.host}:${env.db.port}/${env.db.database}`;
  if (options['confirmar-destino'] !== destination) {
    throw new PriceVerificationError('DESTINO_NO_COINCIDE', 409,
      `El destino confirmado no coincide con la configuración: ${destination}.`);
  }
  const { dataSource, initializeDatabase, destroyDatabase } = require('../dist/config/database.config.js');
  const { verifyProductPrice } = require('../dist/services/pricing/price-verification.js');
  let result;
  try {
    await initializeDatabase();
    await verifyDestination(dataSource, env.db.database);
    if (!json) console.log(`Base confirmada: ${destination}`);
    result = await verifyProductPrice(input);
  } finally {
    await destroyDatabase();
  }

  if (!result.ok) return reject(result);

  if (json) {
    emitJson(result);
  } else {
    console.log(`Verificación registrada para el producto ${result.productId}.`);
    console.log(`  Importe revisado: ${result.price} USD`);
    console.log(`  Operador ADMIN: ${result.adminId} <${result.adminEmail}>`);
    console.log(`  Verificado UTC: ${result.verifiedAt}`);
    console.log(`  Evidencia: ${result.evidence}`);
    console.log(`  FER17-v1: ${result.estadoFer17}`);
    console.log(`  Evento de auditoría: ${result.eventId}`);
  }
  if (!json && !result.publicado) {
    console.error(`Advertencia: la evidencia quedó registrada, pero FER17-v1 no publica DEFINIDO (${result.estadoFer17}).`);
  }
  return 0;
}

run().then(
  code => { process.exitCode = code; },
  error => {
    const { code, message } = error instanceof PriceVerificationError ? error : {
      code: 'ERROR_INTERNO',
      message: 'No se pudo completar el procedimiento. Revisá la configuración, la conexión y el historial antes de reintentar.',
    };
    process.exitCode = reject({ ok: false, code, message, eventId: null });
  },
);
