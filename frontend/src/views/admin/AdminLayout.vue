<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import AdminMenu from '@/components/AdminMenu.vue'
import CommerceIcon from '@/components/CommerceIcon.vue'
import PublicBrand from '@/components/PublicBrand.vue'
import { useNavigationDisclosure } from '@/composables/useNavigationDisclosure'
import { getPermissionsForRole, isRole } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const saliendo = ref(false)
const logoutError = ref('')
const content = ref<HTMLElement | null>(null)
const { expanded, trigger, panel, close, toggle, escape } = useNavigationDisclosure()

watch(() => route.fullPath, async () => {
    if (!expanded.value) return
    close()
    await nextTick()
    content.value?.focus()
})

async function cerrarSesion() {
    if (saliendo.value) return

    logoutError.value = ''
    saliendo.value = true
    try {
        if (await auth.logout()) await router.replace({ name: 'login' })
    } catch {
        logoutError.value = 'No se pudo cerrar la sesión. No se confirmó el cierre. Reintentá con Cerrar sesión.'
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
    <div class="admin-frame">
        <a href="#admin-content" class="fp-skip fp-focus" @click.prevent="content?.focus()">Ir al contenido principal</a>
        <aside class="admin-sidebar fp-dark" aria-label="Panel administrativo" @keydown.esc="escape">
            <div class="admin-top">
                <PublicBrand inverse />
                <button
                    ref="trigger"
                    type="button"
                    class="admin-toggle fp-action fp-action--dark fp-focus"
                    aria-label="Menú de administración"
                    aria-controls="admin-sidebar-body"
                    :aria-expanded="expanded"
                    @click="toggle"
                >
                    <CommerceIcon :name="expanded ? 'close' : 'menu'" />
                </button>
            </div>

            <div id="admin-sidebar-body" ref="panel" class="admin-sidebar-body" :class="{ 'is-open': expanded }">
                <div class="admin-nav">
                    <p class="fp-kicker">Administración</p>
                    <AdminMenu :permissions="permissions" />
                </div>
                <div class="admin-actions">
                    <RouterLink :to="{ name: 'home' }" class="admin-action fp-focus">
                        <CommerceIcon name="back" /> Volver a la tienda
                    </RouterLink>
                    <p v-if="logoutError" role="alert" class="admin-logout-error">{{ logoutError }}</p>
                    <button type="button" class="admin-action fp-focus" :disabled="saliendo" @click="cerrarSesion">
                        <CommerceIcon name="exit" /> {{ saliendo ? 'Saliendo...' : 'Cerrar sesión' }}
                    </button>
                </div>
            </div>
        </aside>

        <main id="admin-content" ref="content" class="admin-main" tabindex="-1">
            <RouterView />
        </main>
    </div>
</template>

<style scoped>
.admin-frame { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; min-height: 100vh; color: var(--fp-navy); }
.admin-sidebar { display: flex; flex-direction: column; background: var(--fp-navy); color: white; }
.admin-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: .65rem;
    padding: .7rem 1rem;
    border-bottom: 1px solid #36536a;
    --fp-brand-width: 184px;
}
.admin-toggle { width: 44px; padding: 0; background: transparent; }
.admin-sidebar-body { display: none; flex: 1; flex-direction: column; }
.admin-sidebar-body.is-open { display: flex; }
.admin-nav { flex: 1; padding: 1rem; font-size: .9rem; }
.admin-nav .fp-kicker { margin: .4rem .6rem .75rem; }
.admin-actions { display: grid; gap: .2rem; border-top: 1px solid #36536a; padding: .75rem 1rem; }
.admin-action {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: .6rem;
    width: 100%;
    min-height: 44px;
    padding: .5rem .7rem;
    border: 0;
    border-radius: var(--fp-radius);
    background: transparent;
    color: var(--fp-ink-soft);
    font: inherit;
    font-size: .875rem;
    text-decoration: none;
    text-align: start;
    cursor: pointer;
}
.admin-action:hover { background: var(--fp-steel); color: white; }
.admin-action:disabled { cursor: wait; opacity: .65; }
.admin-logout-error { margin: 0; color: #ffb9b9; font-size: .875rem; }
.admin-main { min-width: 0; padding: clamp(16px, 3vw, 44px); }
@media (min-width: 800px) {
    .admin-frame { grid-template-columns: 246px minmax(0, 1fr); grid-template-rows: 1fr; }
    .admin-sidebar { position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto; }
    .admin-top { padding: 1.3rem 1rem; }
    .admin-toggle { display: none; }
    .admin-sidebar-body { display: flex; }
}
</style>
