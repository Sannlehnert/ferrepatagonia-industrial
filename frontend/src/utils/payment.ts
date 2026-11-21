import type {
    ClientPayment,
    PaymentCurrency,
    PaymentDocumentState,
    PaymentFinancialState,
} from '@/types/payment'

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)\.\d{2}$/
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

export function documentStateLabel(state: string): string {
    if (state === 'PENDIENTE') return 'Revisión documental pendiente'
    if (state === 'APROBADO') return 'Documento aprobado'
    if (state === 'RECHAZADO') return 'Documento rechazado'
    return 'Estado documental no determinable'
}

export function documentStateClasses(state: string): string {
    if (state === 'PENDIENTE') return 'border-amber-300 bg-amber-50 text-amber-900'
    if (state === 'APROBADO') return 'border-sky-300 bg-sky-50 text-sky-900'
    if (state === 'RECHAZADO') return 'border-red-300 bg-red-50 text-red-900'
    return 'border-slate-300 bg-slate-50 text-slate-700'
}

export function financialStateLabel(state: string): string {
    if (state === 'PENDIENTE') return 'Pago pendiente de acreditación'
    if (state === 'ACREDITADO') return 'Pago acreditado'
    if (state === 'RECHAZADO') return 'Pago rechazado'
    if (state === 'ANULADO') return 'Pago anulado'
    return 'Estado financiero no determinable'
}

export function financialStateClasses(state: string): string {
    if (state === 'PENDIENTE') return 'border-amber-300 bg-amber-50 text-amber-900'
    if (state === 'ACREDITADO') return 'border-emerald-300 bg-emerald-50 text-emerald-900'
    if (state === 'RECHAZADO' || state === 'ANULADO') return 'border-red-300 bg-red-50 text-red-900'
    return 'border-slate-300 bg-slate-50 text-slate-700'
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
