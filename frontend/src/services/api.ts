import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error)
    }

    const status = error.response?.status
    const url = error.config?.url ?? ''

    if (status === 401 && !url.includes('/auth/')) {
      const { useAuthStore } = await import('@/stores/auth')
      const { default: router } = await import('@/router')

      useAuthStore().clear()
      const actual = router.currentRoute.value
      if (actual.name !== 'login') {
        router.push({ name: 'login', query: { redirect: actual.fullPath } })
      }
    }

    if (status === 403 && url !== '/auth/logout') {
      const { default: router } = await import('@/router')

      if (router.currentRoute.value.name !== 'access-denied') {
        // Reemplaza la pantalla que recibió el rechazo, conservando la sesión.
        void router.replace({ name: 'access-denied' }).catch(
          (navigationError: unknown) => {
            console.error('No se pudo abrir acceso denegado.', navigationError)
          },
        )
      }
    }

    return Promise.reject(error)
  },
)

export default api
