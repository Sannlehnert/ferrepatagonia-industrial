import api from '@/services/api'
import type { RegistroPayload } from '@/types/registro'

export async function registrar(payload: RegistroPayload) {
  await api.post('/auth/register', payload)
}