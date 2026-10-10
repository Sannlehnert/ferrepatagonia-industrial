<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { accountMenu, getNavigableMenu } from '@/config/menu'
import type { Permission } from '@/config/permissions'

// Recibe los permisos desde el componente padre.
// No decide roles ni condiciones comerciales.
const props = defineProps<{
    permissions: ReadonlySet<Permission>
}>()

const visibleItems = computed(() =>
    getNavigableMenu(accountMenu, props.permissions),
)
</script>

<template>
    <nav aria-label="Menú de mi cuenta">
        <RouterLink
            v-for="item in visibleItems"
            :key="item.id"
            :to="{ name: item.routeName }"
        >
            {{ item.label }}
        </RouterLink>
    </nav>
</template>

<style scoped>
nav {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

a.router-link-active {
    font-weight: 600;
}
</style>