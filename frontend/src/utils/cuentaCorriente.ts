const usdFormatter = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeZone: 'America/Argentina/Buenos_Aires',
})

const civilDateFormatter = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeZone: 'UTC',
})

export function formatUsd(value: string | null | undefined): string {
    if (value == null || !/^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)) return 'No determinable'

    const negative = value.startsWith('-')
    const [wholePart = '0', fraction = '00'] = value.replace(/^-/, '').split('.')
    const whole = BigInt(wholePart)
    const parts = usdFormatter.formatToParts(negative ? -whole : whole)

    if (negative && whole === 0n) {
        const minusSign = usdFormatter.formatToParts(-1n).find(part => part.type === 'minusSign')?.value ?? '-'
        parts.unshift({ type: 'minusSign', value: minusSign })
    }

    return parts.map(part => part.type === 'fraction' ? fraction : part.value).join('')
}

export function formatInstant(value: string): string {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : dateFormatter.format(date)
}

export function formatCivilDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return 'Fecha no disponible'

    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
        return 'Fecha no disponible'
    }
    return civilDateFormatter.format(date)
}

export function coverageMessage(coverage: string): string {
    if (coverage === 'COMPLETA') return 'La información disponible tiene cobertura completa.'
    if (coverage === 'PARCIAL') return 'La información es parcial; los importes desconocidos no se muestran como cero.'
    return 'No hay cobertura financiera acreditada para determinar todos los importes.'
}
