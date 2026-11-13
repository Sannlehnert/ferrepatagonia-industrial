<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
    <main class="fp-public grid min-h-[80vh] place-items-center bg-[var(--fp-bg)] p-6" aria-labelledby="access-denied-title">
        <section class="box-border w-full max-w-[560px] rounded-[var(--fp-radius-panel)] border border-[var(--fp-line)] bg-white p-6 sm:p-8">
            <p class="fp-kicker">403 · Acceso restringido</p>

            <h1 id="access-denied-title" class="fp-section-title">No tenés permiso para acceder</h1>

            <p class="fp-section-copy">
                Tu cuenta no tiene los permisos necesarios para consultar
                este recurso. Si creés que es un error, contactá con Administración.
            </p>

            <RouterLink
                :to="{ name: 'home' }"
                class="fp-action fp-action--primary fp-focus mt-6"
                >
                Volver al inicio
            </RouterLink>
        </section>
    </main>
</template>
