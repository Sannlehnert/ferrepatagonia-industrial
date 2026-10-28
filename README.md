# Ferrepatagonia Industrial

Plataforma web de ventas y gestión comercial desarrollada para **Ferrepatagonia Industrial** por el equipo **WebFaster**.

El proyecto busca centralizar la gestión comercial de la empresa y ofrecer un canal de venta online para clientes particulares y empresariales, contemplando las condiciones específicas de aquellos que estén habilitados para operar mediante cuenta corriente.

---

## Equipo

**WebFaster**

El proyecto se desarrolla de manera colaborativa. Las asignaciones de tareas representan responsables de trabajos específicos y no roles técnicos permanentes dentro del equipo.

- Santiago Agustín Lehnert
- Lucciano Perticarini
- Zahir Timm
- Bruno Vagnola

---

## Objetivo del proyecto

Ferrepatagonia Industrial necesita una plataforma que permita administrar su catálogo de productos, gestionar pedidos y ofrecer un canal de venta online adaptado a su operatoria comercial.

El sistema contempla clientes particulares y empresariales. Las empresas necesitarán aprobación administrativa antes de poder comprar y luego podrán operar mediante las modalidades de pago que tengan habilitadas. La aprobación empresarial, la cuenta corriente y la condición de cliente fiel son independientes: ni el registro ni la aprobación otorgan automáticamente crédito o beneficios comerciales.

La solución se plantea como un MVP mantenible y extensible, con una separación clara entre identidad de acceso, información comercial y permisos.

---

## Alcance inicial del MVP

El alcance funcional contempla:

- catálogo, búsqueda, categorías y detalle de productos;
- carrito de compra y generación de pedidos;
- registro y gestión de clientes particulares y empresariales, con aprobación administrativa de las cuentas empresa antes de comprar;
- área de cliente para consultar datos y pedidos propios;
- condiciones comerciales y cuenta corriente para empresas habilitadas;
- registro de pagos y carga de comprobantes cuando la modalidad de pago lo requiera;
- administración de productos, categorías, precios y stock;
- gestión administrativa de clientes, pedidos, pagos y cuentas corrientes;
- autenticación JWT mediante un único login, con llegada al Home para clientes y administradores;
- CAPTCHA y rate limiting, con autorización efectiva en backend;
- panel de administración;
- información institucional, contacto, ayuda y preguntas frecuentes.

Las reglas específicas de descuentos, crédito, vencimientos y otras condiciones comerciales continúan sujetas a validación funcional.

---

## Estado del proyecto

El repositorio contiene el backend Node.js/Express/TypeScript con MariaDB,
autenticación de clientes y administradores, catálogo y categorías públicas,
y operaciones administrativas de clientes y productos. El alcance completo
del MVP sigue en desarrollo; las funcionalidades descritas en este README no
deben interpretarse como todas implementadas.

Para instalar y ejecutar el backend, consultar la
[guía del backend](backend/README.md). El índice de documentación técnica,
runbooks y checklist de release está en [docs/README.md](docs/README.md).
La política pública de precios continúa pendiente de validación comercial;
el [contrato del catálogo](docs/api/catalogo.md) es la fuente canónica.

Durante el Sprint 1 se trabajó en:

- relevamiento del negocio y definición del alcance inicial;
- identificación de entidades, atributos, relaciones y restricciones;
- construcción y actualización del modelo entidad-relación;
- diseño UX/UI de las principales áreas de la plataforma;
- definición de la arquitectura general;
- propuesta de stack tecnológico;
- identificación de perfiles de usuario, roles técnicos y permisos;
- definición conceptual de autenticación, autorización y protección de rutas.

Los documentos de relevamiento y diseño del Sprint 1 registran decisiones y
propuestas; no implican que todas las funcionalidades previstas estén
implementadas.

---

## Modelo de datos

El modelo entidad-relación se documenta mediante **Mermaid** y se versiona en el repositorio.

[Consultar el MER de Ferrepatagonia Industrial](docs/modelo-datos/mer-ferrepatagonia.md)

