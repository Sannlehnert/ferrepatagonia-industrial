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
const { describe, test } = require('node:test');

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

describe('Task #317 (T-S7-04.2) — Consistencia de estados: proyección, DTOs e invariantes', () => {
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
});
