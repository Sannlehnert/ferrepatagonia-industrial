<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
    filterMenuByPermissions,
    getNavigableMenu,
    type MenuItem,
} from '@/config/menu'
import type { Permission } from '@/config/permissions'

const props = withDefaults(
    defineProps<{
        items: readonly MenuItem[]
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

const visibleItems = computed(() => {
    if (props.variant === 'account') {
        return filterMenuByPermissions(props.items, props.permissions)
    }
    return getNavigableMenu(props.items, props.permissions)
})

function getItemRoute(item: MenuItem) {
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

const linkClasses = computed(() => {
    const base =
        'box-border flex min-h-11 items-center px-3 py-2 no-underline focus-visible:outline-2 focus-visible:outline-offset-2'

    switch (props.variant) {
        case 'admin':
            return `${base} rounded-md border-s-2 border-transparent text-white hover:bg-[var(--fp-steel)] focus-visible:outline-[var(--fp-amber-light)] [&.router-link-active]:border-[var(--fp-amber-light)] [&.router-link-active]:bg-[var(--fp-steel)] [&.router-link-active]:font-bold`
        case 'account':
            return `${base} rounded-[8px] whitespace-nowrap shrink-0 md:shrink text-[#A7B6C4] hover:text-white hover:bg-[#103A5C]/40 focus-visible:outline-white transition-colors [&.router-link-active]:bg-[#103A5C] [&.router-link-active]:text-white [&.router-link-active]:font-semibold`
        case 'public':
            return `${base} rounded-md inline-flex justify-center bg-[#145a8d] px-6 text-white hover:bg-[#0b426b] focus-visible:outline-[#145a8d]`
        default:
            return `${base} rounded-md text-inherit hover:bg-slate-100 focus-visible:outline-[#145a8d] [&.router-link-active]:font-semibold`
    }
})
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
            class="navigation-menu__link"
            :class="linkClasses"
        >
            <span v-if="item.id === 'account-details' && props.variant === 'account'" class="hidden sm:inline">Configuración de datos</span>
            <span v-if="item.id === 'account-details' && props.variant === 'account'" class="sm:hidden">Mis datos</span>
            <span v-else>{{ item.label }}</span>
        </RouterLink>
    </nav>
</template>
