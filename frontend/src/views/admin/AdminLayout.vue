<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import AdminMenu from '@/components/AdminMenu.vue'
import { getPermissionsForRole, isRole } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const saliendo = ref(false)

async function cerrarSesion() {
    if (saliendo.value) return

    saliendo.value = true
    try {
        await auth.logout()
        await router.replace({ name: 'login' })
    } finally {
        saliendo.value = false
    }
}

const permissions = computed(() => {
    const role = auth.rol

    return getPermissionsForRole(isRole(role) ? role : null)
})
</script>

<template>
    <div class="grid min-h-screen grid-cols-[220px_minmax(0,1fr)] bg-white text-[#0b2438] max-[700px]:grid-cols-1">
        <aside class="flex flex-col bg-[#0b2438] text-white" aria-label="Panel administrativo">
            <div class="flex flex-col gap-1 border-b border-[#33556f] px-5 py-8 max-[700px]:py-5">
                <strong class="text-sm">FERREPATAGONIA</strong>
                <span class="text-[10px] tracking-[3px] text-[#b7c6d4]">INDUSTRIAL</span>
            </div>

            <div class="flex-1 px-5 py-6 text-sm max-[700px]:py-5">
                <AdminMenu :permissions="permissions" />
            </div>

            <div class="border-t border-[#33556f] p-5">
                <button
                    type="button"
                    class="min-h-11 w-full cursor-pointer rounded-md bg-transparent px-3 py-2 text-left text-sm text-white hover:bg-[#103a5c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60"
                    :disabled="saliendo"
                    @click="cerrarSesion"
                >
                    {{ saliendo ? 'Saliendo...' : 'Cerrar sesión' }}
                </button>
            </div>
        </aside>

        <main class="min-w-0 p-8 max-[700px]:px-4 max-[700px]:py-6">
            <RouterView />
        </main>
    </div>
</template>
