import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const url: string = err.config?.url ?? ''
    if (err.response?.status === 401 && !url.includes('/auth/')) {
      const { useAuthStore } = await import('@/stores/auth')
      const { default: router } = await import('@/router')
      useAuthStore().clear()
      router.push({ name: 'login' })
    }
    return Promise.reject(err)
  },
)

export default api