### Entidades principales

- `CLIENTE`
- `USUARIO`
- `PRODUCTO`
- `CATEGORIA`
- `PEDIDO`
- `DETALLE_PEDIDO`
- `CUENTA_CORRIENTE`
- `PAGO`

### Decisiones del modelo

- `USUARIO` representa la identidad utilizada para acceder a la plataforma.
- Los usuarios autenticados tienen los roles técnicos `CLIENTE` o `ADMIN`.
- `CLIENTE.tipo_cliente` distingue entre clientes `PARTICULAR` y `EMPRESA`.
- Cada usuario con rol `CLIENTE` se vincula con un único cliente y cada cliente puede tener como máximo una cuenta de acceso en el MVP.
- Los administradores no necesitan un registro comercial de `CLIENTE` para acceder a las funciones administrativas.
- `CLIENTE.estado_aprobacion_empresa` registra `PENDIENTE`, `APROBADA` o `RECHAZADA` para empresas; en particulares es nulo. Solo administración resuelve las solicitudes y el backend exige `APROBADA` para confirmar compras empresariales.
- La cuenta corriente es una condición comercial asociada al cliente y no constituye un rol de acceso. Su habilitación es independiente de la aprobación empresarial.
- Los pagos convencionales deben poder registrarse sin exigir una cuenta corriente; el modelo contempla la vinculación del pago con el pedido y, cuando corresponda, con la cuenta corriente.
- `DETALLE_PEDIDO` conserva los valores utilizados al momento de cada operación.
- El stock se representa como información asociada al producto.
- La condición de cliente fiel (`es_fiel`) es información comercial independiente del tipo de cliente, de la aprobación empresarial y de la cuenta corriente.
- La cotización del dólar se considera una configuración administrada por el sistema.

Las reglas de imputación de pagos, crédito y otras condiciones comerciales se precisarán durante el desarrollo de las funcionalidades correspondientes.

---

## Autenticación y control de acceso

Se identifican cuatro perfiles funcionales de uso:

| Perfil | Acceso |
|---|---|
| Visitante | Navegación pública sin iniciar sesión. |
| Cliente particular | Operaciones y datos propios de un cliente particular. |
| Cliente empresa | Datos y operaciones propios; compras solo tras aprobación administrativa y cuenta corriente solo si está habilitada. |
| Administrador | Funciones administrativas autorizadas. |

Estos cuatro perfiles no equivalen a cuatro roles almacenados en la base de datos. La implementación del MVP distingue los roles técnicos `CLIENTE` y `ADMIN`; el tipo de cliente se obtiene del registro comercial asociado.

Se utilizará un único login (`/login`) con JWT para clientes y administradores. Todo inicio de sesión exitoso llevará al Home (`/`); solo `ADMIN` verá allí el botón de acceso al panel administrativo. Las opciones de cliente dependerán de sus condiciones comerciales vigentes.

Pinia gestionará el estado de sesión de la interfaz. El almacenamiento/transporte de JWT, su expiración y renovación permanecen pendientes: la propuesta previa de `localStorage` no se considera una decisión definitiva.

CAPTCHA se aplicará al login y ante actividad sospechosa, junto con rate limiting en backend. El proveedor y los umbrales se definirán durante la implementación.

Vue Router administrará navegación y guardas de UX. La autorización efectiva corresponde al backend: cada operación protegida deberá comprobar autenticación, permisos, pertenencia de los recursos y condiciones comerciales, incluida la aprobación empresarial para comprar. Sin autenticación válida responderá `401`; con autenticación pero sin permiso, `403`.

La experiencia de acceso de empresas pendientes o rechazadas sigue por definir. Si se permite iniciar sesión, llegarán al Home y no podrán comprar hasta ser aprobadas.

La documentación detallada de usuarios, permisos, autenticación y autorización se mantiene en el legajo compartido del proyecto.

---

## UX/UI

El diseño del MVP contempla cuatro áreas principales:

**Sitio público:** inicio, catálogo, detalle de producto, carrito, login, registro e información institucional.

