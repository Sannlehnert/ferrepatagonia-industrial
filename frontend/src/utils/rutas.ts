import type { Router, RouteLocationRaw } from 'vue-router'
import type { Rol } from '@/types/auth'

// Destino por defecto según el rol del usuario autenticado.
export function rutaPorRol(rol: Rol | null): RouteLocationRaw {
  switch (rol) {
    case 'ADMIN':
      return { name: 'admin-dashboard' }
    case 'CLIENTE':
      return { name: 'cuenta-datos' } // cambiar a la tienda si el equipo lo define
    default:
      return { name: 'login' }
  }
}

// Respeta ?redirect= solo si es interno y el rol puede entrar; si no, ruta del rol.
export function destinoTrasLogin(
  router: Router,
  redirect: unknown,
  rol: Rol,
): RouteLocationRaw {
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    const destino = router.resolve(redirect)
    const existe = destino.matched.length > 0
    const permitido = !destino.meta.roles || destino.meta.roles.includes(rol)
    const esAuth = destino.name === 'login' || destino.name === 'registro'
    if (existe && permitido && !esAuth) return destino.fullPath
  }
  return rutaPorRol(rol)
}