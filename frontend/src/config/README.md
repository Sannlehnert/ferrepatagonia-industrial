# Configuración del menú por permisos

Esta configuración controla la visibilidad de la navegación.
La autorización de cada operación corresponde al backend.

## Archivos

- `permissions.ts`: define permisos, asignaciones por rol y condiciones
  comerciales necesarias para resolver los permisos del usuario.
- `menu.ts`: define las opciones públicas, de cuenta y de administración.
- `../components/AccountMenu.vue`: renderiza el menú de cuenta
  a partir de los permisos recibidos.

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

En la versión inspeccionada de esta rama, `HistorialPedidos.vue`
está vacío aunque `cuenta-pedidos` está registrada en el router.
La opción mantiene `routeName: null` hasta integrar la implementación
de #169. La tarea figura terminada en Taiga; falta localizar e incorporar
su código.

Los demás destinos permanecen pendientes.

`AccountMenu.vue` renderiza las opciones mediante la configuración.
El layout utiliza temporalmente un usuario simulado para verificar
la interfaz. El renderizado está verificado de forma aislada.
La integración de #142 con el usuario autenticado queda pendiente
hasta disponer del store de sesión.

Los menús de cuenta, público y administrativo utilizan el renderizador
compartido NavigationMenu.vue. Solo el menú de cuenta está integrado
en su layout; el montaje de los otros dos y sus destinos sigue pendiente.

El renderizador compartido se probó con datos temporales en orientación
horizontal y vertical, verificando permisos y exclusión de rutas pendientes.

## Agregar o modificar opciones

- Para cambiar texto u orden, modificar la lista correspondiente.
- Para habilitar un destino pendiente, asignar el nombre real de su ruta.
- Para incorporar una acción nueva, definir su permiso y su asignación.
- No agregar permisos ni condiciones comerciales sin contrastarlos
  con la matriz acordada por el equipo.

## Verificaciones realizadas durante el desarrollo

- Comprobación de tipos con `npm run type-check`: sin errores.
- Visitante: recibe las opciones públicas y no las de cuenta propia.
- CLIENTE: recibe las opciones de cuenta propia y no las administrativas.
- ADMIN: recibe las opciones administrativas y no las de cuenta propia.
- Un único permiso de pedidos selecciona solo las opciones asociadas.
- Cuenta corriente: requiere Empresa aprobada y habilitación explícita.
- Empresa pendiente, rechazada o sin datos comerciales:
  no recibe el permiso de cuenta corriente.
- Las opciones con `routeName: null` se excluyen del menú navegable.
- El componente actualiza los enlaces al cambiar el usuario simulado.
- Configuración de datos: navegación y marcado del enlace activo verificados.

Estas comprobaciones fueron manuales, con datos simulados.
No reemplazan las pruebas con una sesión real ni verifican
la autorización del backend.

## Pendientes propios de FER-4

- Acordar la visibilidad de Pedidos con cuenta corriente.
- Completar el renderizado de los menús público y administrativo.
  Su inclusión en FER-4 fue confirmada con el equipo.
  El visitante se representa mediante ausencia de usuario, sin agregar
  un rol técnico nuevo.
- Completar la evidencia de pruebas por perfil después de la integración.
- Repetir la revisión de reglas en componentes tras conectar la sesión.
- Actualizar Taiga y obtener revisión y aprobación del PR.

El filtrado y la reactividad del menú de cuenta ya se comprobaron
con datos simulados. La integración y las pruebas con sesión real
siguen pendientes antes del cierre.

## Integraciones pendientes con otras tareas

- Conectar el usuario y sus estados comerciales con el store de sesión
  cuando esté disponible, reemplazando el usuario simulado del layout.
- Verificar el menú durante login, recuperación de sesión y logout.
- Restablecer cuenta-pedidos cuando se integre la pantalla de #169.
- Asignar los demás destinos cuando sus rutas y pantallas estén disponibles.

FER-4 consume el estado de sesión y las rutas del proyecto.
No implementa el login, los guards, la autorización del backend
ni las pantallas de pedidos o administración.

Estos pendientes deben coordinarse con sus responsables.
La validación aislada del menú no equivale a una integración completa.

## Revisión de reglas en componentes — #143

Las reglas de permisos del menú están centralizadas en permissions.ts.
AccountMenu.vue no compara roles ni condiciones comerciales:
recibe permisos y renderiza las opciones configuradas.

MiCuentaLayout.vue delega el cálculo a getPermissionsForUser.
Todavía contiene un usuario simulado, pendiente de reemplazo
por el estado de sesión en #142.

Repetir esta revisión al integrar la sesión real y otros menús.