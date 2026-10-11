<script setup lang="ts">
import NavigationMenu from '@/components/NavigationMenu.vue'
import { publicMenu } from '@/config/menu'
import type { Permission } from '@/config/permissions'

const props = defineProps<{
    permissions: ReadonlySet<Permission>
}>()
</script>

<template>
    <NavigationMenu
        :items="publicMenu"
        :permissions="props.permissions"
        label="Menú principal"
        orientation="horizontal"
    />
</template>