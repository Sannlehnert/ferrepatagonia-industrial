<script setup lang="ts">
const props = defineProps<{
    title: string
    description: string
}>()
</script>

<template>
    <section aria-labelledby="admin-section-title">
        <h1 id="admin-section-title" class="m-0 mb-3 text-[28px] font-semibold">{{ props.title }}</h1>
        <p class="m-0 leading-6 text-slate-600">{{ props.description }}</p>

        <div class="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 leading-relaxed text-slate-600">
            Estructura de navegación disponible.
            El contenido funcional de esta sección está pendiente de integración.
        </div>
    </section>
</template>