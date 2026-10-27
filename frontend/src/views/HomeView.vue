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
    <main
        class="grid min-h-[80vh] place-items-center bg-[#f4f7fa] p-6 font-[Arial,sans-serif] text-[#0b2438]"
        aria-labelledby="home-title"
    >
        <section class="box-border w-full max-w-[640px] rounded-lg border border-slate-200 bg-white p-8">
            <p class="m-0 mb-4 text-sm font-bold tracking-[0.08em] text-[#145a8d]">FERREPATAGONIA INDUSTRIAL</p>
            <h1 id="home-title" class="mt-0 mb-4 text-[clamp(24px,4vw,32px)] leading-[1.2]">Bienvenido a Ferrepatagonia</h1>

            <div class="mb-5">
                <PublicMenu :permissions="permissions" />
            </div>

            <p class="m-0 leading-[1.6] text-slate-600">
                Estamos preparando nuestro sitio. Ya podés explorar nuestro catálogo.
            </p>
        </section>
    </main>
</template>