const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

Object.assign(process.env, {
  JWT_SECRET: process.env.JWT_SECRET || '2bba238be4f1de0646384a41af287f48a9735015cdfd0347887226526104cf37',
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: process.env.DB_PORT || '1',
  DB_NAME: process.env.DB_NAME || 'unit',
  DB_USER: process.env.DB_USER || 'unit',
  DB_PASSWORD: process.env.DB_PASSWORD || 'unit',
});

require('./helpers/test-env.cjs');

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { after, describe, test } = require('node:test');
const { destroyDatabase } = require('../dist/config/database.config');

const {
  deriveOrderDocumentState,
  deriveOrderFinancialState,
  projectOrderStates,
} = require('../dist/services/orders/order-state-projection');
const { parseAdminOrderStatusBody } = require('../dist/dtos/orders/admin-order.dto');
const {
  normalizeReceiptIdempotencyKey,
  parseReceiptReviewBody,
} = require('../dist/services/receipts/receipt-types');
const {
  accreditAdminPaymentPolicy,
  closeAdminPaymentPolicy,
  createAdminPaymentPolicy,
  normalizePaymentIdempotencyKey,
  parseAdminPaymentListQuery,
  parseUtcIsoTimestamp,
} = require('../dist/dtos/payments/admin-payment.dto');
const { validateDtoSync } = require('../dist/dtos/validation');
const {
  accreditPaymentPayloadHash,
  legacyAccreditPaymentPayloadHash,
  matchesAccreditIdempotencyPayload,
  resolveUsdConversion,
} = require('../dist/services/payments/admin-payment.service');
const { AdminPaymentError } = require('../dist/services/payments/admin-payment.errors');
const { PricingError } = require('../dist/services/pricing/money');

