<script setup lang="ts">
interface DashboardMetric {
    id: string
    label: string
    value: number
}

const metrics: readonly DashboardMetric[] = [
    { id: 'new-orders', label: 'Pedidos nuevos', value: 5 },
    { id: 'credit-orders', label: 'Pedidos con cuenta corriente', value: 5 },
    { id: 'new-receipts', label: 'Comprobantes nuevos', value: 5 },
    { id: 'pending-receipts', label: 'Comprobantes sin evaluar', value: 5 },
    { id: 'stock-alerts', label: 'Alertas de stock', value: 5 },
    { id: 'loyal-companies', label: 'Empresas fieles', value: 5 },
]
</script>

<template>
    <section aria-labelledby="admin-dashboard-title">
        <header class="mb-6">
            <h1 id="admin-dashboard-title" class="m-0 mb-3 text-[28px] font-semibold">Dashboard</h1>
            <p class="m-0 leading-6 text-slate-600">Vista de estructura con datos de ejemplo. No representa actividad real.</p>
        </header>

        <dl class="m-0 grid max-w-[900px] grid-cols-1 gap-6 min-[501px]:grid-cols-2 min-[1001px]:grid-cols-3">
            <div
                v-for="metric in metrics"
                :key="metric.id"
                class="rounded-lg border border-slate-200 bg-slate-50 p-6"
            >
            <dt class="text-sm leading-6">{{ metric.label }}</dt>
            <dd class="m-0 mt-3 text-[28px] font-bold text-[#145a8d]">{{ metric.value }}</dd>
            </div>
        </dl>
    </section>
</template>
