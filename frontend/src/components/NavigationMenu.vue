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
    }>(),
    {
        orientation: 'vertical',
    },
)

const visibleItems = computed(() =>
    getNavigableMenu(props.items, props.permissions),
)
</script>

<template>
    <nav
        :aria-label="props.label"
        class="navigation-menu"
        :class="{
            'navigation-menu--horizontal': props.orientation === 'horizontal',
        }"
    >
        <RouterLink
            v-for="item in visibleItems"
            :key="item.id"
            :to="{ name: item.routeName }"
            class="navigation-menu__link"
        >
            {{ item.label }}
        </RouterLink>
    </nav>
</template>

<style scoped>
.navigation-menu {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.navigation-menu--horizontal {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 1rem;
}

.navigation-menu__link.router-link-active {
    font-weight: 600;
}
</style>