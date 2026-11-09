import { defineStore } from 'pinia'
import axios from 'axios'
import { currentSessionGeneration } from '@/services/sessionGeneration'
import {
    getCuentaCorriente,
    getCuentaCorrienteMovimientos,
    getCuentaCorrienteVencimientos,
} from '@/services/cuentaCorrienteService'
import type {
    CuentaCorrienteConsulta,
    CuentaCorrientePaginaMovimientos,
    CuentaCorrientePaginaVencimientos,
} from '@/types/cuentaCorriente'

function errorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error) && error.response?.status === 409) {
        return 'La información cambió durante la consulta. Actualizá la cuenta para continuar.'
    }
    return fallback
}

function hasItems<T>(
    page: CuentaCorrientePaginaMovimientos | CuentaCorrientePaginaVencimientos,
): page is Extract<typeof page, { items: T[] }> {
    return 'items' in page
}

export const useCuentaCorrienteStore = defineStore('cuenta-corriente', {
    state: () => ({
        consulta: null as CuentaCorrienteConsulta | null,
        movimientos: null as CuentaCorrientePaginaMovimientos | null,
        vencimientos: null as CuentaCorrientePaginaVencimientos | null,
        consultaCargando: false,
        movimientosCargando: false,
        vencimientosCargando: false,
        movimientosMasCargando: false,
        vencimientosMasCargando: false,
        consultaError: '',
        movimientosError: '',
        vencimientosError: '',
        requestId: 0,
    }),
    actions: {
        clear() {
            this.requestId += 1
            this.consulta = null
            this.movimientos = null
            this.vencimientos = null
            this.consultaCargando = false
            this.movimientosCargando = false
            this.vencimientosCargando = false
            this.movimientosMasCargando = false
            this.vencimientosMasCargando = false
            this.consultaError = ''
            this.movimientosError = ''
            this.vencimientosError = ''
        },
        isCurrent(requestId: number, session: number) {
            return requestId === this.requestId && session === currentSessionGeneration()
        },
        async load() {
            this.clear()
            const requestId = this.requestId
            const session = currentSessionGeneration()
            this.consultaCargando = true

            try {
                const consulta = await getCuentaCorriente()
                if (!this.isCurrent(requestId, session)) return
                this.consulta = consulta
                if (consulta.estado === 'SIN_CUENTA') return
            } catch (error: unknown) {
                if (this.isCurrent(requestId, session)) {
                    this.consultaError = errorMessage(error, 'No pudimos consultar tu cuenta corriente. Intentá nuevamente.')
                }
                return
            } finally {
                if (this.isCurrent(requestId, session)) this.consultaCargando = false
            }

            if (!this.isCurrent(requestId, session)) return
            this.movimientosCargando = true
            this.vencimientosCargando = true

            const [movimientos, vencimientos] = await Promise.allSettled([
                getCuentaCorrienteMovimientos(),
                getCuentaCorrienteVencimientos(),
            ])

            if (!this.isCurrent(requestId, session)) return
            this.movimientosCargando = false
            this.vencimientosCargando = false

            if (movimientos.status === 'fulfilled') this.movimientos = movimientos.value
            else this.movimientosError = errorMessage(
                movimientos.reason,
                'No pudimos cargar los movimientos. Actualizá la cuenta para reintentar.',
            )

            if (vencimientos.status === 'fulfilled') this.vencimientos = vencimientos.value
            else this.vencimientosError = errorMessage(
                vencimientos.reason,
                'No pudimos cargar los vencimientos. Actualizá la cuenta para reintentar.',
            )
        },
        async loadMoreMovimientos() {
            const cursor = this.movimientos && hasItems(this.movimientos)
                ? this.movimientos.siguienteCursor
                : null
            if (!cursor || this.movimientosMasCargando) return

            const requestId = this.requestId
            const session = currentSessionGeneration()
            this.movimientosMasCargando = true
            this.movimientosError = ''
            try {
                const page = await getCuentaCorrienteMovimientos(cursor)
                if (!this.isCurrent(requestId, session)) return
                const previous = this.movimientos
                if (!previous || !hasItems(previous) || !hasItems(page) ||
                    previous.revision !== page.revision || previous.corte !== page.corte) {
                    this.movimientosError = 'La consulta de movimientos cambió. Actualizá la cuenta para continuar.'
                    return
                }
                this.movimientos = { ...page, items: [...previous.items, ...page.items] }
            } catch (error: unknown) {
                if (this.isCurrent(requestId, session)) {
                    this.movimientosError = errorMessage(error, 'No pudimos cargar más movimientos. Intentá nuevamente.')
                }
            } finally {
                if (this.isCurrent(requestId, session)) this.movimientosMasCargando = false
            }
        },
        async loadMoreVencimientos() {
            const cursor = this.vencimientos && hasItems(this.vencimientos)
                ? this.vencimientos.siguienteCursor
                : null
            if (!cursor || this.vencimientosMasCargando) return

            const requestId = this.requestId
            const session = currentSessionGeneration()
            this.vencimientosMasCargando = true
            this.vencimientosError = ''
            try {
                const page = await getCuentaCorrienteVencimientos(cursor)
                if (!this.isCurrent(requestId, session)) return
                const previous = this.vencimientos
                if (!previous || !hasItems(previous) || !hasItems(page) ||
                    previous.revision !== page.revision || previous.corte !== page.corte) {
                    this.vencimientosError = 'La consulta de vencimientos cambió. Actualizá la cuenta para continuar.'
                    return
                }
                this.vencimientos = { ...page, items: [...previous.items, ...page.items] }
            } catch (error: unknown) {
                if (this.isCurrent(requestId, session)) {
                    this.vencimientosError = errorMessage(error, 'No pudimos cargar más vencimientos. Intentá nuevamente.')
                }
            } finally {
                if (this.isCurrent(requestId, session)) this.vencimientosMasCargando = false
            }
        },
    },
})
