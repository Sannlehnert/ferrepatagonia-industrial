<script setup lang="ts">
import NavigationMenu from '@/components/NavigationMenu.vue'
import { accountMenu } from '@/config/menu'
import type { Permission } from '@/config/permissions'

const props = defineProps<{
    permissions: ReadonlySet<Permission>
}>()
</script>

<template>
    <NavigationMenu
        :items="accountMenu"
        :permissions="props.permissions"
        label="Menú de mi cuenta"
        variant="account"
    />
</template>