**Área de cliente particular:** datos personales, pedidos e historial de compras.

**Área de cliente empresa:** datos empresariales, pedidos, condiciones comerciales y, cuando esté habilitada, cuenta corriente.

**Administración:** dashboard, productos, categorías, stock, clientes, pedidos, pagos, cuentas corrientes y configuración.

Los prototipos y componentes visuales se mantienen en Figma. Los estados de autenticación y acceso se documentan en el legajo del proyecto.

---

## Arquitectura

Se utilizará una arquitectura web cliente-servidor con backend propio. Medusa queda descartado.

```text
Vue 3 + TypeScript
   |
   | API REST / HTTP
   v
Backend propio: Node.js + Express + TypeScript
   |
   v
MariaDB
```

El backend concentrará la lógica de negocio, las validaciones, la autenticación, la autorización y el acceso a los datos.

REST será el mecanismo principal de comunicación. Nodemailer está propuesto para notificaciones, como solicitudes y resoluciones empresariales o revisión de comprobantes. Socket.IO es opcional para tiempo real; RabbitMQ es opcional para desacoplar tareas como el envío de correos. Estas integraciones complementan el sistema y no reemplazan REST ni las validaciones de negocio.

[Consultar la arquitectura general del MVP](docs/arquitectura/arquitectura-general.md)

---

## Stack tecnológico

| Área | Decisión vigente | Estado |
|---|---|---|
| Frontend | Vue 3 + TypeScript, Vite, Pinia, Vue Router y Tailwind CSS | Definido |
| Backend propio | Node.js + Express + TypeScript | Definido |
| Base de datos | MariaDB | Definido |
| Comunicación principal | REST | Definido |
| Autenticación | JWT y login único con llegada al Home | Definido |
| Protección de acceso | CAPTCHA + rate limiting en backend | Definido; proveedor y umbrales pendientes |
| Acceso a datos | Herramienta por elegir | Pendiente |
| Correo electrónico | Nodemailer | Propuesto |
| Tiempo real | Socket.IO | Opcional y complementario |
| Mensajería asíncrona | RabbitMQ | Opcional y complementario |

Medusa está descartado. También quedan por concretar la gestión del token y el almacenamiento de archivos. La [arquitectura vigente](docs/arquitectura/arquitectura-general.md) detalla las decisiones abiertas.

---

## Estrategia de ramas

El repositorio utiliza:

- `main`: versiones estables del proyecto.
- `develop`: rama principal de integración.

Las tareas se desarrollan en ramas específicas creadas desde `develop` y se integran mediante Pull Request.

Convenciones de nombres:

```text
feature/...   Nuevas funcionalidades
fix/...       Correcciones
docs/...      Documentación
refactor/...  Refactorizaciones
```

---

## Documentación del proyecto

La documentación técnica versionada en el repositorio se organiza de la siguiente manera:

```text
docs/
├── modelo-datos/
│   └── mer-ferrepatagonia.md
└── arquitectura/
    ├── arquitectura-general.md
    └── stack-tecnologico.md
```

El README, la arquitectura general y el MER son documentos vivos y reflejan las decisiones vigentes. Los entregables del Sprint 1 se conservan como evidencia histórica; no se reescriben retroactivamente. La [propuesta inicial de stack](docs/arquitectura/stack-tecnologico.md) permanece como referencia de esa etapa y puede contener decisiones superadas: ante diferencias, prevalecen el stack resumido aquí y la arquitectura vigente.

El legajo compartido del proyecto contiene, además:

- relevamiento y análisis del negocio;
- requerimientos y reglas funcionales;
- propuesta de solución y presupuesto;
- documentación UX/UI;
- definición de roles y matriz de permisos;
- documentación de autenticación y autorización;
- entregables de diseño y desarrollo.

Las tareas, responsables, avances y evidencias de trabajo se registran en Taiga.

---

## Proyecto académico

Proyecto desarrollado en el marco de la carrera de **Desarrollo de Software Full Stack**.
