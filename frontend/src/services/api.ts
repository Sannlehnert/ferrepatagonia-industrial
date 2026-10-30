import axios from 'axios'
import { currentSessionGeneration } from './sessionGeneration'

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    sessionGeneration?: number
  }
}

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// Synchronous capture at dispatch, including requests sent during login/logout.
api.interceptors.request.use(config => {
  config.sessionGeneration = currentSessionGeneration()
  return config
}, undefined, { synchronous: true })

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error)
    }

    const status = error.response?.status
    const url = error.config?.url ?? ''

    const isCurrent = () => error.config?.sessionGeneration === currentSessionGeneration()

    if (status === 401 && !url.includes('/auth/')) {
      if (!isCurrent()) return Promise.reject(error)
      const { useAuthStore } = await import('@/stores/auth')
      if (!isCurrent()) return Promise.reject(error)
      const { default: router } = await import('@/router')
      if (!isCurrent()) return Promise.reject(error)

      useAuthStore().clear()
      const actual = router.currentRoute.value
      if (actual.name !== 'login') {
        router.push({ name: 'login', query: { redirect: actual.fullPath } })
      }
    }

    if (status === 403 && url !== '/auth/logout') {
      if (!isCurrent()) return Promise.reject(error)
      const { default: router } = await import('@/router')
      if (!isCurrent()) return Promise.reject(error)

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
