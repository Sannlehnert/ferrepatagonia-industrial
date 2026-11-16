<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
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

const route = useRoute()
const router = useRouter()

const visibleItems = computed(() => getNavigableMenu(props.items, props.permissions))

function getItemRoute(item: MenuItem & { routeName: string }) {
    return { name: item.routeName, query: item.query }
}

function isItemActive(item: MenuItem & { routeName: string }): boolean {
    const targetPath = router.resolve(getItemRoute(item)).path.replace(/\/$/, '') || '/'
    const currentPath = route.path.replace(/\/$/, '') || '/'
    if (props.variant === 'account') {
        return currentPath === targetPath && (route.query.filtro ?? null) === (item.query?.filtro ?? null)
    }
    if (targetPath === '/admin' || targetPath === '/admin/dashboard') {
        return currentPath === targetPath
    }
    return currentPath === targetPath || currentPath.startsWith(targetPath + '/')
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

function getItemClasses(item: MenuItem & { routeName: string }) {
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
            ? 'flex-col'
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
            <span>{{ item.label }}</span>
        </RouterLink>
    </nav>
</template>
