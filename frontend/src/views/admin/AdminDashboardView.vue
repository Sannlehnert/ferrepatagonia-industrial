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
        <header class="dashboard__header">
            <h1 id="admin-dashboard-title">Dashboard</h1>
            <p>Vista de estructura con datos de ejemplo. No representa actividad real.</p>
        </header>

        <dl class="dashboard__metrics">
            <div
                v-for="metric in metrics"
                :key="metric.id"
                class="dashboard__metric"
            >
            <dt>{{ metric.label }}</dt>
            <dd>{{ metric.value }}</dd>
            </div>
        </dl>
    </section>
</template>

<style scoped>
.dashboard__header {
    margin-bottom: 24px;
}

h1 {
    margin: 0 0 12px;
    font-size: 28px;
}

.dashboard__header p {
    margin: 0;
    color: #475569;
    line-height: 1.5;
}

.dashboard__metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
    max-width: 900px;
    margin: 0;
}

.dashboard__metric {
    padding: 24px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
}

dt {
    font-size: 14px;
    line-height: 1.5;
}

dd {
    margin: 12px 0 0;
    color: #145a8d;
    font-size: 28px;
    font-weight: 700;
}

@media (max-width: 1000px) {
    .dashboard__metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 500px) {
    .dashboard__metrics {
        grid-template-columns: 1fr;
    }
}
</style>