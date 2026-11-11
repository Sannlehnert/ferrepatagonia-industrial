<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
    filterMenuByPermissions,
    getNavigableMenu,
    type MenuItem,
} from '@/config/menu'
import type { Permission } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

export type NavigationItem = MenuItem & {
    to?: string | { path?: string }
    query?: Record<string, any>
}

const props = withDefaults(
    defineProps<{
        items: readonly NavigationItem[]
        permissions: ReadonlySet<Permission>
        label: string
        orientation?: 'vertical' | 'horizontal'
        variant?: 'default' | 'admin' | 'account' | 'public'
    }>(),
    {
        orientation: 'vertical',
        variant: 'default',
    },
)

const route = useRoute()
const router = useRouter()

const isParticular = computed(() => {
    let u: Record<string, any> | null | undefined
    try {
        const auth = useAuthStore()
        u = auth?.user as Record<string, any> | null | undefined
    } catch {
        u = null
    }
    const tipo = u?.tipoCliente ?? u?.tipo_cliente ?? u?.cliente?.tipoCliente ?? u?.cliente?.tipo_cliente
    return tipo === 'PARTICULAR'
})

const visibleItems = computed<NavigationItem[]>(() => {
    let items = props.variant === 'account'
        ? filterMenuByPermissions(props.items, props.permissions)
        : getNavigableMenu(props.items, props.permissions)

    if (props.variant === 'account' && isParticular.value) {
        items = items.filter(
            item =>
                item.id !== 'account-credit' &&
                item.id !== 'account-credit-orders' &&
                item.label !== 'Cuenta corriente' &&
                item.label !== 'Pedidos con cuenta corriente',
        )
    }

    return items.map(item => {
        const routeTarget = getItemRoute(item)
        let resolvedPath: string | undefined
        if (router && typeof routeTarget === 'object' && routeTarget !== null && 'name' in routeTarget) {
            try {
                resolvedPath = router.resolve(routeTarget).path
            } catch {
                resolvedPath = undefined
            }
        }
        return {
            ...item,
            to: (item as NavigationItem).to ?? resolvedPath,
            query: (item as NavigationItem).query ?? (typeof routeTarget === 'object' && routeTarget !== null && 'query' in routeTarget ? (routeTarget.query as Record<string, any>) : undefined),
        }
    })
})

function getItemRoute(item: MenuItem | NavigationItem) {
    if (item.routeName) {
        return { name: item.routeName }
    }
    if (item.id === 'account-orders-without-receipt') {
        return { name: 'cuenta-pedidos', query: { filtro: 'sin-comprobante' } }
    }
    if (item.id === 'account-credit-orders') {
        return { name: 'cuenta-pedidos', query: { filtro: 'cuenta-corriente' } }
    }
    return { name: 'cuenta-pedidos' }
}

function isItemActive(item: NavigationItem): boolean {
    if (!route) return false

    // Variante Mi Cuenta: lógica granular con query params
    if (props.variant === 'account') {
        const path = (route.path || '').replace(/\/$/, '')
        const query = route.query || {}

        if (item.query?.filtro) {
            return (route.path === item.to && route.query.filtro === item.query.filtro) || (path === '/mi-cuenta/pedidos' && query.filtro === 'sin-comprobante')
        }
        if (item.to === '/mi-cuenta/pedidos') {
            return (route.path === '/mi-cuenta/pedidos' && !route.query.filtro) || (path === '/mi-cuenta/pedidos' && !query.filtro)
        }
        if (item.id === 'account-orders') {
            return path === '/mi-cuenta/pedidos' && !query.filtro
        }
        if (item.id === 'account-orders-without-receipt') {
            return path === '/mi-cuenta/pedidos' && query.filtro === 'sin-comprobante'
        }
        if (item.id === 'account-credit-orders') {
            return path === '/mi-cuenta/pedidos' && query.filtro === 'cuenta-corriente'
        }
        if (item.id === 'account-credit') {
            return path === '/mi-cuenta/cuenta-corriente'
        }
        if (item.id === 'account-details') {
            return path === '/mi-cuenta/datos'
        }
        return route.path === item.to
    }

    // Variante Administración (y cualquier otra):
    const targetPath = typeof item.to === 'string' ? item.to : (item.to?.path || '')
    if (!targetPath) return false

    // Exact match para Dashboard o ruta base
    if (targetPath === '/admin' || targetPath === '/admin/dashboard') {
        return route.path === targetPath
    }

    // Coincidencia por prefijo para subsecciones administrativas (/admin/productos, etc.)
    return route.path === targetPath || route.path.startsWith(targetPath + '/')
}

const linkClasses = computed(() => {
    const base =
        'box-border flex min-h-11 items-center px-3 py-2 no-underline focus-visible:outline-2 focus-visible:outline-offset-2'

    switch (props.variant) {
        case 'admin':
            return `${base} rounded-md border-s-2 border-transparent text-white hover:bg-[var(--fp-steel)] focus-visible:outline-[var(--fp-amber-light)] [&.router-link-active]:border-[var(--fp-amber-light)] [&.router-link-active]:bg-[var(--fp-steel)] [&.router-link-active]:font-bold`
        case 'account':
            return `${base} rounded-[8px] whitespace-nowrap shrink-0 md:shrink focus-visible:outline-white transition-colors`
        case 'public':
            return `${base} rounded-md inline-flex justify-center bg-[#145a8d] px-6 text-white hover:bg-[#0b426b] focus-visible:outline-[#145a8d]`
        default:
            return `${base} rounded-md text-inherit hover:bg-slate-100 focus-visible:outline-[#145a8d] [&.router-link-active]:font-semibold`
    }
})

function getItemClasses(item: NavigationItem) {
    if (props.variant === 'account') {
        return isItemActive(item)
            ? 'bg-[#103A5C] text-white font-semibold'
            : 'text-[#A7B6C4] hover:text-white hover:bg-[#103A5C]/40'
    }
    return ''
}
</script>

<template>
    <nav
        v-if="visibleItems.length > 0"
        :aria-label="props.label"
        class="flex gap-2"
        :class="props.variant === 'account'
            ? 'flex-row overflow-x-auto pb-2 md:flex-col md:space-y-3 md:gap-0 md:overflow-visible md:pb-0'
            : props.orientation === 'horizontal'
                ? 'flex-row flex-wrap gap-4'
                : 'flex-col'"
    >
        <RouterLink
            v-for="item in visibleItems"
            :key="item.id"
            :to="getItemRoute(item)"
            :aria-label="item.label"
            :aria-current="isItemActive(item) ? 'page' : undefined"
            :active-class="props.variant === 'account' ? '' : undefined"
            :exact-active-class="props.variant === 'account' ? '' : undefined"
            class="navigation-menu__link"
            :class="[linkClasses, getItemClasses(item)]"
        >
            <span v-if="item.id === 'account-details' && props.variant === 'account'" class="hidden sm:inline">Configuración de datos</span>
            <span v-if="item.id === 'account-details' && props.variant === 'account'" class="sm:hidden">Mis datos</span>
            <span v-else>{{ item.label }}</span>
        </RouterLink>
    </nav>
</template>
