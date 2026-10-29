import { PERMISSIONS, type Permission } from './permissions'

export interface MenuItem {
    id: string
    label: string
    // null indica que la ruta todavía no está implementada.
    routeName: string | null
    // null indica que la opción es pública y no requiere un permiso.
    permission: Permission | null
}

export const accountMenu: readonly MenuItem[] = [
    {
        id: 'account-orders',
        label: 'Historial de pedidos',
        routeName: 'cuenta-pedidos',
        permission: PERMISSIONS.VIEW_OWN_ORDERS,
    },
    {
        id: 'account-orders-without-receipt',
        label: 'Pedidos sin comprobante',
        // Pendiente de implementar el destino y el filtro correspondiente.
        routeName: null,
        permission: PERMISSIONS.VIEW_OWN_ORDERS,
    },
    {
        id: 'account-credit-orders',
        label: 'Pedidos con cuenta corriente',
        // Destino pendiente hasta disponer de pantalla y datos específicos.
        routeName: null,
        permission: PERMISSIONS.VIEW_OWN_CREDIT_ORDERS,
    },
    {
        id: 'account-credit',
        label: 'Cuenta corriente',
        // Pendiente de implementar la pantalla de cuenta corriente.
        routeName: null,
        permission: PERMISSIONS.VIEW_OWN_CREDIT_ACCOUNT,
    },
    {
        id: 'account-details',
        label: 'Mis datos',
        routeName: 'cuenta-datos',
        permission: PERMISSIONS.VIEW_OWN_ACCOUNT,
    },
]

export const adminMenu: readonly MenuItem[] = [
    {
        id: 'admin-dashboard',
        label: 'Dashboard',
        routeName: 'admin-dashboard',
        permission: PERMISSIONS.VIEW_ADMIN_PANEL,
    },
    {
        id: 'admin-orders',
        label: 'Pedidos',
        routeName: 'admin-orders',
        permission: PERMISSIONS.VIEW_ALL_ORDERS,
    },
    {
        id: 'admin-products',
        label: 'Productos',
        routeName: 'admin-products',
        permission: PERMISSIONS.MANAGE_PRODUCTS,
    },
    {
        id: 'admin-categories',
        label: 'Categorías',
        routeName: 'admin-categories',
        permission: PERMISSIONS.MANAGE_CATEGORIES,
    },
    {
        id: 'admin-clients',
        // La matriz incluye particulares y empresas en el listado administrativo.
        label: 'Clientes',
        routeName: 'admin-clients',
        permission: PERMISSIONS.VIEW_CLIENTS,
    },
]

export const publicMenu: readonly MenuItem[] = [
    {
        id: 'public-admin-panel',
        label: 'Panel de administración',
        routeName: 'admin-dashboard',
        permission: PERMISSIONS.VIEW_ADMIN_PANEL,
    },
    {
        id: 'public-catalog',
        label: 'Catálogo',
        routeName: 'catalogo',
        permission: null,
    },
    {
        id: 'public-categories',
        label: 'Categorías',
        routeName: null,
        permission: null,
    },
    {
        id: 'public-about',
        label: 'Quiénes somos',
        routeName: null,
        permission: null,
    },
    {
        id: 'public-faq',
        label: 'Preguntas frecuentes',
        routeName: null,
        permission: null,
    },
]

export function filterMenuByPermissions(
    items: readonly MenuItem[],
    permissions: ReadonlySet<Permission>,
): MenuItem[] {
    return items.filter(
        item =>
        item.permission === null ||
        permissions.has(item.permission),
    )
}

export type NavigableMenuItem = MenuItem & {
    routeName: string
}

export function getNavigableMenu(
    items: readonly MenuItem[],
    permissions: ReadonlySet<Permission>,
): NavigableMenuItem[] {
    return filterMenuByPermissions(items, permissions).filter(
        (item): item is NavigableMenuItem => item.routeName !== null,
    )
}
