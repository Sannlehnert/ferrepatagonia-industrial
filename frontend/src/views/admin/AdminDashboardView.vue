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
    <section class="dashboard" aria-labelledby="admin-dashboard-title">
        <header class="dashboard-head">
            <p class="fp-kicker">Administración</p>
            <h1 id="admin-dashboard-title" class="fp-section-title">Dashboard</h1>
            <p class="dashboard-note">Vista de estructura con datos de ejemplo. No representa actividad real.</p>
        </header>

        <dl class="dashboard-metrics">
            <div
                v-for="metric in metrics"
                :key="metric.id"
                class="dashboard-metric"
            >
                <dt>{{ metric.label }}</dt>
                <dd>{{ metric.value }}</dd>
            </div>
        </dl>
    </section>
</template>

<style scoped>
.dashboard { max-width: 1100px; }
.dashboard-head { padding-block: .65rem 1.3rem; border-bottom: 1px solid var(--fp-line); }
.dashboard-note { max-width: 62ch; margin: .8rem 0 0; color: var(--fp-muted); }
.dashboard-metrics {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: .9rem;
    margin: 1.15rem 0 0;
}
.dashboard-metric {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--fp-line);
    border-top: 3px solid var(--fp-blue);
    border-radius: var(--fp-radius);
    background: var(--fp-bg);
    padding: 1.05rem;
}
dt { color: var(--fp-muted); font-size: .875rem; font-weight: 700; }
dd { margin: auto 0 0; padding-top: .6rem; color: var(--fp-navy); font-size: 2rem; font-weight: 800; line-height: 1; }
@media (min-width: 500px) {
    .dashboard-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1000px) {
    .dashboard-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
