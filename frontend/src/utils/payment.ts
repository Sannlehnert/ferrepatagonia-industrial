import type { ReceiptReviewStatus } from '@/services/paymentReceiptService'
import type {
    OrderCommercialState,
    OrderDocumentState,
    OrderFinancialState,
    OrderStateBadgeMeta,
} from '@/types/orderStates'
import type {
    ClientPayment,
    PaymentCurrency,
    PaymentDocumentState,
    PaymentFinancialState,
} from '@/types/payment'

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)\.\d{2}$/
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const STATE_BADGE_TONES = {
    positive: {
        badgeClasses: 'bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]',
        dotClasses: 'bg-[#16A34A]',
    },
    warning: {
        badgeClasses: 'bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]',
        dotClasses: 'bg-[#B45309]',
    },
    preparation: {
        badgeClasses: 'bg-amber-100 text-amber-800 border border-amber-200',
        dotClasses: 'bg-[#D97706]',
    },
    info: {
        badgeClasses: 'bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD]',
        dotClasses: 'bg-[#0369A1]',
    },
    danger: {
        badgeClasses: 'bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA]',
        dotClasses: 'bg-[#DC2626]',
    },
    neutral: {
        badgeClasses: 'bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]',
        dotClasses: 'bg-[#64748B]',
    },
} as const

export const ORDER_COMMERCIAL_STATES: readonly OrderCommercialState[] = [
    'CONFIRMADO',
    'EN_PREPARACION',
    'ENVIADO',
    'ENTREGADO',
    'DEMO_REGISTRADO',
] as const

export const ORDER_COMMERCIAL_STATUS_LABELS: Readonly<Record<OrderCommercialState, string>> = {
    CONFIRMADO: 'Confirmado',
    EN_PREPARACION: 'En preparación',
    ENVIADO: 'Enviado',
    ENTREGADO: 'Entregado',
    DEMO_REGISTRADO: 'Registrado (DEMO)',
}

export const ORDER_PAYMENT_MODE_LABELS: Readonly<Record<string, string>> = {
    TRANSFERENCIA: 'Transferencia bancaria',
    CUENTA_CORRIENTE: 'Cuenta corriente',
    DEMO_DIRECTO: 'Pago directo (DEMO)',
    DEMO_CUENTA_CORRIENTE: 'Cuenta corriente (DEMO)',
}

const ORDER_FINANCIAL_STATE_LABELS: Readonly<Record<OrderFinancialState, string>> = {
    NO_DETERMINABLE: 'Estado financiero no determinable',
    SIN_PAGO_ACREDITADO: 'Sin pago acreditado',
    PAGO_PARCIAL: 'Pago parcial acreditado',
    ACREDITADO: 'Pago acreditado',
    CARGO_ANULADO: 'Cargo anulado',
    CARGO_PENDIENTE: 'Imputado a cuenta corriente — pendiente de cancelación',
    IMPUTADO_PARCIAL: 'Cancelado parcialmente en CC',
    CANCELADO_EN_CC: 'Cancelado en cuenta corriente',
}

const moneyFormatters: Record<PaymentCurrency, Intl.NumberFormat> = {
    USD: new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }),
    ARS: new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        currencyDisplay: 'code',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }),
}

export function formatPaymentMoney(
    value: string | null | undefined,
    currency: PaymentCurrency | null | undefined,
): string {
    if (value == null || !DECIMAL_PATTERN.test(value) || (currency !== 'USD' && currency !== 'ARS')) {
        return 'No determinable'
    }

    const negative = value.startsWith('-')
    const [wholePart = '0', fraction = '00'] = value.replace(/^-/, '').split('.')
    const whole = BigInt(wholePart)
    const parts = moneyFormatters[currency].formatToParts(negative ? -whole : whole)

    if (negative && whole === 0n) {
        const minusSign = moneyFormatters[currency].formatToParts(-1n)
            .find(part => part.type === 'minusSign')?.value ?? '-'
        parts.unshift({ type: 'minusSign', value: minusSign })
    }

    return parts.map(part => part.type === 'fraction' ? fraction : part.value).join('')
}

