<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
    <main class="access-denied" aria-labelledby="access-denied-title">
        <section class="access-denied__card">
            <p class="access-denied__code">403 · Acceso restringido</p>

            <h1 id="access-denied-title">No tenés permiso para acceder</h1>

            <p class="access-denied__message">
                Tu cuenta no tiene los permisos necesarios para consultar
                este recurso. Si creés que es un error, contactá con Administración.
            </p>

            <RouterLink
                :to="{ name: 'home' }"
                class="access-denied__button"
                >
                Volver al inicio
            </RouterLink>
        </section>
    </main>
</template>

<style scoped>
.access-denied {
    min-height: 80vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #f4f7fa;
    color: #0b2438;
    font-family: Arial, sans-serif;
}

.access-denied__card {
    box-sizing: border-box;
    width: 100%;
    max-width: 560px;
    padding: 32px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #fff;
}

.access-denied__code {
    margin: 0 0 16px;
    color: #145a8d;
    font-size: 14px;
    font-weight: 700;
}

h1 {
    margin: 0 0 16px;
    font-size: clamp(24px, 4vw, 32px);
    line-height: 1.2;
}

.access-denied__message {
    margin: 0;
    color: #475569;
    line-height: 1.6;
}

.access-denied__button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-height: 44px;
    margin-top: 24px;
    padding: 12px 20px;
    border-radius: 6px;
    background: #145a8d;
    color: #fff;
    font-weight: 700;
    text-decoration: none;
}

.access-denied__button:hover {
    background: #103a5c;
}

.access-denied__button:focus-visible {
    outline: 3px solid #145a8d;
    outline-offset: 4px;
}
</style>