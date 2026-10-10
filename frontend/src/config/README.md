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

## Pendientes antes de cerrar FER-4

- Conectar el usuario y sus estados comerciales con la sesión real.
- Retirar el usuario simulado de MiCuentaLayout.vue.
- Integrar el historial de #169 y restablecer cuenta-pedidos.
- Acordar la visibilidad de Pedidos con cuenta corriente.
- Revisar el alcance final de las opciones y sus destinos pendientes.
- Verificar con sesión real Visitante, Particular, Empresa y ADMIN.
- Verificar actualización del menú al iniciar y cerrar sesión.
- Coordinar la protección de rutas con las tareas de autenticación.
- Revisar que los componentes no contengan reglas de roles duplicadas.
- Actualizar Taiga y obtener revisión y aprobación del PR.

## Revisión de reglas en componentes — #143

Las reglas de permisos del menú están centralizadas en permissions.ts.
AccountMenu.vue no compara roles ni condiciones comerciales:
recibe permisos y renderiza las opciones configuradas.

MiCuentaLayout.vue delega el cálculo a getPermissionsForUser.
Todavía contiene un usuario simulado, pendiente de reemplazo
por el estado de sesión en #142.

Repetir esta revisión al integrar la sesión real y otros menús.