<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
    <div class="admin-layout">
        <aside class="admin-layout__sidebar" aria-label="Panel administrativo">
            <div class="admin-layout__brand">
                <strong>FERREPATAGONIA</strong>
                <span>INDUSTRIAL</span>
            </div>

            <!-- #176: integrar AdminMenu desde FER-4, sin duplicar sus opciones. -->
            <div class="admin-layout__navigation">
                <p>Panel administrativo</p>
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

@media (max-width: 700px) {
    .admin-layout {
        grid-template-columns: 1fr;
    }

    .admin-layout__brand {
        padding: 20px;
    }

    .admin-layout__navigation {
        padding: 0 20px 12px;
    }

    .admin-layout__content {
        padding: 24px 16px;
    }
}
</style>