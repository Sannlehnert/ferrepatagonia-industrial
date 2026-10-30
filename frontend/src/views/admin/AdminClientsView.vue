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
    <section class="min-w-0 text-[#0b2438]" aria-labelledby="clients-title">
        <header class="mb-6">
            <h1 id="clients-title" class="m-0 mb-3 text-[28px] font-semibold">Clientes</h1>
            <p class="m-0 leading-6 text-slate-600">Listado de clientes particulares y empresas registrados.</p>
        </header>

        <p v-if="isLoading" role="status" class="text-slate-600">Cargando clientes…</p>

        <div v-else-if="errorMessage" class="rounded-lg border border-slate-200 bg-slate-50 p-5">
            <p class="m-0 mb-4 leading-6" role="alert">{{ errorMessage }}</p>
            <button class="min-h-11 rounded-md border-0 bg-[#145a8d] px-5 py-2 font-bold text-white hover:bg-[#103a5c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]" type="button" @click="loadClients">
                Reintentar
            </button>
        </div>

        <p v-else-if="clients.length === 0" class="text-slate-600" role="status">
            Todavía no hay clientes registrados.
        </p>

        <div
            v-else
            class="overflow-x-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
            role="region"
            aria-label="Listado de clientes; desplazamiento horizontal disponible"
            tabindex="0"
        >
            <table class="w-full min-w-[600px] border-collapse text-left">
                <caption class="p-4 text-left font-bold">
                    Clientes registrados: {{ clients.length }}
                </caption>
                <thead>
                    <tr>
                        <th class="bg-[#f4f7fa] p-4 text-left align-top leading-6" scope="col">Nombre o razón social</th>
                        <th class="bg-[#f4f7fa] p-4 text-left align-top leading-6" scope="col">Email</th>
                        <th class="bg-[#f4f7fa] p-4 text-left align-top leading-6" scope="col">Fecha de registro</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="client in clients" :key="client.id">
                        <td class="break-words border-b border-slate-200 p-4 align-top leading-6">{{ client.nombreRazonSocial }}</td>
                        <td class="break-words border-b border-slate-200 p-4 align-top leading-6">{{ client.email }}</td>
                        <td class="break-words border-b border-slate-200 p-4 align-top leading-6">{{ formatDate(client.fechaRegistro) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>