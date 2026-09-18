# Ferrepatagonia Industrial

Plataforma web de ventas y gestión comercial desarrollada para **Ferrepatagonia Industrial** por el equipo **WebFaster**.

El proyecto busca centralizar parte de la operación comercial de la empresa y habilitar la venta online tanto para clientes convencionales como para clientes empresariales que trabajan con cuenta corriente.

---

## Equipo

**WebFaster**

- **Santiago Agustín Lehnert** — Backend
- **Lucciano Perticarini** — Frontend
- **Zahir Timm** — UX/UI
- **Bruno Vagnola** — UX/UI

---

## Objetivo del proyecto

Ferrepatagonia Industrial necesita una plataforma que permita administrar su catálogo de productos y ofrecer un canal de venta online adaptado a su operatoria comercial.

Una de las particularidades principales del negocio es que conviven distintos tipos de clientes:

- clientes convencionales;
- clientes empresariales;
- clientes autorizados para operar mediante cuenta corriente.

La solución busca contemplar estas diferencias manteniendo un MVP simple, mantenible y extensible.

---

## Alcance inicial del MVP

El MVP contempla actualmente las siguientes funcionalidades principales:

- catálogo de productos;
- búsqueda de productos;
- navegación por categorías;
- visualización del detalle de producto;
- carrito de compra;
- generación de pedidos;
- gestión de clientes;
- clientes con cuenta corriente;
- registro de pagos;
- carga de comprobantes;
- administración de productos;
- administración de stock;
- administración de categorías;
- gestión de pedidos;
- gestión de cuentas corrientes;
- panel de administración;
- autenticación de usuarios;
- control de acceso según roles;
- área de cliente;
- área de cliente empresa;
- sección de ayuda y preguntas frecuentes;
- sección de contacto y quiénes somos.

Algunas reglas comerciales continúan sujetas a validación durante el desarrollo.

---

## Estado actual del proyecto

El proyecto se encuentra en etapa de **diseño y definición técnica**.

### Durante el Sprint 1 se trabajó en

- configuración inicial del repositorio;
- definición de la estrategia de ramas;
- relevamiento y análisis del negocio;
- definición de entidades principales;
- definición de atributos;
- definición de relaciones y cardinalidades;
- definición de restricciones del modelo;
- construcción del modelo entidad-relación;
- documentación del MER mediante Mermaid;
- avance del diseño UX/UI;
- inicio de la definición de arquitectura técnica;
- preparación de la definición de autenticación y roles.

---

## Modelo de datos

El modelo entidad-relación se encuentra documentado mediante **Mermaid** y versionado dentro del repositorio.

[Ver MER de Ferrepatagonia Industrial](docs/modelo-datos/mer-ferrepatagonia.md)

El modelo actual contempla las siguientes entidades principales:

- `Cliente`
- `Producto`
- `Categoria`
- `Pedido`
- `DetallePedido`
- `CuentaCorriente`
- `Pago`
- `Usuario`

### Decisiones actuales del modelo

Para mantener el MVP simple:

- el stock se representa como información asociada al producto;
- la condición de cliente fiel se representa dentro de `Cliente`;
- el comprobante se mantiene asociado a `Pago`;
- la cotización del dólar se considera una configuración del sistema;
- cada producto pertenece inicialmente a una categoría;
- los pagos se registran inicialmente dentro de la operatoria de cuenta corriente;
- `DetallePedido` conserva los valores utilizados al momento de cada operación.

La relación definitiva de `Usuario` con Cliente, administración y roles será completada durante la historia correspondiente a autenticación y autorización.

---

## UX/UI

El diseño visual del MVP se encuentra actualmente en desarrollo.

### Sitio público

- Inicio
- Catálogo
- Detalle de producto
- Carrito
- Login
- Registro de cliente
- Registro de empresa
- Ayuda
- Preguntas frecuentes
- Contacto
- Quiénes somos

### Cliente

- Resumen de cuenta
- Mis pedidos
- Mis datos

### Cliente empresa

- Resumen
- Pedidos
- Cuenta corriente
- Pagos y comprobantes
- Datos de empresa

