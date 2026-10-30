<script setup lang="ts">
import NavigationMenu from '@/components/NavigationMenu.vue'
import { adminMenu } from '@/config/menu'
import type { Permission } from '@/config/permissions'

const props = defineProps<{
    permissions: ReadonlySet<Permission>
}>()
</script>

<template>
    <NavigationMenu
        :items="adminMenu"
        :permissions="props.permissions"
        label="Menú de administración"
        variant="admin"
    />
</template>