<script setup lang="ts">
import { onMounted, ref } from 'vue'
import axios from 'axios'
import { getAdminClients } from '@/services/adminClientService'
import type { AdminClient } from '@/types/adminClient'

const clients = ref<AdminClient[]>([])
const isLoading = ref(true)
const errorMessage = ref<string | null>(null)

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
})

function formatDate(value: string): string {
    const date = new Date(value)

    return Number.isNaN(date.getTime())
        ? 'Fecha no disponible'
        : dateFormatter.format(date)
}

async function loadClients(): Promise<void> {
    isLoading.value = true
    errorMessage.value = null

    try {
        clients.value = await getAdminClients()
    } catch (error: unknown) {
        const status = axios.isAxiosError(error)
            ? error.response?.status
            : undefined

        // La navegación por 401/403 se resuelve en el cliente HTTP compartido.
        errorMessage.value =
            status === 401 || status === 403
                ? 'No se pudo acceder al listado con la sesión actual.'
                : 'No pudimos cargar los clientes. Intentá nuevamente.'
    } finally {
        isLoading.value = false
    }
}

onMounted(() => {
    void loadClients()
})
</script>

<template>
    <section class="clients" aria-labelledby="clients-title">
        <header class="clients__header">
            <h1 id="clients-title">Clientes</h1>
            <p>Listado de clientes particulares y empresas registrados.</p>
        </header>

        <p v-if="isLoading" role="status">Cargando clientes…</p>

        <div v-else-if="errorMessage" class="clients__message">
            <p role="alert">{{ errorMessage }}</p>
            <button type="button" @click="loadClients">
                Reintentar
            </button>
        </div>

        <p v-else-if="clients.length === 0" role="status">
            Todavía no hay clientes registrados.
        </p>

        <div
            v-else
            class="clients__table-wrapper"
            role="region"
            aria-label="Listado de clientes; desplazamiento horizontal disponible"
            tabindex="0"
        >
            <table>
                <caption class="clients__caption">
                    Clientes registrados: {{ clients.length }}
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Nombre o razón social</th>
                        <th scope="col">Email</th>
                        <th scope="col">Fecha de registro</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="client in clients" :key="client.id">
                        <td>{{ client.nombreRazonSocial }}</td>
                        <td>{{ client.email }}</td>
                        <td>{{ formatDate(client.fechaRegistro) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>

<style scoped>
.clients {
    min-width: 0;
    color: #0b2438;
    font-family: Arial, sans-serif;
}

.clients__header {
    margin-bottom: 24px;
}

h1 {
    margin: 0 0 12px;
    font-size: 28px;
}

.clients__header p {
    margin: 0;
    color: #475569;
    line-height: 1.5;
}

.clients__table-wrapper {
    overflow-x: auto;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
}

table {
    width: 100%;
    min-width: 600px;
    border-collapse: collapse;
    text-align: left;
}

.clients__caption {
    padding: 16px;
    text-align: left;
    font-weight: 700;
}

th,
td {
    padding: 16px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
    line-height: 1.5;
}

th {
    background: #f4f7fa;
}

td {
    overflow-wrap: anywhere;
}

tbody tr:last-child td {
    border-bottom: 0;
}

.clients__message {
    padding: 20px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
}

.clients__message p {
    margin: 0 0 16px;
    line-height: 1.5;
}

button {
    min-height: 44px;
    padding: 10px 20px;
    border: 0;
    border-radius: 6px;
    background: #145a8d;
    color: #fff;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
}

button:hover {
    background: #103a5c;
}

button:focus-visible,
.clients__table-wrapper:focus-visible {
    outline: 3px solid #145a8d;
    outline-offset: 3px;
}
</style>