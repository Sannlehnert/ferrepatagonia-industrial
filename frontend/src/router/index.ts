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
      path: '/admin',
      component: () => import('@/views/admin/AdminLayout.vue'),
      // Las restricciones del panel también se aplican a sus rutas hijas.
      meta: {
        requiresAuth: true,
        roles: ['ADMIN'],
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
            import('@/views/admin/AdminProductsListView.vue'),
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
          component: () => import('@/views/admin/AdminClientsView.vue'),
        },
      ],
    },
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

  if (!auth.sessionChecked) {
    await auth.fetchSession()
  }

  const requiresAuth = to.matched.some(
    (record) =>
      record.meta.requiresAuth || record.meta.roles !== undefined,
  )

  if (requiresAuth && !auth.isAuthenticated) {
    return {
      name: 'login',
      query: { redirect: to.fullPath },
      replace: true,
    }
  }

  // Incluye las restricciones declaradas en las rutas padre.
  const lacksRequiredRole = to.matched.some((record) => {
    const allowedRoles = record.meta.roles

    return (
      allowedRoles !== undefined &&
      (auth.rol === null || !allowedRoles.includes(auth.rol))
    )
  })

  if (lacksRequiredRole) {
    return { name: 'access-denied', replace: true }
  }

  if (
    (to.name === 'login' || to.name === 'registro') &&
    auth.isAuthenticated
  ) {
    return rutaPorRol(auth.rol)
  }
})

export default router