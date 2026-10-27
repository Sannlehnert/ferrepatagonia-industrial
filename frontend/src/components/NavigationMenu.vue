<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
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

const visibleItems = computed(() =>
    getNavigableMenu(props.items, props.permissions),
)

const linkClasses = computed(() => {
    const base =
        'box-border flex min-h-11 items-center rounded-md px-3 py-2 no-underline focus-visible:outline-2 focus-visible:outline-offset-2'

    switch (props.variant) {
        case 'admin':
            return `${base} text-white hover:bg-[#103a5c] focus-visible:outline-white [&.router-link-active]:bg-[#145a8d] [&.router-link-active]:font-bold`
        case 'account':
            return `${base} text-[#103a5c] hover:bg-slate-100 focus-visible:outline-[#145a8d] [&.router-link-active]:bg-[#e6eff6] [&.router-link-active]:font-semibold`
        case 'public':
            return `${base} inline-flex justify-center bg-[#145a8d] px-6 text-white hover:bg-[#0b426b] focus-visible:outline-[#145a8d]`
        default:
            return `${base} text-inherit hover:bg-slate-100 focus-visible:outline-[#145a8d] [&.router-link-active]:font-semibold`
    }
})
</script>

<template>
    <nav
        v-if="visibleItems.length > 0"
        :aria-label="props.label"
        class="flex flex-col gap-2"
        :class="{
            'flex-row flex-wrap gap-4': props.orientation === 'horizontal',
        }"
    >
        <RouterLink
            v-for="item in visibleItems"
            :key="item.id"
            :to="{ name: item.routeName }"
            class="navigation-menu__link"
            :class="linkClasses"
        >
            {{ item.label }}
        </RouterLink>
    </nav>
</template>