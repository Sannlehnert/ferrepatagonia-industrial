<!-- src/views/cuenta/MiCuentaLayout.vue -->
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import AccountMenu from '@/components/AccountMenu.vue'
  import {
    getPermissionsForUser,
    type MenuUser,
  } from '@/config/permissions'

  // Temporal para verificar el menú.
  // Reemplazar por el usuario del store de sesión antes de cerrar #142.
  const currentUser = ref<MenuUser | null>({
    rol: 'CLIENTE',
    tipoCliente: 'PARTICULAR',
  })

  const permissions = computed(() =>
    getPermissionsForUser(currentUser.value),
  )
</script>

<template>
  <section class="cuenta">
    <aside class="cuenta__menu">
      <h2>Mi Cuenta</h2>
      <AccountMenu :permissions="permissions" />
    </aside>

    <main class="cuenta__contenido">
      <RouterView />
    </main>
  </section>
</template>

<style scoped>
  .cuenta { display: grid; grid-template-columns: 220px 1fr; gap: 2rem; padding: 2rem; }
  @media (max-width: 700px) { .cuenta { grid-template-columns: 1fr; } }
</style>