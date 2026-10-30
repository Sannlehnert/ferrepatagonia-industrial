# Stack tecnológico del MVP

> **Estado:** propuesta preliminar pendiente de validación del equipo y de los requerimientos de la materia de Backend.

## 1. Objetivo

Este documento presenta la propuesta inicial de tecnologías para desarrollar el MVP de Ferrepatagonia Industrial.

La selección busca cubrir las necesidades actuales del sistema utilizando herramientas conocidas por el equipo, manteniendo una arquitectura simple, comprensible y extensible.

El backend del proyecto será utilizado también como trabajo final de la materia de Backend. Por este motivo, determinadas decisiones técnicas podrán modificarse si la cátedra establece tecnologías, librerías o criterios obligatorios para la evaluación.

El stack presentado debe entenderse como una propuesta de trabajo y no como una definición completamente cerrada.

---

## 2. Estado de las decisiones

Se utilizan las siguientes categorías:

- **Definido:** tecnología ya adoptada por el proyecto.
- **Propuesto:** tecnología considerada adecuada y pendiente de validación final.
- **Pendiente:** decisión todavía no cerrada.
- **Opcional:** tecnología que podrá incorporarse dependiendo del alcance y tiempo disponible.

---

## 3. Resumen del stack

| Área | Tecnología | Estado |
|---|---|---|
| Frontend | Vue 3 | Propuesto |
| Lenguaje frontend | TypeScript | Propuesto |
| Build tool | Vite | Propuesto |
| Estado global | Pinia | Propuesto |
| Routing | Vue Router | Propuesto |
| Estilos | Tailwind CSS | Propuesto |
| Backend | Node.js | Propuesto |
| Framework backend | Express | Pendiente de confirmación |
| Lenguaje backend | TypeScript | Propuesto |
| API principal | REST | Propuesto |
| Tiempo real | Socket.IO | Propuesto |
| Base de datos | MariaDB | Pendiente de confirmación |
| Acceso a datos | Por definir | Pendiente |
| Validación | Zod | Propuesto |
| Autenticación | JWT | Propuesto |
| Hash de contraseñas | bcrypt | Propuesto |
| Archivos | Multer | Propuesto |
| Correo electrónico | Nodemailer | Opcional |
| Documentación API | Swagger / OpenAPI | Propuesto |
| Control de versiones | Git + GitHub | Definido |

---

## 4. Frontend

### 4.1 Vue 3

Se propone utilizar Vue 3 como framework principal del frontend.

Permitirá construir la aplicación mediante componentes reutilizables y separar de forma clara las diferentes áreas del sistema:

- sitio público;
- catálogo;
- carrito;
- área de cliente;
- área de cliente empresa;
- panel administrativo.

También es una tecnología conocida por integrantes del equipo.

---

### 4.2 TypeScript

Se propone utilizar TypeScript tanto en frontend como en backend.

Permitirá definir estructuras claras para:

- productos;
- clientes;
- pedidos;
- pagos;
- usuarios;
- respuestas de la API;
- eventos Socket.IO.

El tipado busca reducir errores durante el desarrollo y facilitar la coordinación entre frontend y backend.

---

### 4.3 Vite

Se propone Vite como herramienta de desarrollo y compilación del frontend.

Permite mantener una configuración sencilla y tiempos rápidos de desarrollo.

---

### 4.4 Pinia

Se propone utilizar Pinia únicamente para los estados que realmente necesiten compartirse entre distintas vistas o componentes.

Ejemplos:

- usuario autenticado;
- estado de sesión;
- carrito;
- información global que deba reaccionar ante determinados eventos.

Pinia y Socket.IO cumplen responsabilidades diferentes.

Socket.IO permite recibir eventos desde el backend, mientras que Pinia permite mantener y distribuir dentro del frontend el estado derivado de esos eventos.

Ejemplo:

```text
Backend
   ↓
Socket.IO
   ↓
Frontend recibe evento
   ↓
Pinia actualiza estado compartido
   ↓
Las vistas reaccionan al cambio
```

No se propone utilizar Pinia como copia completa del estado del backend.

---

### 4.5 Vue Router

Vue Router administrará la navegación de la SPA.

Permitirá diferenciar posteriormente:

- rutas públicas;
- rutas autenticadas;
- rutas administrativas.

Las reglas definitivas serán establecidas durante la historia de roles y autenticación.

---

### 4.6 Tailwind CSS

Se propone Tailwind CSS para implementar el sistema visual definido durante UX/UI.

Permitirá mantener consistencia en:

- colores;
- tipografía;
- espaciados;
- breakpoints;
- componentes;
- estados visuales.

---

## 5. Backend

### 5.1 Node.js

Se propone Node.js como entorno de ejecución del backend.