export function isValidPaymentAmount(value: string): boolean {
    const match = AMOUNT_PATTERN.exec(value.trim())
    if (!match) return false
    const cents = BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
    return cents > 0n && cents <= 999999999999n
}

export function toCents(value: string): bigint | null {
    if (!DECIMAL_PATTERN.test(value)) return null
    const negative = value.startsWith('-')
    const [whole = '0', fraction = '00'] = value.replace(/^-/, '').split('.')
    const cents = BigInt(whole) * 100n + BigInt(fraction)
    return negative ? -cents : cents
}

export function fromCents(cents: bigint): string {
    const absolute = cents < 0n ? -cents : cents
    return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

export function sumExactDecimals(values: Iterable<string>): string | null {
    let total = 0n
    for (const value of values) {
        const cents = toCents(value)
        if (cents === null) return null
        total += cents
    }
    return fromCents(total)
}

export function resolveOrderCommercialState(
    order: { estadoPedido?: string | null; estado: string },
): string {
    return order.estadoPedido ?? order.estado
}

export function orderCommercialStateLabel(status: string): string {
    if (Object.hasOwn(ORDER_COMMERCIAL_STATUS_LABELS, status)) {
        return ORDER_COMMERCIAL_STATUS_LABELS[status as OrderCommercialState]
    }
    return status
}

export function orderCommercialStateBadge(status: string): OrderStateBadgeMeta {
    const label = orderCommercialStateLabel(status)
    if (status === 'ENTREGADO') return { label, ...STATE_BADGE_TONES.positive }
    if (status === 'EN_PREPARACION') return { label, ...STATE_BADGE_TONES.preparation }
    if (status === 'ENVIADO') return { label, ...STATE_BADGE_TONES.info }
    return { label, ...STATE_BADGE_TONES.neutral }
}

export function orderPaymentModeLabel(mode: string): string {
    return ORDER_PAYMENT_MODE_LABELS[mode] ?? mode
}

export function documentStateLabel(state: string): string {
    if (state === 'PENDIENTE') return 'Revisión documental pendiente'
    if (state === 'APROBADO') return 'Documento aprobado'
    if (state === 'RECHAZADO') return 'Documento rechazado'
    return 'Estado documental no determinable'
}

const receiptReviewStatusLabels: Record<ReceiptReviewStatus, string> = {
    PENDIENTE: 'Pendiente de revisión documental',
    APROBADO: 'Documento aprobado',
    RECHAZADO: 'Documento rechazado',
}

export function receiptReviewStatusLabel(status: ReceiptReviewStatus): string {
    return receiptReviewStatusLabels[status]
}

export function documentStateClasses(state: string): string {
    if (state === 'PENDIENTE') return STATE_BADGE_TONES.warning.badgeClasses
    if (state === 'APROBADO') return STATE_BADGE_TONES.positive.badgeClasses
    if (state === 'RECHAZADO') return STATE_BADGE_TONES.danger.badgeClasses
    return STATE_BADGE_TONES.neutral.badgeClasses
}

export function documentStateDotClasses(state: string): string {
    if (state === 'PENDIENTE') return STATE_BADGE_TONES.warning.dotClasses
    if (state === 'APROBADO') return STATE_BADGE_TONES.positive.dotClasses
    if (state === 'RECHAZADO') return STATE_BADGE_TONES.danger.dotClasses
    return STATE_BADGE_TONES.neutral.dotClasses
}

export function receiptBadge(state: ReceiptReviewStatus | string): OrderStateBadgeMeta {
    if (state === 'APROBADO') return { label: 'Aprobado', ...STATE_BADGE_TONES.positive }
    if (state === 'PENDIENTE') return { label: 'Pendiente de revisión', ...STATE_BADGE_TONES.warning }
    if (state === 'RECHAZADO') return { label: 'Rechazado', ...STATE_BADGE_TONES.danger }
    return { label: 'Estado documental no determinable', ...STATE_BADGE_TONES.neutral }
}

export function orderDocumentStateBadge(
    state: OrderDocumentState | string | null | undefined,
    options?: { emptyLabel?: string },
): OrderStateBadgeMeta {
    if (state === 'APROBADO') return { label: 'Aprobado', ...STATE_BADGE_TONES.positive }
    if (state === 'PENDIENTE') return { label: 'Pendiente de revisión', ...STATE_BADGE_TONES.warning }
    if (state === 'RECHAZADO') return { label: 'Rechazado', ...STATE_BADGE_TONES.danger }
    if (state === 'SIN_COMPROBANTE' || state === 'NO_ADJUNTO') {
        return { label: options?.emptyLabel ?? 'Sin comprobante', ...STATE_BADGE_TONES.neutral }
    }
    return { label: 'Estado documental no determinable', ...STATE_BADGE_TONES.neutral }
}

export function orderFinancialStateLabel(
    state: OrderFinancialState | string | null | undefined,
): string {
    if (typeof state === 'string' && Object.hasOwn(ORDER_FINANCIAL_STATE_LABELS, state)) {
        return ORDER_FINANCIAL_STATE_LABELS[state as OrderFinancialState]
    }
    return ORDER_FINANCIAL_STATE_LABELS.NO_DETERMINABLE
}

export function orderFinancialStateBadge(
    state: OrderFinancialState | string | null | undefined,
): OrderStateBadgeMeta {
    const label = orderFinancialStateLabel(state)
    if (state === 'ACREDITADO' || state === 'CANCELADO_EN_CC') {
        return { label, ...STATE_BADGE_TONES.positive }
    }
    if (state === 'SIN_PAGO_ACREDITADO' || state === 'CARGO_PENDIENTE') {
        return { label, ...STATE_BADGE_TONES.warning }
    }
    if (state === 'PAGO_PARCIAL' || state === 'IMPUTADO_PARCIAL') {
        return { label, ...STATE_BADGE_TONES.info }
    }
    if (state === 'CARGO_ANULADO') {
        return { label, ...STATE_BADGE_TONES.danger }
    }
    return { label, ...STATE_BADGE_TONES.neutral }
}

export function orderFinancialStateExplanation(
    state: OrderFinancialState | string | null | undefined,
    documentState?: OrderDocumentState | string | null,
): string {
    if (state === 'ACREDITADO') {
        return 'El pago directo en USD fue acreditado por administración.'
    }
    if (state === 'PAGO_PARCIAL') {
        return 'Se acreditó un pago parcial en USD; resta acreditar el saldo pendiente.'
    }
    if (state === 'SIN_PAGO_ACREDITADO') {
        if (documentState === 'APROBADO') {
            return 'El comprobante fue aprobado documentalmente, pero el pago todavía no fue acreditado.'
        }
        if (documentState === 'PENDIENTE') {
            return 'Hay un comprobante en revisión documental. La carga del archivo no acredita el pago.'
        }
        if (documentState === 'RECHAZADO') {
            return 'El comprobante fue rechazado y no hay fondos acreditados. Se requiere un nuevo comprobante.'
        }
        return 'No hay pagos acreditados para este pedido. Confirmar o entregar el pedido no implica pago.'
    }
    if (state === 'CARGO_PENDIENTE') {
        return 'El pedido generó un cargo vigente en cuenta corriente que todavía está pendiente de cancelación.'
    }
    if (state === 'IMPUTADO_PARCIAL') {
        return 'El cargo en cuenta corriente registra una cancelación parcial mediante abonos acreditados.'
    }
    if (state === 'CANCELADO_EN_CC') {
        return 'El cargo en cuenta corriente fue cancelado íntegramente por abonos acreditados.'
    }
    if (state === 'CARGO_ANULADO') {
        return 'El cargo asociado en cuenta corriente fue anulado por administración.'
    }
    return 'El estado financiero no puede determinarse con los datos acreditados disponibles.'
}

export function formatAccreditedUsdSummary(
    state: OrderFinancialState | string | null | undefined,
    montoAcreditadoUSD: string | null | undefined,
): string | null {
    if (!montoAcreditadoUSD || !DECIMAL_PATTERN.test(montoAcreditadoUSD)) return null
    if (state === 'PAGO_PARCIAL' || state === 'ACREDITADO') {
        return `Acreditado: ${formatPaymentMoney(montoAcreditadoUSD, 'USD')}`
    }
    if (state === 'IMPUTADO_PARCIAL' || state === 'CANCELADO_EN_CC') {
        return `Cancelado en CC: ${formatPaymentMoney(montoAcreditadoUSD, 'USD')}`
    }
    return null
}

export function financialStateLabel(state: string): string {
    if (state === 'PENDIENTE') return 'Pago pendiente de acreditación'
    if (state === 'ACREDITADO') return 'Pago acreditado'
    if (state === 'RECHAZADO') return 'Pago rechazado'
    if (state === 'ANULADO') return 'Pago anulado'
    return 'Estado financiero no determinable'
}

export function financialStateClasses(state: string): string {
    if (state === 'PENDIENTE') return STATE_BADGE_TONES.warning.badgeClasses
    if (state === 'ACREDITADO') return STATE_BADGE_TONES.positive.badgeClasses
    if (state === 'RECHAZADO' || state === 'ANULADO') return STATE_BADGE_TONES.danger.badgeClasses
    return STATE_BADGE_TONES.neutral.badgeClasses
}

export function financialStateDotClasses(state: string): string {
    if (state === 'PENDIENTE') return STATE_BADGE_TONES.warning.dotClasses
    if (state === 'ACREDITADO') return STATE_BADGE_TONES.positive.dotClasses
    if (state === 'RECHAZADO' || state === 'ANULADO') return STATE_BADGE_TONES.danger.dotClasses
    return STATE_BADGE_TONES.neutral.dotClasses
}

export function paymentStatusExplanation(payment: ClientPayment): string {
    if (payment.estado === 'ACREDITADO') {
        return 'El pago fue acreditado por administración. El abono confirmado figura en la cuenta corriente.'
    }
    if (payment.estado === 'RECHAZADO') {
        return 'El pago fue rechazado. No se acreditó dinero en la cuenta corriente.'
    }
    if (payment.estado === 'ANULADO') {
        return 'El pago fue anulado. No se acreditó dinero en la cuenta corriente.'
    }
    if (payment.estadoDocumental === 'APROBADO') {
        return 'La revisión documental fue aprobada, pero el pago todavía no está acreditado. Aprobar el documento no acredita dinero.'
    }
    if (payment.estadoDocumental === 'RECHAZADO') {
        return 'La revisión documental fue rechazada. No se acreditó dinero en la cuenta corriente.'
    }
    return 'La declaración está pendiente de revisión documental y financiera. Todavía no representa dinero acreditado.'
}

export function paymentDocumentState(payment: ClientPayment): PaymentDocumentState {
    if (payment.estadoDocumental === 'PENDIENTE' ||
        payment.estadoDocumental === 'APROBADO' ||
        payment.estadoDocumental === 'RECHAZADO') {
        return payment.estadoDocumental
    }
    return 'PENDIENTE'
}

export function paymentFinancialState(payment: ClientPayment): PaymentFinancialState | 'OTRO' {
    if (payment.estado === 'PENDIENTE' ||
        payment.estado === 'ACREDITADO' ||
        payment.estado === 'RECHAZADO' ||
        payment.estado === 'ANULADO') {
        return payment.estado
    }
    return 'OTRO'
}

export function newIdempotencyKey(): string {
    const cryptoApi = globalThis.crypto
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return cryptoApi.randomUUID()
    }
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
        throw new Error('El navegador no puede generar una clave de idempotencia segura.')
    }
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function isIdempotencyKey(value: string | null | undefined): value is string {
    return typeof value === 'string' && UUID_V4_PATTERN.test(value)
}
