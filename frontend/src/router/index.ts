// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/mi-cuenta',
      component: () => import('@/views/cuenta/MiCuentaLayout.vue'),
      // meta: { requiresAuth: true }, ← se activa en #171
      children: [
        { path: '', redirect: { name: 'cuenta-datos' } },
        {
          path: 'datos',
          name: 'cuenta-datos',
          component: () => import('@/views/cuenta/DatosClientes.vue'),
        },
        {
          path: 'pedidos',
          name: 'cuenta-pedidos',
          component: () => import('@/views/cuenta/HistorialPedidos.vue'),
        },
      ],
    },
  ],
})

export default router