Permite utilizar TypeScript y desarrollar una API adecuada para los requerimientos de Ferrepatagonia Industrial.

---

### 5.2 Framework backend

Se propone inicialmente Express debido a su simplicidad y flexibilidad.

Las principales áreas previstas del backend son:

- autenticación;
- usuarios;
- clientes;
- productos;
- categorías;
- pedidos;
- cuentas corrientes;
- pagos;
- archivos.

Sin embargo, esta decisión queda pendiente de validación con la materia de Backend.

Si la cátedra establece el uso obligatorio de otro framework o tecnología, la arquitectura deberá adaptarse a ese requerimiento.

---

## 6. API REST

Se propone REST como mecanismo principal de comunicación entre frontend y backend.

REST se utilizaría para operaciones como:

- iniciar sesión;
- consultar productos;
- crear pedidos;
- modificar productos;
- administrar clientes;
- registrar pagos;
- consultar cuenta corriente.

Ejemplo:

```text
Frontend
   ↓
HTTP / JSON
   ↓
API REST
   ↓
Backend
```

La incorporación de Socket.IO no reemplaza esta comunicación.

---

## 7. Tiempo real con Socket.IO

Se propone utilizar Socket.IO para eventos donde una actualización en tiempo real aporte valor.

Casos posibles:

- nuevo pedido recibido por administración;
- cambio de estado de pedido;
- actualización relevante de stock;
- pago aprobado o rechazado;
- actualizaciones relevantes del panel administrativo.

Ejemplo:

```text
Cliente crea pedido
        ↓
REST: POST /pedidos
        ↓
Backend registra pedido
        ↓
Socket.IO emite evento
        ↓
Panel administrador recibe actualización
```

REST continuará ejecutando las operaciones principales.

Socket.IO será utilizado principalmente para comunicar cambios producidos después de dichas operaciones.

---

### 7.1 Seguridad de Socket.IO

Las conexiones deberán autenticarse.

Si se utiliza JWT, el token podrá enviarse durante el proceso de conexión y ser validado por el backend antes de aceptar el socket.

Un JWT convencional se encuentra firmado y no necesariamente cifrado.

La confidencialidad del transporte deberá proporcionarse mediante HTTPS/WSS.

La implementación definitiva será validada junto con la materia de Backend.

---

## 8. Base de datos

### 8.1 MariaDB

Se propone inicialmente MariaDB debido a que el dominio del sistema es principalmente relacional.

El modelo contiene relaciones entre:

- Cliente;
- Pedido;
- DetallePedido;
- Producto;
- CuentaCorriente;
- Pago.

La elección definitiva de la base de datos queda sujeta a las decisiones o requerimientos de la materia de Backend.

---

## 9. Acceso a datos

La herramienta de acceso a datos todavía no se considera definida.

Se evaluarán distintas alternativas.

### 9.1 Knex

Knex es un query builder que permite construir consultas SQL y administrar migraciones manteniendo un control relativamente directo sobre las consultas.

Podría utilizarse si el equipo considera que aporta valor sin agregar complejidad innecesaria.

### 9.2 Driver SQL

También podría utilizarse un driver como `mysql2` y trabajar con consultas SQL de forma directa.

Esta alternativa permitiría trabajar más cerca de SQL y evitar incorporar una capa adicional.

### 9.3 ORM u otra herramienta

Si la materia de Backend solicita un ORM o una herramienta específica, se utilizará la alternativa correspondiente.

La decisión buscará evitar incorporar una tecnología innecesaria o incompatible con los criterios de evaluación.

---

## 10. Validación

### 10.1 Zod

Se propone Zod para validar los datos recibidos por la API.

Podrá utilizarse para validar:

- body de solicitudes;
- parámetros;
- filtros;
- autenticación;
- formularios;
- operaciones administrativas.

La validación del backend será independiente de las validaciones realizadas en frontend.

---

## 11. Autenticación

### 11.1 JWT

Se propone inicialmente JWT como mecanismo de autenticación.

Flujo conceptual:

```text
Usuario envía credenciales
        ↓
Backend valida
        ↓
Backend genera token
        ↓
Cliente utiliza token
        ↓
Backend identifica usuario
```

La forma definitiva de almacenamiento, renovación y expiración será definida durante la historia de autenticación.

JWT también podrá utilizarse para autenticar conexiones Socket.IO si esta alternativa es finalmente adoptada.

---

### 11.2 bcrypt

Se propone bcrypt para generar hashes seguros de las contraseñas.

Las contraseñas no deberán almacenarse en texto plano.

---

## 12. Manejo de archivos

### 12.1 Multer

Se propone utilizar Multer para recibir archivos enviados al backend.

Casos previstos:

