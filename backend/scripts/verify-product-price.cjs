#!/usr/bin/env node
'use strict';

// T-S7-05.2 — authorized local price verification.
// Deliberately NOT an HTTP endpoint: it runs with the backend's operational DB
// credential and never accepts an identity from a browser request.

const {
  PriceVerificationError,
  verifyProductPrice,
  listPriceHistory,
} = require('../dist/services/pricing/price-verification.js');
const { initializeDatabase, destroyDatabase } = require('../dist/config/database.config.js');

const VALUE_OPTIONS = new Set(['producto', 'importe', 'evidencia', 'admin', 'limite']);
const FLAG_OPTIONS = new Set(['confirmar', 'historial', 'json', 'ayuda']);

function usage() {
  return `Uso:
  npm run precio:verificar -- --producto <id> --importe <USD> --evidencia "<referencia>" --admin <id> --confirmar
  npm run precio:historial -- --producto <id> [--limite 50] [--json]

Opciones:
  --producto   ID del producto revisado.
  --importe    Importe exacto en USD revisado (cadena, hasta 2 decimales).
  --evidencia  Referencia comercial verificable (documento, origen y localizador).
  --admin      ID de un ADMIN activo que realiza la revisión.
  --confirmar  Confirma explícitamente la revisión manual. Obligatorio para verificar.
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
    if (!arg.startsWith('--') || arg.length === 2) throw new Error(`Argumento inválido: ${arg}`);
    const key = arg.slice(2);
    if (FLAG_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(key)) throw new Error(`Opción desconocida: --${key}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Falta el valor de --${key}`);
    options[key] = value;
  }
  return options;
}

function requireOption(options, key) {
  if (typeof options[key] !== 'string' || options[key].trim() === '') {
    throw new Error(`Falta --${key}.`);
  }
  return options[key];
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.ayuda) {
    console.log(usage());
    return 0;
  }

  const productId = requireOption(options, 'producto');
  if (options.historial) {
    const limit = options.limite === undefined ? 50 : Number(options.limite);
    await initializeDatabase();
    let history;
    try {
      history = await listPriceHistory(Number(productId), limit);
    } finally {
      await destroyDatabase();
    }
    if (options.json) {
      console.log(JSON.stringify({ producto: Number(productId), eventos: history }, null, 2));
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

  if (!options.confirmar) {
    throw new Error('La verificación exige --confirmar después de revisar manualmente el importe y la evidencia.');
  }

  const input = {
    productId: Number(productId),
    expectedPrice: requireOption(options, 'importe'),
    evidence: requireOption(options, 'evidencia'),
    adminId: Number(requireOption(options, 'admin')),
    confirmed: true,
  };

  await initializeDatabase();
  let result;
  try {
    result = await verifyProductPrice(input);
  } finally {
    await destroyDatabase();
  }

  if (!result.ok) {
    console.error(`[${result.code}] ${result.message}`);
    if (result.eventId) console.error(`Resultado registrado en auditoría: evento ${result.eventId}.`);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Verificación registrada para el producto ${result.productId}.`);
    console.log(`  Importe revisado: ${result.price} USD`);
    console.log(`  Operador ADMIN: ${result.adminId} <${result.adminEmail}>`);
    console.log(`  Verificado UTC: ${result.verifiedAt}`);
    console.log(`  Evidencia: ${result.evidence}`);
    console.log(`  FER17-v1: ${result.estadoFer17}`);
    console.log(`  Evento de auditoría: ${result.eventId}`);
  }
  if (!result.publicado) {
    console.error(`Advertencia: la evidencia quedó registrada, pero FER17-v1 no publica DEFINIDO (${result.estadoFer17}).`);
  }
  return 0;
}

run().then(
  code => { process.exitCode = code; },
  error => {
    if (error instanceof PriceVerificationError) {
      console.error(`[${error.code}] ${error.message}`);
    } else if (error instanceof Error && !/^Argumento|^Opción|^Falta/.test(error.message)) {
      console.error('Error interno al ejecutar la verificación de precios. Revisá la conectividad y la migración.');
    } else {
      console.error(error.message);
      console.error(usage());
    }
    process.exitCode = 1;
  },
);