describe('Task #317 (T-S7-04.2) — Consistencia de estados: proyección, DTOs e invariantes', () => {
  after(async () => {
    await destroyDatabase();
  });
  test('§7.2 deriveOrderDocumentState agrega comprobantes con precedencia APROBADO > PENDIENTE > RECHAZADO > SIN_COMPROBANTE', () => {
    assert.equal(deriveOrderDocumentState({ total: 0, aprobados: 0, pendientes: 0, rechazados: 0 }), 'SIN_COMPROBANTE');
    assert.equal(deriveOrderDocumentState({ total: 1, aprobados: 0, pendientes: 1, rechazados: 0 }), 'PENDIENTE');
    assert.equal(deriveOrderDocumentState({ total: 2, aprobados: 0, pendientes: 1, rechazados: 1 }), 'PENDIENTE');
    assert.equal(deriveOrderDocumentState({ total: 3, aprobados: 1, pendientes: 1, rechazados: 1 }), 'APROBADO');
    assert.equal(deriveOrderDocumentState({ total: 2, aprobados: 0, pendientes: 0, rechazados: 2 }), 'RECHAZADO');
  });

  test('§7.1.1 TRANSFERENCIA nunca marca pagado sin fondos acreditados en USD y proyecta parcial/acreditado/no determinable', () => {
    assert.deepEqual(
      projectOrderStates(
        'ENTREGADO',
        { total: 1, aprobados: 1, pendientes: 0, rechazados: 0 },
        { modalidadPago: 'TRANSFERENCIA', monedaTotal: 'USD', total: '150.00', totalAcreditadoUsd: '0.00' },
      ),
      {
        estadoPedido: 'ENTREGADO',
        estadoDocumental: 'APROBADO',
        estadoFinanciero: 'SIN_PAGO_ACREDITADO',
        montoAcreditadoUSD: '0.00',
      },
    );

    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'TRANSFERENCIA',
        monedaTotal: 'USD',
        total: '150.00',
        totalAcreditadoUsd: '49.99',
      }),
      { estadoFinanciero: 'PAGO_PARCIAL', montoAcreditadoUSD: '49.99' },
    );

    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'TRANSFERENCIA',
        monedaTotal: 'USD',
        total: '150.00',
        totalAcreditadoUsd: '150.00',
      }),
      { estadoFinanciero: 'ACREDITADO', montoAcreditadoUSD: '150.00' },
    );

    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'TRANSFERENCIA',
        monedaTotal: null,
        total: '150.00',
        totalAcreditadoUsd: '150.00',
      }),
      { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null },
    );

    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'TRANSFERENCIA',
        monedaTotal: 'USD',
        total: '150.00',
        pagosAcreditadosSinUsd: 1,
        totalAcreditadoUsd: '150.00',
      }),
      { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null },
    );
  });

  test('§7.1.2 CUENTA_CORRIENTE proyecta cargo pendiente, imputado parcial, cancelado, anulado y no determinable', () => {
    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'CUENTA_CORRIENTE',
        monedaTotal: 'USD',
        total: '200.00',
        cuentaCobertura: 'COMPLETA',
        cargoEstado: 'ACREDITADO',
        cargoMonto: '200.00',
        montoImputadoVigente: '0.00',
      }),
      { estadoFinanciero: 'CARGO_PENDIENTE', montoAcreditadoUSD: '0.00' },
    );

    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'CUENTA_CORRIENTE',
        monedaTotal: 'USD',
        total: '200.00',
        cuentaCobertura: 'COMPLETA',
        cargoEstado: 'ACREDITADO',
        cargoMonto: '200.00',
        montoImputadoVigente: '75.50',
      }),
      { estadoFinanciero: 'IMPUTADO_PARCIAL', montoAcreditadoUSD: '75.50' },
    );

    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'CUENTA_CORRIENTE',
        monedaTotal: 'USD',
        total: '200.00',
        cuentaCobertura: 'COMPLETA',
        cargoEstado: 'ACREDITADO',
        cargoMonto: '200.00',
        montoImputadoVigente: '200.00',
      }),
      { estadoFinanciero: 'CANCELADO_EN_CC', montoAcreditadoUSD: '200.00' },
    );

    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'CUENTA_CORRIENTE',
        monedaTotal: 'USD',
        total: '200.00',
        cuentaCobertura: 'COMPLETA',
        cargoEstado: 'ANULADO',
        cargoMonto: '200.00',
        montoImputadoVigente: '0.00',
      }),
      { estadoFinanciero: 'CARGO_ANULADO', montoAcreditadoUSD: '0.00' },
    );

    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'CUENTA_CORRIENTE',
        monedaTotal: 'USD',
        total: '200.00',
        cuentaCobertura: 'NO_ACREDITADA',
        cargoEstado: 'ACREDITADO',
        cargoMonto: '200.00',
        montoImputadoVigente: '200.00',
      }),
      { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null },
    );

    assert.deepEqual(
      deriveOrderFinancialState({
        modalidadPago: 'DEMO_DIRECTO',
        monedaTotal: 'USD',
        total: '200.00',
      }),
      { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null },
    );
  });

  test('NEG-03: PEDIDO.estado rechaza PAGADO, ACREDITADO y campos financieros adicionales', () => {
    assert.throws(
      () => parseAdminOrderStatusBody({ estado: 'PAGADO' }),
      err => err.status === 400 && err.code === 'ESTADO_PEDIDO_NO_AUTORIZADO',
    );
    assert.throws(
      () => parseAdminOrderStatusBody({ estado: 'ACREDITADO' }),
      err => err.status === 400 && err.code === 'ESTADO_PEDIDO_NO_AUTORIZADO',
    );
    assert.throws(
      () => parseAdminOrderStatusBody({ estado: 'EN_PREPARACION', pagado: true }),
      err => err.status === 400 && err.code === 'CAMPOS_NO_PERMITIDOS',
    );
  });

  test('NEG-08: revisión documental exige APROBADO o RECHAZADO con motivo obligatorio (1..1000) e Idempotency-Key UUID v4', () => {
    assert.deepEqual(parseReceiptReviewBody({ estado: 'APROBADO' }), { estado: 'APROBADO', motivo: null });
    assert.deepEqual(parseReceiptReviewBody({ estado: 'APROBADO', motivo: null }), { estado: 'APROBADO', motivo: null });
    assert.deepEqual(parseReceiptReviewBody({ estado: 'RECHAZADO', motivo: '  Imagen borrosa  ' }), {
      estado: 'RECHAZADO',
      motivo: 'Imagen borrosa',
    });

    for (const bad of [
      null,
      [],
      {},
      { estado: 'REVISADO' },
      { estado: 'PENDIENTE' },
      { estado: 'PAGADO' },
      { estado: 'APROBADO', motivo: 'No corresponde' },
      { estado: 'APROBADO', extra: 1 },
      { estado: 'RECHAZADO' },
      { estado: 'RECHAZADO', motivo: null },
      { estado: 'RECHAZADO', motivo: '   ' },
      { estado: 'RECHAZADO', motivo: 123 },
      { estado: 'RECHAZADO', motivo: 'x'.repeat(1001) },
    ]) {
      assert.throws(
        () => parseReceiptReviewBody(bad),
        err => err.status === 400 && err.code === 'SOLICITUD_INVALIDA',
        JSON.stringify(bad),
      );
    }

    assert.equal(
      normalizeReceiptIdempotencyKey('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'),
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    );
    assert.equal(normalizeReceiptIdempotencyKey('not-a-uuid'), null);
    assert.equal(normalizeReceiptIdempotencyKey(undefined), null);
  });

  test('INV-04 y NEG-10: DTOs de PAGO validan exclusividad de destino, monto > 0, moneda USD/ARS, evidencia y UTC', () => {
    const validPending = validateDtoSync(createAdminPaymentPolicy, {
      pedidoId: 10,
      monto: '125.50',
      moneda: 'USD',
      metodoPago: 'TRANSFERENCIA',
      estado: 'PENDIENTE',
    });
    assert.equal(validPending.valid, true);

    const validAccredited = validateDtoSync(createAdminPaymentPolicy, {
      cuentaCorrienteId: 4,
      monto: '1000.00',
      moneda: 'ARS',
      metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO',
      evidenciaAcreditacion: 'EXTRACTO-BNA-001',
      fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
    });
    assert.equal(validAccredited.valid, true);

    for (const invalid of [
      // Ambos destinos (viola INV-04)
      { pedidoId: 1, cuentaCorrienteId: 2, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
      // Ningún destino (viola INV-04)
      { monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
      // Monto cero o negativo (NEG-10)
      { pedidoId: 1, monto: '0.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
      { pedidoId: 1, monto: '-5.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
      { pedidoId: 1, monto: 10, moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
      // Moneda no admitida
      { pedidoId: 1, monto: '10.00', moneda: 'EUR', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
      // ACREDITADO sin evidencia o sin fecha UTC (NEG-10)
      { pedidoId: 1, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'ACREDITADO', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
      { pedidoId: 1, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'ACREDITADO', evidenciaAcreditacion: 'REF-1' },
      // PENDIENTE con evidencia
      { pedidoId: 1, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE', evidenciaAcreditacion: 'REF-1' },
      // Estado no permitido en creación
      { pedidoId: 1, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PAGADO' },
      // Campo extra
      { pedidoId: 1, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE', montoUsd: '10.00' },
    ]) {
      assert.equal(validateDtoSync(createAdminPaymentPolicy, invalid).valid, false, JSON.stringify(invalid));
    }

    assert.equal(
      validateDtoSync(accreditAdminPaymentPolicy, {
        evidenciaAcreditacion: 'REF-OK',
        fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      }).valid,
      true,
    );
    // R03: alias compatible con #333 (evidencia y fechaAcreditacionUtc opcional)
    const aliasAccreditation = validateDtoSync(accreditAdminPaymentPolicy, {
      evidencia: 'Extracto BNA #333',
    });
    assert.equal(aliasAccreditation.valid, true);
    assert.equal(aliasAccreditation.data.evidenciaAcreditacion, 'Extracto BNA #333');
    assert.equal(
      validateDtoSync(accreditAdminPaymentPolicy, {
        evidencia: 'Extracto A',
        evidenciaAcreditacion: 'Extracto B',
      }).valid,
      false,
    );
    assert.equal(
      validateDtoSync(accreditAdminPaymentPolicy, {
        evidencia: 'Extracto BNA',
        monto: '999.00',
      }).valid,
      false,
    );
    assert.equal(
      validateDtoSync(accreditAdminPaymentPolicy, {
        evidenciaAcreditacion: '   ',
        fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      }).valid,
      false,
    );
    assert.equal(validateDtoSync(closeAdminPaymentPolicy, { motivo: 'Error bancario' }).valid, true);
    assert.equal(validateDtoSync(closeAdminPaymentPolicy, { motivo: '   ' }).valid, false);
    assert.equal(parseUtcIsoTimestamp('2026-02-30T10:00:00Z'), null);
    assert.equal(normalizePaymentIdempotencyKey('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

    assert.deepEqual(parseAdminPaymentListQuery('/api/admin/pagos?limite=10&estado=ACREDITADO&pedidoId=5'), {
      limite: 10,
      estado: 'ACREDITADO',
      pedidoId: 5,
    });
    assert.throws(
      () => parseAdminPaymentListQuery('/api/admin/pagos?estado=PAGADO'),
      err => err.status === 400 && err.code === 'SOLICITUD_INVALIDA',
    );
    assert.throws(
      () => parseAdminPaymentListQuery('/api/admin/pagos?foo=bar'),
      err => err.status === 400 && err.code === 'SOLICITUD_INVALIDA',
    );
  });

  test('R01: resolveUsdConversion relanza errores SQL/concurrencia/infraestructura y solo traduce errores tipados FER17', async () => {
    const dummyManager = {};
    const at = new Date('2026-10-02T15:00:00.000Z');

    // Fallos de infraestructura, SQL y concurrencia JAMAS deben envolverse como 422 COTIZACION_FER17_NO_VERIFICADA
    const infraErrors = [
      Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 }),
      Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 }),
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('Connection lost: The server closed the connection'), { code: 'PROTOCOL_CONNECTION_LOST' }),
      Object.assign(new Error('SQL failure reading COTIZACION'), {
        name: 'QueryFailedError',
        driverError: { code: 'ER_BAD_FIELD_ERROR', errno: 1054 },
      }),
      new TypeError('Cannot read properties of undefined (reading dias_json)'),
      new Error('Fallo generico inesperado'),
    ];

    for (const injected of infraErrors) {
      await assert.rejects(
        () => resolveUsdConversion(dummyManager, 'ARS', 100000n, at, false, {
          quoteLoader: async () => { throw injected; },
        }),
        err => {
          assert.equal(err, injected, `Debe relanzar la instancia original: ${injected.message}`);
          assert.equal(err instanceof AdminPaymentError, false);
          assert.notEqual(err.status, 422);
          assert.notEqual(err.code, 'COTIZACION_FER17_NO_VERIFICADA');
          return true;
        },
      );
    }

    // Errores tipados FER17 SI se traducen de forma deterministica a 409 / 422
    await assert.rejects(
      () => resolveUsdConversion(dummyManager, 'ARS', 100000n, at, false, {
        quoteLoader: async () => { throw new PricingError('COTIZACION_AUSENTE'); },
      }),
      err => err instanceof AdminPaymentError && err.status === 409 && err.code === 'COTIZACION_AUSENTE',
    );

    await assert.rejects(
      () => resolveUsdConversion(dummyManager, 'ARS', 100000n, at, false, {
        quoteLoader: async () => { throw new PricingError('COTIZACION_INVALIDA'); },
      }),
      err => err instanceof AdminPaymentError && err.status === 422 && err.code === 'COTIZACION_FER17_NO_VERIFICADA',
    );

    await assert.rejects(
      () => resolveUsdConversion(dummyManager, 'ARS', 100000n, at, false, {
        isClientDeclared: true,
        quoteLoader: async () => { throw new PricingError('COTIZACION_INVALIDA'); },
      }),
      err => err instanceof AdminPaymentError && err.status === 422 && err.code === 'COTIZACION_INVALIDA',
    );

    await assert.rejects(
      () => resolveUsdConversion(dummyManager, 'ARS', 100000n, at, false, {
        quoteLoader: async () => { throw new Error('CALENDARIO_NO_VERIFICADO'); },
      }),
      err => err instanceof AdminPaymentError && err.status === 422 && err.code === 'COTIZACION_FER17_NO_VERIFICADA',
    );
  });

  test('R05: validación dual de idempotencia en acreditación (formato nuevo #317 y huella histórica #333)', () => {
    const pagoId = 42;
    const actorId = 7;
    const evidence = 'EXT-BNA-333';
    const expectedLegacy = createHash('sha256')
      .update(JSON.stringify(['ACREDITACION_PAGO', pagoId, actorId, evidence]))
      .digest('hex');

    const legacyHash = legacyAccreditPaymentPayloadHash(pagoId, actorId, evidence);
    assert.equal(legacyHash, expectedLegacy);

    const newHash = accreditPaymentPayloadHash(pagoId, evidence, '2026-10-02T15:00:00.000Z', 'Obs nueva');
    assert.notEqual(newHash, legacyHash);

    // Formato nuevo coincide solo con payload exacto del contrato nuevo
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: newHash,
        pagoId,
        actorId,
        evidence,
        normalizedRequestedDateIso: '2026-10-02T15:00:00.000Z',
        observaciones: 'Obs nueva',
        lockedAdminAccreditationId: actorId,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      true,
    );
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: newHash,
        pagoId,
        actorId,
        evidence,
        normalizedRequestedDateIso: '2026-10-02T15:00:00.000Z',
        observaciones: 'Obs distinta',
        lockedAdminAccreditationId: actorId,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      false,
    );

    // Huella histórica #333: acepta replay del mismo admin con misma evidencia y sin parámetros nuevos incompatibles
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: legacyHash,
        pagoId,
        actorId,
        evidence,
        normalizedRequestedDateIso: null,
        observaciones: undefined,
        lockedAdminAccreditationId: actorId,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
        lockedEvidenciaAcreditacion: evidence,
      }),
      true,
    );
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: legacyHash,
        pagoId,
        actorId,
        evidence,
        normalizedRequestedDateIso: null,
        observaciones: null,
        lockedAdminAccreditationId: null,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      true,
    );
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: legacyHash,
        pagoId,
        actorId,
        evidence,
        normalizedRequestedDateIso: '2026-10-02T15:00:00.000Z',
        observaciones: undefined,
        lockedAdminAccreditationId: actorId,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      true,
    );

    // Rechazos estrictos sobre huella histórica #333
    // 1. Actor distinto (por hash histórico y por id_admin_acreditacion)
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: legacyHash,
        pagoId,
        actorId: actorId + 1,
        evidence,
        normalizedRequestedDateIso: null,
        observaciones: undefined,
        lockedAdminAccreditationId: null,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      false,
    );
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: legacyHash,
        pagoId,
        actorId,
        evidence,
        normalizedRequestedDateIso: null,
        observaciones: undefined,
        lockedAdminAccreditationId: actorId + 1,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      false,
    );
    // 2. Evidencia distinta
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: legacyHash,
        pagoId,
        actorId,
        evidence: 'EXT-DISTINTA',
        normalizedRequestedDateIso: null,
        observaciones: undefined,
        lockedAdminAccreditationId: actorId,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      false,
    );
    // 3. Observaciones nuevas adicionales
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: legacyHash,
        pagoId,
        actorId,
        evidence,
        normalizedRequestedDateIso: null,
        observaciones: 'Observación adicional',
        lockedAdminAccreditationId: actorId,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      false,
    );
    // 4. fechaAcreditacionUtc explícita distinta
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: legacyHash,
        pagoId,
        actorId,
        evidence,
        normalizedRequestedDateIso: '2026-10-02T16:00:00.000Z',
        observaciones: undefined,
        lockedAdminAccreditationId: actorId,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      false,
    );
    // 5. Pago distinto
    assert.equal(
      matchesAccreditIdempotencyPayload({
        storedHash: legacyHash,
        pagoId: pagoId + 1,
        actorId,
        evidence,
        normalizedRequestedDateIso: null,
        observaciones: undefined,
        lockedAdminAccreditationId: actorId,
        lockedFechaAcreditacionIso: '2026-10-02T15:00:00.000Z',
      }),
      false,
    );
  });
});
