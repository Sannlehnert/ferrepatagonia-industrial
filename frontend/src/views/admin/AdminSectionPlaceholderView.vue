<script setup lang="ts">
const props = defineProps<{
    title: string
    description: string
}>()
</script>

<template>
    <section aria-labelledby="admin-section-title">
        <h1 id="admin-section-title">{{ props.title }}</h1>
        <p>{{ props.description }}</p>

        <div class="section-placeholder">
            Estructura de navegación disponible.
            El contenido funcional de esta sección está pendiente de integración.
        </div>
    </section>
</template>

<style scoped>
h1 {
    margin: 0 0 12px;
    font-size: 28px;
}

p {
    margin: 0;
    color: #475569;
    line-height: 1.5;
}

.section-placeholder {
    margin-top: 24px;
    padding: 24px;
    border: 1px dashed #cbd5e1;
    border-radius: 8px;
    background: #f8fafc;
    color: #475569;
    line-height: 1.6;
}
</style>