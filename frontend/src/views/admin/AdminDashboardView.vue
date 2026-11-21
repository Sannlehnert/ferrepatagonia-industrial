<script setup lang="ts">
import AdminDashboardOrders from '@/components/AdminDashboardOrders.vue'
</script>

<template>
  <section class="min-w-0 max-w-7xl" aria-labelledby="admin-dashboard-title">
    <header class="mb-6 border-b border-slate-200 pb-5">
      <p class="fp-kicker">Administración</p>
      <h1 id="admin-dashboard-title" class="fp-section-title">Dashboard</h1>
    </header>
    <AdminDashboardOrders />
  </section>
</template>
