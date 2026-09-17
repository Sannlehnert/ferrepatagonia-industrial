# Ferrepatagonia Industrial

Plataforma web de ventas y gestión comercial desarrollada para **Ferrepatagonia Industrial** por el equipo **WebFaster**.

El proyecto busca centralizar parte de la operación comercial de la empresa y habilitar la venta online tanto para clientes convencionales como para clientes empresariales que trabajan con cuenta corriente.

- --

## Equipo

- *WebFaster**

- **Santiago Agustín Lehnert** — Backend
- **Lucciano Perticarini** — Frontend
- **Zahir Timm** — UX/UI
- **Bruno Vagnola** — UX/UI

- --

## Objetivo del proyecto

Ferrepatagonia Industrial necesita una plataforma que permita administrar su catálogo de productos y ofrecer un canal de venta online adaptado a su operatoria comercial.

Una de las particularidades principales del negocio es que conviven distintos tipos de clientes:

- clientes convencionales;
- clientes empresariales;
- clientes autorizados para operar mediante cuenta corriente.

La solución busca contemplar estas diferencias sin perder simplicidad en el MVP.

- --

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

- --

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
- preparación de las siguientes definiciones de arquitectura y autenticación.

- --

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

### Para mantener el MVP simple

- el stock se representa como información asociada al producto;
- la condición de cliente fiel se representa dentro de Cliente;
- el comprobante se mantiene asociado al pago;
- la cotización del dólar se considera una configuración del sistema;
- cada producto pertenece inicialmente a una categoría;
- los pagos se registran inicialmente dentro de la operatoria de cuenta corriente;
- `DetallePedido` conserva los valores utilizados al momento de cada operación.

La relación definitiva de `Usuario` con Cliente, administración y roles será completada durante la historia correspondiente a autenticación y autorización.

- --

## UX/UI

El diseño visual del MVP se encuentra actualmente en desarrollo.

### Las principales vistas contempladas son

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

- --

## Estrategia de ramas

### El repositorio utiliza las siguientes ramas principales

- `main` — versiones estables del proyecto.
- `develop` — rama principal de integración.

Las tareas se desarrollan en ramas específicas creadas desde `develop`.

### Convención utilizada

```text
feature/...   nuevas funcionalidades
fix/...       correcciones
docs/...      documentación
refactor/...  refactorizaciones
Los cambios se integran mediante Pull Request.
- Ejemplo:
- develop
- ↓
- docs/modelo-datos-mermaid
- ↓
- Pull Request
- ↓
- develop
Documentación técnica
La documentación técnica versionada dentro del repositorio se encuentra dentro de:
- docs/
- └── modelo-datos/
└── mer-ferrepatagonia.md
El legajo completo del proyecto se mantiene adicionalmente en el espacio compartido del equipo e incluye:
- relevamiento;
- análisis del problema;
- requerimientos;
- propuesta de solución;
- presupuesto;
- documentación de diseño y desarrollo.
- Arquitectura
La arquitectura técnica definitiva del MVP todavía se encuentra en proceso de definición.
Durante las siguientes tareas se documentarán:
- stack tecnológico;
- arquitectura frontend;
- arquitectura backend;
- base de datos;
- comunicación entre frontend y backend;
- autenticación;
- autorización;
- manejo de archivos;
- estructura general del sistema.
Esta sección se actualizará a medida que esas decisiones sean confirmadas.
Autenticación y roles
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
Estado del Sprint
Sprint 1 — En desarrollo
Objetivo actual:
- completar el diseño UX/UI;
- cerrar la documentación del modelo de datos;
- definir arquitectura técnica;
- definir roles y autenticación;
- dejar preparada la base para comenzar la implementación.
Proyecto académico
Proyecto desarrollado dentro del marco de la carrera de Desarrollo de Software Full Stack.