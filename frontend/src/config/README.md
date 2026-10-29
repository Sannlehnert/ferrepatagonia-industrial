# Menús por permisos — FER-4

La configuración controla la visibilidad de los enlaces.
La autorización de rutas y operaciones corresponde al router y al backend.

## Organización

- permissions.ts: permisos y reglas por rol y condición comercial.
- menu.ts: opciones públicas, de cuenta y administrativas.
- NavigationMenu.vue: renderizador compartido.
- AccountMenu.vue, AdminMenu.vue y PublicMenu.vue: utilizan la configuración.
- MiCuentaLayout.vue y HomeView.vue: calculan permisos desde la sesión real.
- AdminLayout.vue: utiliza el rol del store para resolver permisos.

Los componentes de menú no duplican reglas de roles ni condiciones comerciales.
El visitante se representa mediante ausencia de usuario.

## Destinos

- permission: null identifica una opción pública.
- routeName: null identifica un destino pendiente.
- getNavigableMenu excluye las opciones sin destino o sin permiso.
- Si no hay enlaces disponibles, no se renderiza un nav vacío.

Mi Cuenta permite navegar a Configuración de datos e Historial de pedidos.
El panel dispone de Dashboard, Pedidos, Productos, Categorías y Clientes.
La Home temporal integra PublicMenu y muestra el acceso al panel solo a ADMIN.

Catálogo, Categorías públicas, Quiénes somos y Preguntas frecuentes
permanecen sin destino. La Home todavía no incluye un enlace al login.

## Pedidos con cuenta corriente

El permiso VIEW_OWN_CREDIT_ORDERS corresponde a CLIENTE de tipo EMPRESA.

No depende de la aprobación ni de la habilitación actual de cuenta corriente:
permite conservar la consulta histórica cuando se deshabilita esa modalidad.

Su destino permanece null por acuerdo con el equipo, hasta disponer de
la pantalla y los datos necesarios para distinguir esos pedidos.

## Cuenta corriente

El permiso VIEW_OWN_CREDIT_ACCOUNT requiere:

- Rol CLIENTE.
- Tipo EMPRESA.
- Estado de aprobación APROBADA.
- Cuenta corriente habilitada explícitamente.

Aprobación, usuario activo/inactivo y habilitación de cuenta corriente
son conceptos diferentes.

Actualmente /auth/me devuelve id, nombre, email, rol y tipo_cliente.
No devuelve aprobación ni habilitación comercial. Por eso, la integración
actual no concede este permiso ni inventa esos datos.

La pantalla y su destino también permanecen pendientes por acuerdo del equipo.

## Validación realizada

- Build y comprobación de tipos sin errores.
- git diff --check sin errores.
- Visitante: Home sin acceso administrativo.
- PARTICULAR: menú de cuenta correcto y sesión conservada con F5.
- EMPRESA: menú de cuenta correcto y sesión conservada con F5.
- ADMIN: acceso al panel desde Home, conservado después de F5.
- Logout de PARTICULAR y EMPRESA: regreso al login.
- Sin sesión: Mi Cuenta redirige al login conservando el destino solicitado.

Se probaron por separado ocho casos simulados de la función de permisos:
visitante, particular, empresa sin datos comerciales, empresa aprobada
habilitada, empresa aprobada deshabilitada, empresa pendiente,
empresa rechazada y administrador. Todos dieron el resultado esperado.

Estas simulaciones no modificaron la sesión ni se incorporaron como mocks
a la aplicación. No equivalen a probar operaciones comerciales del backend.

## Límites y pendientes

- Integrar los destinos públicos y comerciales cuando estén disponibles.
- Incorporar los datos comerciales reales cuando exista el contrato de API.
- Validar la navegación comercial al disponer de sus pantallas.
- Los errores de carga de datos personales o pedidos se revisan por separado;
  las pruebas del menú no validan esas funcionalidades.
- Esta rama no cambia el destino después del login ni la política del JWT.
  Esos ajustes se coordinan en #139/#153.
- Solicitar revisión del PR y de las tareas #141, #142 y #144.
  La tarea #143 ya fue validada y cerrada por Santi.