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
      path: '/admin',
      component: () => import('@/views/admin/AdminLayout.vue'),
      // #174: esta metadata debe ser aplicada por el guard de autenticación.
      // Declararla no protege las rutas por sí sola.
      meta: {
        requiresAuth: true,
        requiredRole: 'ADMIN',
      },
      children: [
        {
          path: '',
          redirect: { name: 'admin-dashboard' },
        },
        {
          path: 'dashboard',
          name: 'admin-dashboard',
          component: () => import('@/views/admin/AdminDashboardView.vue'),
        },
        {
          path: 'pedidos',
          name: 'admin-orders',
          component: () =>
            import('@/views/admin/AdminSectionPlaceholderView.vue'),
          props: {
            title: 'Pedidos',
            description: 'Consulta y seguimiento administrativo de pedidos.',
          },
        },
        {
          path: 'productos',
          name: 'admin-products',
          component: () =>
            import('@/views/admin/AdminSectionPlaceholderView.vue'),
          props: {
            title: 'Productos',
            description: 'Administración del catálogo, precios y stock.',
          },
        },
        {
          path: 'categorias',
          name: 'admin-categories',
          component: () =>
            import('@/views/admin/AdminSectionPlaceholderView.vue'),
          props: {
            title: 'Categorías',
            description: 'Organización de las categorías del catálogo.',
          },
        },
        {
          path: 'clientes',
          name: 'admin-clients',
          component: () =>
            import('@/views/admin/AdminSectionPlaceholderView.vue'),
          props: {
            title: 'Clientes',
            description: 'Consulta de clientes particulares y empresas.',
          },
        },
      ],
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