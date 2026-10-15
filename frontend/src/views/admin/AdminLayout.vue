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
    <div class="admin-layout">
        <aside class="admin-layout__sidebar" aria-label="Panel administrativo">
            <div class="admin-layout__brand">
                <strong>FERREPATAGONIA</strong>
                <span>INDUSTRIAL</span>
            </div>

            <div class="admin-layout__navigation">
                <AdminMenu :permissions="permissions" />
            </div>

            <div class="admin-layout__session">
                <button
                    type="button"
                    class="admin-layout__logout"
                    :disabled="saliendo"
                    @click="cerrarSesion"
                >
                    {{ saliendo ? 'Saliendo...' : 'Cerrar sesión' }}
                </button>
            </div>
        </aside>

        <main class="admin-layout__content">
            <RouterView />
        </main>
    </div>
</template>

<style scoped>
.admin-layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    min-height: 100vh;
    color: #0b2438;
    background: #fff;
    font-family: Arial, sans-serif;
}

.admin-layout__sidebar {
    display: flex;
    flex-direction: column;
    background: #0b2438;
    color: #fff;
}

.admin-layout__brand {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 32px 20px;
    border-bottom: 1px solid #33556f;
}

.admin-layout__brand strong {
    font-size: 14px;
}

.admin-layout__brand span {
    color: #b7c6d4;
    font-size: 10px;
    letter-spacing: 3px;
}

.admin-layout__navigation {
    flex: 1;
    padding: 24px 20px;
    font-size: 14px;
}

.admin-layout__content {
    min-width: 0;
    padding: 32px;
}

.admin-layout__session {
    padding: 20px;
    border-top: 1px solid #33556f;
}

.admin-layout__logout {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #fff;
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
}

.admin-layout__logout:hover:not(:disabled) {
    background: #103a5c;
}

.admin-layout__logout:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 3px;
}

.admin-layout__logout:disabled {
    opacity: 0.6;
    cursor: wait;
}

.admin-layout__navigation :deep(.navigation-menu__link) {
    display: flex;
    align-items: center;
    min-height: 44px;
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: 6px;
    color: #fff;
    text-decoration: none;
}

.admin-layout__navigation :deep(.navigation-menu__link:hover) {
    background: #103a5c;
}

.admin-layout__navigation :deep(.navigation-menu__link.router-link-active) {
    background: #145a8d;
    font-weight: 700;
}

.admin-layout__navigation :deep(.navigation-menu__link:focus-visible) {
    outline: 2px solid #fff;
    outline-offset: 3px;
}

@media (max-width: 700px) {
    .admin-layout {
        grid-template-columns: 1fr;
    }

    .admin-layout__brand {
        padding: 20px;
    }

    .admin-layout__navigation {
        padding: 20px;
    }

    .admin-layout__content {
        padding: 24px 16px;
    }
}
</style>
