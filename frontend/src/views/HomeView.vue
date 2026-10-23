<script setup lang="ts">
import { computed } from 'vue'
import PublicMenu from '@/components/PublicMenu.vue'
import { getPermissionsForUser } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const permissions = computed(() =>
    getPermissionsForUser(
        auth.user
        ? {
            rol: auth.user.rol,
            tipoCliente: auth.user.tipo_cliente,
            }
        : null,
    ),
)
</script>

<template>
    <!-- Inicio temporal: reemplazar cuando se integre la Home definitiva. -->
    <main class="home" aria-labelledby="home-title">
        <section class="home__card">
            <p class="home__brand">FERREPATAGONIA INDUSTRIAL</p>
            <PublicMenu :permissions="permissions" />
            <h1 id="home-title">Bienvenido a Ferrepatagonia</h1>
            <p class="home__message">
                Explorá nuestro catálogo de productos y consultá su disponibilidad.
            </p>
            <RouterLink class="home__catalog-link" :to="{ name: 'catalogo' }">
                Ver catálogo
            </RouterLink>
        </section>
    </main>
</template>

<style scoped>
.home {
    min-height: 80vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #f4f7fa;
    color: #0b2438;
    font-family: Arial, sans-serif;
}

.home__card {
    box-sizing: border-box;
    width: 100%;
    max-width: 640px;
    padding: 32px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #fff;
}

.home__brand {
    margin: 0 0 16px;
    color: #145a8d;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.08em;
}

h1 {
    margin: 0 0 16px;
    font-size: clamp(24px, 4vw, 32px);
    line-height: 1.2;
}

.home__message {
    margin: 0;
    color: #475569;
    line-height: 1.6;
}

.home__catalog-link {
    display: inline-block;
    margin-top: 24px;
    padding: 12px 18px;
    border-radius: 6px;
    background: #145a8d;
    color: #fff;
    font-weight: 600;
    text-decoration: none;
}

.home__catalog-link:hover {
    background: #103a5c;
}
</style>