import { defineStore } from 'pinia'
import axios from 'axios'
import api from '@/services/api'
import type { UsuarioSesion } from '@/types/auth'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as UsuarioSesion | null,
    sessionChecked: false,
    sessionError: '',
    loggingOut: false,
    loggingIn: false,
    sessionVersion: 0,
  }),
  getters: {
    isAuthenticated: (s) => !!s.user,
    rol: (s) => s.user?.rol ?? null,
  },
  actions: {
    async fetchSession() {
      const version = this.sessionVersion
      try {
        const { data } = await api.get<{ user: UsuarioSesion }>('/auth/me')
        if (version !== this.sessionVersion) return
        this.user = data.user
        this.sessionError = ''
        this.sessionChecked = true
      } catch (error) {
        if (version !== this.sessionVersion) return
        if (axios.isAxiosError(error) && error.response?.status === 401) this.clear()
        else {
          this.sessionError = 'No se pudo verificar la sesión. Reintentá antes de continuar.'
          throw error
        }
      }
    },
    async login(email: string, password: string) {
      if (this.loggingOut || this.loggingIn) throw new Error('Esperá a que termine la operación de sesión.')
      this.loggingIn = true
      this.sessionVersion++
      try {
        const { data } = await api.post<{ user: UsuarioSesion }>('/auth/login', { email, password })
        this.user = data.user
        this.sessionChecked = true
      } finally {
        this.loggingIn = false
      }
    },
    async logout() {
      if (this.loggingIn) throw new Error('Esperá a que termine el inicio de sesión.')
      if (this.loggingOut) return false
      this.loggingOut = true
      this.sessionVersion++ // Ignore session reads started before this attempt.
      try {
        await api.post('/auth/logout')
        this.clear()
        return true
      } catch (error) {
        // A logout rejection alone never proves that the session has expired.
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          try {
            const { data } = await api.get<{ user: UsuarioSesion }>('/auth/me')
            this.user = data.user
          } catch (verification) {
            if (axios.isAxiosError(verification) && verification.response?.status === 401) {
              this.clear()
              return true
            }
          }
        }
        throw error
      } finally {
        this.loggingOut = false
      }
    },
    clear() {
      this.sessionVersion++
      this.user = null
      this.sessionError = ''
      this.sessionChecked = true
    },
  },
})
