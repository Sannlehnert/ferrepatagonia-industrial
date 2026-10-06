<!-- src/views/cuenta/MiCuentaLayout.vue -->
<script setup lang="ts"></script>

<template>
  <section class="cuenta">
    <aside class="cuenta__menu">
      <h2>Mi Cuenta</h2>
      <nav>
        <RouterLink :to="{ name: 'cuenta-datos' }">Mis datos</RouterLink>
        <RouterLink :to="{ name: 'cuenta-pedidos' }">Mis pedidos</RouterLink>
      </nav>
    </aside>

    <main class="cuenta__contenido">
      <RouterView />
    </main>
  </section>
</template>

<style scoped>
.cuenta { display: grid; grid-template-columns: 220px 1fr; gap: 2rem; padding: 2rem; }
.cuenta__menu nav { display: flex; flex-direction: column; gap: .5rem; }
.cuenta__menu a.router-link-active { font-weight: 600; }
@media (max-width: 700px) { .cuenta { grid-template-columns: 1fr; } }
</style>