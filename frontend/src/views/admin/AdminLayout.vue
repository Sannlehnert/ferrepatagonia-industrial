<script setup lang="ts">
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import AdminMenu from '@/components/AdminMenu.vue'
import { getPermissionsForRole, isRole } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

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

            <!-- Integrar el cierre de sesión cuando esté disponible el flujo real. -->
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