<script setup lang="ts">
import { watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import PublicHeader from '@/components/PublicHeader.vue'
import PublicFooter from '@/components/PublicFooter.vue'
import CartDrawer from '@/components/CartDrawer.vue'
import { useAuthStore } from '@/stores/auth'
import { useCartPanelStore } from '@/stores/cartPanel'

const auth = useAuthStore()
const panel = useCartPanelStore()
const route = useRoute()

watch(() => route.fullPath, () => panel.close())

watch(
  () => [auth.user?.id, auth.rol, auth.sessionVersion],
  () => panel.close(),
)
</script>

<template>
  <div class="flex min-h-screen flex-col bg-[#f8fafc]">
    <PublicHeader />

    <div class="min-w-0 flex-1">
      <RouterView />
    </div>

    <PublicFooter />

    <CartDrawer
      v-if="panel.visible && auth.rol === 'CLIENTE'"
    />
  </div>
</template>