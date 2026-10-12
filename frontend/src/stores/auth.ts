import { defineStore } from 'pinia'
import api from '@/services/api'
import type { UsuarioSesion } from '@/types/auth'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as UsuarioSesion | null,
    sessionChecked: false,
  }),
  getters: {
    isAuthenticated: (s) => !!s.user,
    rol: (s) => s.user?.rol ?? null,
  },
  actions: {
    async fetchSession() {
      try {
        const { data } = await api.get<{ user: UsuarioSesion }>('/auth/me')
        this.user = data.user
      } catch {
        this.user = null
      } finally {
        this.sessionChecked = true
      }
    },
    async login(email: string, password: string) {
      const { data } = await api.post<{ user: UsuarioSesion }>('/auth/login', { email, password })
      this.user = data.user
      this.sessionChecked = true
    },
    async logout() {
      try {
        await api.post('/auth/logout')
      } finally {
        this.clear()
      }
    },
    clear() {
      this.user = null
      this.sessionChecked = true
    },
  },
})