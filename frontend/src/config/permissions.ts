export const PERMISSIONS = {
    VIEW_OWN_ACCOUNT: 'account:view-own',
    VIEW_OWN_ORDERS: 'orders:view-own',
    VIEW_ADMIN_PANEL: 'admin:view',
    VIEW_ALL_ORDERS: 'orders:view-all',
    MANAGE_PRODUCTS: 'products:manage',
    MANAGE_CATEGORIES: 'categories:manage',
    VIEW_CLIENTS: 'clients:view',
    VIEW_OWN_CREDIT_ACCOUNT: 'credit-account:view-own',
    VIEW_OWN_CREDIT_ORDERS: 'orders:view-own-credit',
} as const

export type Permission =
    (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export type Role = 'CLIENTE' | 'ADMIN'

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
    CLIENTE: [
        PERMISSIONS.VIEW_OWN_ACCOUNT,
        PERMISSIONS.VIEW_OWN_ORDERS,
    ],
    ADMIN: [
        PERMISSIONS.VIEW_ADMIN_PANEL,
        PERMISSIONS.VIEW_ALL_ORDERS,
        PERMISSIONS.MANAGE_PRODUCTS,
        PERMISSIONS.MANAGE_CATEGORIES,
        PERMISSIONS.VIEW_CLIENTS,
    ],
}

export function isRole(value: unknown): value is Role {
    return (
        typeof value === 'string' &&
        Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, value)
    )
}

export function getPermissionsForRole(
    role: Role | null,
): ReadonlySet<Permission> {
    if (role === null) {
        return new Set<Permission>()
    }

    return new Set<Permission>(ROLE_PERMISSIONS[role])
}

export interface MenuUser {
    rol: Role
    tipoCliente: 'PARTICULAR' | 'EMPRESA' | null
    estadoAprobacionEmpresa?: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'
    cuentaCorrienteHabilitada?: boolean
}

export function getPermissionsForUser(
    user: MenuUser | null,
): ReadonlySet<Permission> {
    const permissions = new Set(
        getPermissionsForRole(user?.rol ?? null),
    )

    // La empresa conserva el historial aunque pierda la habilitación.
    if (
        user?.rol === 'CLIENTE' &&
        user.tipoCliente === 'EMPRESA'
    ) {
        permissions.add(PERMISSIONS.VIEW_OWN_CREDIT_ORDERS)
    }

    // La habilitación comercial debe provenir del backend.
    // Si todavía no se recibió, no se concede este permiso.
    if (
        user?.rol === 'CLIENTE' &&
        user.tipoCliente === 'EMPRESA' &&
        user.estadoAprobacionEmpresa === 'APROBADA' &&
        user.cuentaCorrienteHabilitada === true
    ) {
        permissions.add(PERMISSIONS.VIEW_OWN_CREDIT_ACCOUNT)
    }

    return permissions
}