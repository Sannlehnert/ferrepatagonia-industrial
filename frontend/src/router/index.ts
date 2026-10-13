import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    roles?: string[]
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/acceso-denegado',
      name: 'access-denied',
      component: () => import('@/views/AccessDeniedView.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/cuenta/LoginView.vue'),
    },
    {
      path: '/mi-cuenta',
      component: () => import('@/views/cuenta/MiCuentaLayout.vue'),
      meta: { requiresAuth: true },
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

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.sessionChecked) await auth.fetchSession()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'cuenta-datos' }
  }
})

export default router