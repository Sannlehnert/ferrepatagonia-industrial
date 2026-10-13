import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { Rol } from '@/types/auth'
import { rutaPorRol } from '@/utils/rutas'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    roles?: Rol[]
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
  path: '/registro',
  name: 'registro',
  component: () => import('@/views/cuenta/RegistroView.vue'),
    },
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
      meta: { requiresAuth: true, roles: ['CLIENTE'] },
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
  if (to.meta.roles && (!auth.rol || !to.meta.roles.includes(auth.rol))) {
    return { path: '/' }
  }

  if (to.name === 'login' && auth.isAuthenticated) {
    return auth.rol === 'ADMIN' ? { path: '/' } : { name: 'cuenta-datos' }
  }
  if ((to.name === 'login' || to.name === 'registro') && auth.isAuthenticated) {
  return auth.rol === 'ADMIN' ? { path: '/' } : { name: 'cuenta-datos' }
  }
  if ((to.name === 'login' || to.name === 'registro') && auth.isAuthenticated) {
  return rutaPorRol(auth.rol)
}
})
export default router