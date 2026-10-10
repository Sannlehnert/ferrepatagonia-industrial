# Configuración del menú por permisos

Esta configuración controla la visibilidad de la navegación.
La autorización de cada operación corresponde al backend.

## Archivos

- `permissions.ts`: define permisos, asignaciones por rol y condiciones
  comerciales necesarias para resolver los permisos del usuario.
- `menu.ts`: define las opciones públicas, de cuenta y de administración.

## Uso

1. Obtener los permisos con `getPermissionsForUser(user)`.
2. Seleccionar `publicMenu`, `accountMenu` o `adminMenu`, según el área.
3. Usar `getNavigableMenu(menu, permissions)` para obtener las opciones
   permitidas que tienen un destino configurado.

`filterMenuByPermissions` filtra únicamente por permisos. Su resultado
puede incluir opciones con rutas pendientes.

## Convenciones

- `permission: null` identifica una opción pública.
- `routeName: null` identifica un destino pendiente y evita generar
  un enlace mediante `getNavigableMenu`.
- Un nombre de ruta debe coincidir con el registrado en Vue Router.
  La configuración no comprueba automáticamente esa coincidencia.
- Los permisos administrativos no incluyen las opciones de cuenta propia.
- Particular y Empresa comparten el rol técnico `CLIENTE`.

## Cuenta corriente

El permiso de consulta propia requiere:

- Rol `CLIENTE`.
- Tipo de cliente `EMPRESA`.
- Estado de aprobación `APROBADA`.
- Cuenta corriente habilitada.

Estos datos deben provenir del backend. Si las condiciones comerciales
todavía no están disponibles, no se concede ese permiso.

Consultar cuenta corriente es distinto de consultar pedidos realizados
con esa modalidad de pago.

## Estado actual

El único destino disponible desde el menú de cuenta es:

- Configuración de datos: `cuenta-datos`.

La ruta `cuenta-pedidos` está registrada en el router, pero
`HistorialPedidos.vue` está vacío. La opción del menú mantiene
`routeName: null` hasta integrar la pantalla de #169.

Los demás destinos permanecen pendientes.

`AccountMenu.vue` renderiza las opciones mediante la configuración.
El layout utiliza temporalmente un usuario simulado para verificar
la interfaz. Falta conectarlo con el store de sesión para completar #142.

## Agregar o modificar opciones

- Para cambiar texto u orden, modificar la lista correspondiente.
- Para habilitar un destino pendiente, asignar el nombre real de su ruta.
- Para incorporar una acción nueva, definir su permiso y su asignación.
- No agregar permisos ni condiciones comerciales sin contrastarlos
  con la matriz acordada por el equipo.