# Ferrepatagonia Industrial

Plataforma web de ventas y gestión comercial desarrollada para **Ferrepatagonia Industrial** por el equipo **WebFaster**.

El proyecto busca centralizar parte de la operación comercial de la empresa y habilitar la venta online tanto para clientes convencionales como para clientes empresariales que trabajan con cuenta corriente.

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
- definición de la arquitectura general del MVP;
- análisis preliminar del stack tecnológico;
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

## Arquitectura

El MVP utiliza una arquitectura web cliente-servidor organizada principalmente en frontend, backend y base de datos.

```text
Frontend
   ↓
API REST
   ↓
Backend
   ↓
Base de datos
```

La lógica de negocio, validaciones, autenticación, autorización y acceso a datos se concentrarán en el backend.

REST será el mecanismo principal para ejecutar operaciones entre frontend y backend.

También se contempla utilizar Socket.IO como mecanismo complementario para eventos que necesiten actualización en tiempo real.

La arquitectura se mantiene independiente de algunas decisiones de implementación que todavía deberán confirmarse con la materia de Backend.

[Ver arquitectura general del MVP](docs/arquitectura/arquitectura-general.md)

---

## Stack tecnológico

El stack tecnológico definitivo se encuentra actualmente en análisis.

Existe una propuesta preliminar para frontend, backend, base de datos, autenticación, validación, manejo de archivos y comunicación en tiempo real.

Algunas decisiones permanecen pendientes de confirmación debido a que el backend del proyecto será utilizado también como trabajo final de la materia de Backend.

Una vez confirmados dichos requerimientos se actualizará esta sección con el stack definitivo.

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
docs/arquitectura-general-mvp
   ↓
Pull Request
   ↓
develop
```

---

## Documentación técnica

La documentación técnica versionada actualmente dentro del repositorio se organiza de la siguiente manera:

```text
docs/
├── modelo-datos/
│   └── mer-ferrepatagonia.md
└── arquitectura/
    └── arquitectura-general.md
```

La propuesta preliminar del stack tecnológico se encuentra en proceso de revisión y será incorporada a `develop` una vez confirmadas las decisiones pendientes.

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