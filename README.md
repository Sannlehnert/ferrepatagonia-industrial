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

El sistema contempla clientes particulares y empresariales. Las empresas podrán operar mediante las modalidades de pago que tengan habilitadas; registrarse como empresa no otorgará automáticamente cuenta corriente, crédito ni beneficios comerciales.

La solución se plantea como un MVP mantenible y extensible, con una separación clara entre identidad de acceso, información comercial y permisos.

---

## Alcance inicial del MVP

El alcance funcional contempla:

- catálogo, búsqueda, categorías y detalle de productos;
- carrito de compra y generación de pedidos;
- registro y gestión de clientes particulares y empresariales;
- área de cliente para consultar datos y pedidos propios;
- condiciones comerciales y cuenta corriente para empresas habilitadas;
- registro de pagos y carga de comprobantes cuando la modalidad de pago lo requiera;
- administración de productos, categorías, precios y stock;
- gestión administrativa de clientes, pedidos, pagos y cuentas corrientes;
- autenticación de usuarios y control de acceso;
- panel de administración;
- información institucional, contacto, ayuda y preguntas frecuentes.

Las reglas específicas de descuentos, crédito, vencimientos y otras condiciones comerciales continúan sujetas a validación funcional.

---

## Estado del proyecto

El proyecto se encuentra en etapa de **diseño, documentación y definición técnica del MVP**.

Durante el Sprint 1 se trabajó en:

- relevamiento del negocio y definición del alcance inicial;
- identificación de entidades, atributos, relaciones y restricciones;
- construcción y actualización del modelo entidad-relación;
- diseño UX/UI de las principales áreas de la plataforma;
- definición de la arquitectura general;
- propuesta de stack tecnológico;
- identificación de perfiles de usuario, roles técnicos y permisos;
- definición conceptual de autenticación, autorización y protección de rutas.

La documentación describe las decisiones y propuestas de diseño. No implica que las funcionalidades del sistema ya se encuentren implementadas.

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
- La cuenta corriente es una condición comercial asociada al cliente y no constituye un rol de acceso.
- Los pagos convencionales deben poder registrarse sin exigir una cuenta corriente; el modelo contempla la vinculación del pago con el pedido y, cuando corresponda, con la cuenta corriente.
- `DETALLE_PEDIDO` conserva los valores utilizados al momento de cada operación.
- El stock se representa como información asociada al producto.
- La condición de cliente fiel se mantiene como información comercial del cliente.
- La cotización del dólar se considera una configuración administrada por el sistema.

Las reglas de imputación de pagos, crédito y otras condiciones comerciales se precisarán durante el desarrollo de las funcionalidades correspondientes.

---

## Autenticación y control de acceso

Se identifican cuatro perfiles funcionales de uso:

| Perfil | Acceso |
|---|---|
| Visitante | Navegación pública sin iniciar sesión. |
| Cliente particular | Operaciones y datos propios de un cliente particular. |
| Cliente empresa | Operaciones y datos propios de una empresa, con acceso a las condiciones comerciales que tenga habilitadas. |
| Administrador | Funciones administrativas autorizadas. |

Estos cuatro perfiles no equivalen a cuatro roles almacenados en la base de datos. La implementación del MVP distingue los roles técnicos `CLIENTE` y `ADMIN`; el tipo de cliente se obtiene del registro comercial asociado.

Para el MVP académico se define autenticación mediante JWT. El frontend conservará el token de acceso en `localStorage` y utilizará Pinia para gestionar el estado de sesión de la interfaz. La estrategia de almacenamiento se revisará desde el punto de vista de la seguridad antes del despliegue real.

La autorización efectiva corresponde al backend. Cada operación protegida deberá comprobar la autenticación, los permisos, la pertenencia de los recursos y las condiciones comerciales aplicables.

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

Se propone una arquitectura web cliente-servidor organizada en frontend, backend y base de datos.

```text
Frontend
   |
   | API REST
   v
Backend
   |
   v
Base de datos
```

El backend concentrará la lógica de negocio, las validaciones, la autenticación, la autorización y el acceso a los datos.

REST será el mecanismo principal de comunicación. Se contempla Socket.IO como complemento para aquellos eventos que requieran actualizaciones en tiempo real.

[Consultar la arquitectura general del MVP](docs/arquitectura/arquitectura-general.md)

---

## Stack tecnológico

Existe una propuesta de stack para frontend, backend, base de datos, autenticación, validación, manejo de archivos y comunicación en tiempo real.

La definición tecnológica completa permanece sujeta a la confirmación de los requisitos obligatorios de la materia de Backend, ya que el backend de Ferrepatagonia Industrial también se utilizará como trabajo final de esa materia.

La documentación técnica se actualizará cuando dichas decisiones queden confirmadas.

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
    └── arquitectura-general.md
```

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