- imágenes de productos;
- comprobantes de pago.

Multer resuelve la recepción de archivos, pero no define su almacenamiento definitivo.

La ubicación final de los archivos será definida posteriormente.

---

## 13. Correo electrónico

### 13.1 Nodemailer

Se propone considerar Nodemailer como funcionalidad opcional.

Podría utilizarse para correos transaccionales relacionados con:

- confirmación de registro;
- recuperación de contraseña;
- confirmación de pedido;
- cambios de estado;
- aprobación o rechazo de pagos;
- avisos relacionados con cuenta corriente.

Su incorporación dependerá del alcance y del tiempo disponible.

No se considera una dependencia obligatoria para cerrar el MVP si las funcionalidades principales pueden operar sin correo automático.

---

## 14. Documentación de API

### 14.1 Swagger / OpenAPI

Se propone utilizar Swagger/OpenAPI para documentar la API.

Permitirá:

- visualizar endpoints;
- conocer parámetros;
- documentar respuestas;
- realizar pruebas;
- facilitar la coordinación entre frontend y backend.

Su utilización también deberá validarse con la materia de Backend.

---

## 15. Control de versiones

El proyecto utiliza Git y GitHub.

Las ramas principales son:

```text
main
develop
```

Las tareas se desarrollan mediante ramas específicas creadas desde `develop` y se integran mediante Pull Request.

La convención general utilizada es:

```text
feature/...   nuevas funcionalidades
fix/...       correcciones
docs/...      documentación
refactor/...  refactorizaciones
```

---

## 16. Arquitectura preliminar

La estructura general propuesta es:

```text
Usuario
   ↓
Frontend
Vue 3 + TypeScript
   ↓
REST / HTTP
   ↓
Backend
Node.js + framework a confirmar
   ↓
Acceso a datos por definir
   ↓
Base de datos relacional
```

Adicionalmente, para los casos que requieran tiempo real:

```text
Backend
   ↓↑
Socket.IO
   ↓↑
Clientes conectados
```

Socket.IO se utilizará únicamente donde exista una necesidad real de comunicación en tiempo real.

---

## 17. Responsabilidad de REST y Socket.IO

La incorporación de Socket.IO no implica reemplazar la API REST.

La propuesta divide las responsabilidades de la siguiente manera.

### REST

Se utilizará principalmente para:

- crear recursos;
- consultar información;
- modificar información;
- eliminar o desactivar recursos;
- ejecutar operaciones del sistema.

Ejemplos:

```text
POST /pedidos
GET /productos
PATCH /productos/:id
POST /pagos
```

### Socket.IO

Se utilizará para informar eventos relevantes después de que una operación produzca un cambio.

Ejemplos:

```text
pedido_creado
pedido_actualizado
stock_actualizado
pago_validado
pago_rechazado
```

De esta manera REST mantiene el control de las operaciones y Socket.IO aporta actualización en tiempo real.

---

## 18. Decisiones sujetas a la materia de Backend

Antes de cerrar definitivamente el stack deberá confirmarse con la materia de Backend:

- framework obligatorio o recomendado;
- base de datos requerida;
- herramienta de acceso a datos;
- mecanismo esperado de autenticación;
- utilización de sockets;
- librerías obligatorias;
- documentación de API;
- requisitos específicos del trabajo final.

Si alguno de estos puntos es obligatorio para la evaluación, tendrá prioridad sobre las decisiones preliminares presentes en este documento.

---

## 19. Criterios de selección

La propuesta prioriza:

- tecnologías conocidas por el equipo;
- simplicidad;
- mantenibilidad;
- facilidad de desarrollo;
- separación clara entre frontend y backend;
- compatibilidad con el modelo de datos;
- posibilidad de incorporar tiempo real;
- posibilidad de ampliar el sistema posteriormente;
- evitar infraestructura innecesaria.

---

## 20. Puntos pendientes de validación

Antes de considerar definitivo el stack deberán resolverse los siguientes puntos:

- confirmar framework backend;
- confirmar base de datos;
- elegir herramienta de acceso a datos;
- confirmar el uso de Socket.IO;
- definir los eventos que realmente necesitan tiempo real;
- confirmar estrategia de autenticación;
- definir almacenamiento definitivo de archivos;
- confirmar si se utilizará Nodemailer;
- confirmar si Swagger/OpenAPI será obligatorio;
- validar requisitos adicionales de la materia de Backend.

---

## 21. Estado actual

La propuesta queda pendiente de:

1. revisión del equipo WebFaster;
2. confirmación de los requerimientos de la materia de Backend.

Una vez resueltos ambos puntos, el stack podrá considerarse definitivo y esta documentación deberá actualizarse con las decisiones tomadas.