### Administración

- Dashboard
- Productos
- Categorías
- Clientes
- Pedidos
- Pagos
- Cuentas corrientes
- Configuración

---

## Stack tecnológico

El stack tecnológico definitivo del MVP se encuentra actualmente en análisis.

La propuesta preliminar contempla:

- **Vue 3 + TypeScript** para frontend;
- **Vite** como herramienta de desarrollo y compilación;
- **Pinia** para estado global cuando sea necesario;
- **Vue Router** para navegación;
- **Tailwind CSS** para estilos;
- **Node.js** para backend;
- framework backend pendiente de confirmación;
- **API REST** como mecanismo principal de comunicación;
- **Socket.IO** para eventos seleccionados en tiempo real;
- base de datos relacional pendiente de confirmación;
- herramienta de acceso a datos pendiente de definición;
- **JWT** para autenticación;
- **bcrypt** para hash de contraseñas;
- **Zod** para validación;
- **Multer** para recepción de archivos;
- **Nodemailer** como funcionalidad opcional;
- **Swagger / OpenAPI** para documentación de la API;
- **Git + GitHub** para control de versiones.

La propuesta permanece sujeta a los requerimientos técnicos de la materia de Backend, ya que el backend del proyecto será utilizado también como trabajo final de dicha materia.

[Ver propuesta completa del stack tecnológico](docs/arquitectura/stack-tecnologico.md)

---

## Arquitectura

La arquitectura técnica definitiva del MVP todavía se encuentra en proceso de definición.

Actualmente se plantea una separación general entre:

```text
Frontend
   ↓
API REST
   ↓
Backend
   ↓
Base de datos
```

Además, se evalúa incorporar Socket.IO para eventos donde una actualización en tiempo real aporte valor.

Durante las siguientes tareas se documentarán:

- responsabilidades del frontend;
- responsabilidades del backend;
- comunicación entre capas;
- estructura de módulos;
- autenticación;
- autorización;
- manejo de archivos;
- eventos en tiempo real;
- despliegue general del sistema.

---

## Autenticación y roles

La definición completa de roles, permisos y autenticación todavía se encuentra pendiente.

Se deberá establecer:

- roles existentes;
- permisos por rol;
- relación entre Usuario y Cliente;
- representación de usuarios administrativos;
- flujo de inicio de sesión;
- manejo de sesión;
- protección de endpoints;
- protección de rutas del frontend.

Una vez completada esta etapa, también podrá actualizarse el MER si resulta necesario.

---

## Estrategia de ramas

El repositorio utiliza las siguientes ramas principales:

- `main` — versiones estables del proyecto.
- `develop` — rama principal de integración.

Las tareas se desarrollan en ramas específicas creadas desde `develop`.

### Convención utilizada

```text
feature/...   nuevas funcionalidades
fix/...       correcciones
docs/...      documentación
refactor/...  refactorizaciones
```

Los cambios se integran mediante Pull Request.

Ejemplo:

```text
develop
   ↓
docs/modelo-datos-mermaid
   ↓
Pull Request
   ↓
develop
```

---

## Documentación técnica

La documentación técnica versionada dentro del repositorio se organiza actualmente de la siguiente manera:

```text
docs/
├── modelo-datos/
│   └── mer-ferrepatagonia.md
└── arquitectura/
    └── stack-tecnologico.md
```

El legajo completo del proyecto se mantiene adicionalmente en el espacio compartido del equipo e incluye:

- relevamiento;
- análisis del problema;
- requerimientos;
- propuesta de solución;
- presupuesto;
- documentación de diseño y desarrollo.

---

## Estado del Sprint

**Sprint 1 — En desarrollo**

Objetivos actuales:

- completar el diseño UX/UI;
- cerrar la documentación del modelo de datos;
- definir arquitectura técnica;
- definir roles y autenticación;
- dejar preparada la base para comenzar la implementación.

---

## Proyecto académico

Proyecto desarrollado dentro del marco de la carrera de **Desarrollo de Software Full Stack**.