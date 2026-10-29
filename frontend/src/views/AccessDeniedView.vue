<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
    <main class="grid min-h-[80vh] place-items-center bg-[#f4f7fa] p-6 font-[Arial,sans-serif] text-[#0b2438]" aria-labelledby="access-denied-title">
        <section class="box-border w-full max-w-[560px] rounded-lg border border-slate-200 bg-white p-6 sm:p-8">
            <p class="mb-4 text-sm font-bold text-[#145a8d]">403 · Acceso restringido</p>

            <h1 id="access-denied-title" class="mb-4 text-[clamp(24px,4vw,32px)] font-semibold leading-tight">No tenés permiso para acceder</h1>

            <p class="m-0 leading-relaxed text-slate-600">
                Tu cuenta no tiene los permisos necesarios para consultar
                este recurso. Si creés que es un error, contactá con Administración.
            </p>

            <RouterLink
                :to="{ name: 'home' }"
                class="mt-6 inline-flex min-h-11 box-border items-center justify-center rounded-md bg-[#145a8d] px-5 py-3 font-bold text-white no-underline hover:bg-[#103a5c] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#145a8d]"
                >
                Volver al inicio
            </RouterLink>
        </section>
    </main>
</template>