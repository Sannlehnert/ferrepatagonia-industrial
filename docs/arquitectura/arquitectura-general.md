# Arquitectura general del MVP

> **Estado:** arquitectura conceptual definida. Algunos detalles de implementación permanecen sujetos a validación con la materia de Backend.

## 1. Objetivo

El objetivo de este documento es definir la arquitectura general prevista para el MVP de Ferrepatagonia Industrial.

La arquitectura establece cómo se dividirán las principales responsabilidades del sistema y cómo se comunicarán sus componentes:

- frontend;
- backend;
- base de datos;
- autenticación y autorización;
- manejo de archivos;
- comunicación en tiempo real.

La definición se realiza principalmente a nivel conceptual, de manera que la estructura general del sistema no dependa de tecnologías específicas que todavía se encuentran pendientes de confirmación.

Algunas decisiones de implementación del backend también quedarán sujetas a los requerimientos que pueda establecer la materia de Backend, debido a que esta parte del proyecto será utilizada como trabajo final de dicha materia.

---

## 2. Organización del trabajo del equipo

El proyecto es desarrollado de manera colaborativa por el equipo WebFaster.

Aunque los integrantes puedan tener mayor participación o afinidad con determinadas áreas, no se establecen responsabilidades técnicas exclusivas para frontend, backend, UX/UI u otras partes del sistema.

Cualquier integrante podrá:

- desarrollar funcionalidades de frontend;
- desarrollar funcionalidades de backend;
- trabajar sobre la base de datos;
- revisar código;
- documentar decisiones técnicas;
- colaborar en UX/UI;
- participar de pruebas;
- revisar Pull Requests.

La asignación de tareas se realizará según las necesidades del proyecto, disponibilidad y conocimiento de cada integrante.

Esto permite evitar dependencias innecesarias entre miembros del equipo y facilita que las tareas puedan continuar aunque una persona determinada no se encuentre disponible.

---

## 3. Enfoque general de arquitectura

Se propone una arquitectura web cliente-servidor dividida principalmente en tres capas:

1. frontend;
2. backend;
3. base de datos.

La comunicación principal entre frontend y backend se realizará mediante una API REST.

Adicionalmente, se contempla utilizar Socket.IO para determinados eventos donde sea útil disponer de actualizaciones en tiempo real.

La estructura general puede representarse de la siguiente manera:

```text
Usuario
   ↓
Frontend
   ↓
API REST
   ↓
Backend
   ↓
Base de datos
```

Para determinados eventos en tiempo real:

```text
Backend
   ↓↑
Socket.IO
   ↓↑
Frontend
```

---

## 4. Principios de la arquitectura

La arquitectura busca respetar los siguientes principios:

- separación clara de responsabilidades;
- mantener la lógica de negocio principal en el backend;
- evitar acceso directo del frontend a la base de datos;
- utilizar una API como punto de comunicación;
- mantener módulos funcionales claros;
- reducir dependencias innecesarias entre componentes;
- facilitar el trabajo colaborativo;
- permitir que frontend y backend puedan evolucionar de manera independiente;
- evitar complejidad que no aporte valor al MVP;
- permitir ampliaciones futuras del sistema.

---

## 5. Frontend

El frontend será responsable de toda la interacción directa con el usuario.

Su función principal será mostrar información, recibir acciones del usuario y comunicarse con los servicios proporcionados por el backend.

### 5.1 Responsabilidades principales

El frontend será responsable de:

- representar la interfaz visual;
- administrar la navegación;
- mostrar productos;
- mostrar categorías;
- visualizar información de cada producto;
- administrar visualmente el carrito;
- mostrar formularios;
- permitir inicio de sesión;
- mostrar información del cliente;
- mostrar pedidos;
- mostrar información de cuenta corriente;
- mostrar pagos y comprobantes;
- mostrar el panel administrativo;
- mantener determinados estados compartidos;
- consumir la API del backend;
- recibir eventos en tiempo real;
- mostrar errores;
- mostrar confirmaciones;
- responder visualmente a cambios producidos en el sistema.

### 5.2 Áreas principales del frontend

#### Sitio público

Incluye:

- inicio;
- catálogo;
- detalle de producto;
- carrito;
- login;
- registro;
- ayuda;
- preguntas frecuentes;
- contacto;
- información institucional.

#### Área de cliente

Incluye funcionalidades relacionadas con:

- información personal;
- pedidos;
- historial de compras;
- estado de operaciones;
- datos de cuenta.

#### Área de cliente empresa

Podrá incluir:

- pedidos;
- cuenta corriente;
- pagos;
- comprobantes;
- datos de la empresa.

#### Área administrativa

Permitirá administrar:

- productos;
- categorías;
- precios;
- stock;
- clientes;
- pedidos;
- pagos;
- cuentas corrientes;
- configuraciones generales.

---

## 6. Estado del frontend

No toda la información obtenida desde el backend deberá almacenarse globalmente.

Se utilizará estado global solamente para información que realmente necesite ser compartida entre distintas vistas o componentes.

Ejemplos:

- usuario autenticado;
- estado de sesión;
- carrito;
- información general necesaria en múltiples vistas.

El resto de los datos podrá mantenerse localmente dentro de cada vista o componente.

En caso de utilizar Pinia, su objetivo será administrar este tipo de estados compartidos.

Pinia no reemplazará la comunicación con el backend ni a Socket.IO.

---

## 7. Backend

El backend concentrará la lógica principal del sistema.

Será responsable de recibir las solicitudes realizadas por el frontend, validar la información, aplicar las reglas del negocio y acceder a la base de datos.

El backend será el único componente de la aplicación autorizado para acceder directamente a los datos persistentes.

### 7.1 Responsabilidades principales

El backend deberá:

- recibir solicitudes HTTP;
- validar información recibida;
- autenticar usuarios;
- controlar autorizaciones;
- aplicar reglas de negocio;
- consultar la base de datos;
- modificar información;
- gestionar productos;
- gestionar categorías;
- gestionar clientes;
- gestionar pedidos;
- gestionar cuentas corrientes;
- registrar pagos;
- gestionar archivos;
- emitir eventos en tiempo real;
- controlar errores;
- construir respuestas para el frontend.

---

## 8. Organización modular del backend

Se propone organizar el backend según funcionalidades del negocio.

La estructura conceptual inicial será:

```text
Backend
├── Auth
├── Usuarios
├── Clientes
├── Productos
├── Categorías
├── Pedidos
├── Cuentas Corrientes
├── Pagos
├── Archivos
└── Tiempo Real
```

Esta división representa responsabilidades funcionales.

No implica todavía una estructura exacta de carpetas ni obliga a utilizar un framework determinado.

La implementación concreta se decidirá posteriormente.

---

## 9. Autenticación

El módulo de autenticación será responsable de:

- recibir credenciales;
- validar usuarios;
- identificar usuarios autenticados;
- administrar tokens o sesiones;
- proteger operaciones restringidas.

Flujo conceptual:

```text
Usuario
   ↓
Credenciales
   ↓
Frontend
   ↓
Backend
   ↓
Validación
   ↓
Token / sesión
   ↓
Usuario autenticado
```

La implementación definitiva se establecerá durante la historia correspondiente a autenticación y roles.

---

## 10. Autorización

Autenticación y autorización representan responsabilidades diferentes.

La autenticación determina:

**¿Quién es el usuario?**

La autorización determina:

**¿Qué operaciones puede realizar?**

Flujo:

```text
Usuario autenticado
        ↓
Backend identifica permisos
        ↓
¿Puede ejecutar la operación?
        ↓
Sí → continúa
No → acceso rechazado
```

Los roles y permisos definitivos se establecerán durante la historia específica correspondiente.

---

## 11. Módulo de clientes

El módulo de clientes será responsable de operaciones como:

- registrar clientes;
- consultar clientes;
- modificar información;
- identificar tipo de cliente;
- administrar condición de cliente fiel;
- relacionar clientes con pedidos;
- relacionar clientes habilitados con cuenta corriente;
- activar o desactivar clientes cuando corresponda.

---

## 12. Módulo de productos

El módulo de productos será responsable de:

- registrar productos;
- consultar productos;
- modificar información;
- administrar precios;
- administrar stock actual;
- administrar imágenes;
- activar o desactivar productos;
- relacionar productos con categorías.

---

## 13. Módulo de categorías

Permitirá:

- crear categorías;
- modificar categorías;
- consultar categorías;
- activar o desactivar categorías;
- organizar productos.

---

## 14. Módulo de pedidos

El módulo de pedidos será responsable del ciclo principal de compra.

Entre sus responsabilidades se encuentran:

- crear pedidos;
- registrar productos incluidos;
- registrar cantidades;
- conservar precios utilizados;
- aplicar descuentos;
- calcular subtotales;
- calcular totales;
- administrar estados;
- consultar pedidos.

La información histórica deberá mantenerse aunque posteriormente cambie el precio actual de un producto.

---

## 15. Cuenta corriente

El sistema deberá contemplar clientes empresariales habilitados para trabajar mediante cuenta corriente.

El módulo correspondiente podrá encargarse de:

- consultar la cuenta;
- habilitar o deshabilitar su utilización;
- consultar operaciones;
- consultar pagos realizados;
- mantener información necesaria para representar el estado de la cuenta.

Las reglas comerciales específicas continuarán sujetas a validación con el cliente.

---

## 16. Pagos

El módulo de pagos permitirá:

- registrar pagos;
- registrar fecha;
- registrar monto;
- indicar método de pago;
- almacenar referencia del comprobante;
- consultar pagos;
- administrar estados;
- relacionar pagos con cuenta corriente cuando corresponda.

---

## 17. Manejo de archivos

El sistema deberá contemplar inicialmente archivos relacionados con:

- imágenes de productos;
- comprobantes de pago.

El frontend enviará los archivos al backend.

El backend deberá:

- recibirlos;
- validar su formato;
- validar su tamaño;
- determinar su almacenamiento;
- guardar una referencia persistente.

La estrategia definitiva de almacenamiento todavía no se encuentra definida.

---

## 18. Base de datos

El sistema utilizará una base de datos relacional.

El frontend nunca deberá acceder directamente a ella.

Toda operación deberá realizarse mediante el backend.

El modelo actual contempla las siguientes entidades principales:

- Cliente;
- Producto;
- Categoria;
- Pedido;
- DetallePedido;
- CuentaCorriente;
- Pago;
- Usuario.

El modelo completo se encuentra documentado mediante el MER del proyecto.

[Ver MER de Ferrepatagonia Industrial](../modelo-datos/mer-ferrepatagonia.md)

---

## 19. Flujo general de consulta

Ejemplo: consulta del catálogo.

```text
Usuario abre catálogo
        ↓
Frontend solicita productos
        ↓
GET /productos
        ↓
Backend recibe solicitud
        ↓
Backend consulta datos
        ↓
Base de datos devuelve productos
        ↓
Backend construye respuesta
        ↓
Frontend recibe información
        ↓
Frontend muestra catálogo
```

---

## 20. Flujo de creación de pedido

Un flujo conceptual podría ser:

```text
Usuario confirma carrito
        ↓
Frontend envía pedido
        ↓
POST /pedidos
        ↓
Backend valida usuario
        ↓
Backend valida productos
        ↓
Backend valida cantidades
        ↓
Backend aplica reglas comerciales
        ↓
Backend registra Pedido
        ↓
Backend registra DetallePedido
        ↓
Base de datos
        ↓
Backend responde
        ↓
Frontend muestra resultado
```

---

## 21. API REST

REST será el mecanismo principal de comunicación para ejecutar operaciones del sistema.

Ejemplos conceptuales:

```text
GET    /productos
GET    /productos/:id
GET    /categorias

POST   /pedidos
GET    /pedidos/:id

GET    /clientes/:id

POST   /pagos

POST   /auth/login
```

Estos endpoints son solamente ejemplos.

No representan todavía el contrato definitivo de la API.

La definición detallada se realizará durante la implementación.

---

## 22. Comunicación en tiempo real

Se contempla utilizar Socket.IO para funcionalidades donde resulte útil que un cambio sea informado inmediatamente a otros clientes conectados.

Posibles eventos:

- nuevo pedido;
- cambio de estado de pedido;
- actualización relevante de stock;
- pago aprobado;
- pago rechazado;
- actualización relevante del panel administrativo.

La lista definitiva será determinada durante la implementación.

---

## 23. Relación entre REST y Socket.IO

REST y Socket.IO tendrán responsabilidades diferentes.

REST realizará las operaciones principales.

Socket.IO permitirá comunicar determinados cambios después de que esas operaciones hayan sido procesadas.

Ejemplo:

```text
Frontend
   │
   │ POST /pedidos
   ▼
Backend
   │
   │ guarda pedido
   ▼
Base de datos
```

Luego:

```text
Backend
   │
   │ nuevo_pedido
   ▼
Socket.IO
   │
   ▼
Panel administrativo
```

De esta manera:

**REST ejecuta la operación.**

**Socket.IO comunica el cambio.**

---

## 24. Seguridad de las conexiones en tiempo real

Si se utiliza Socket.IO, las conexiones deberán ser autenticadas.

En caso de utilizar JWT, el backend podrá validar el token durante el establecimiento de la conexión.

JWT permite verificar la identidad del usuario mediante un token firmado.

La confidencialidad del transporte deberá garantizarse mediante HTTPS/WSS en producción.

La implementación exacta quedará sujeta a la definición final de autenticación.

---

## 25. Arquitectura general completa

```text
                         ┌─────────────────────┐
                         │       Usuario       │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │      Frontend       │
                         │   Aplicación Web    │
                         └───────┬─────┬───────┘
                                 │     ▲
                           REST  │     │ Socket.IO
                                 ▼     │
                         ┌─────────────────────┐
                         │       Backend       │
                         │  lógica de negocio  │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Base de datos     │
                         │     relacional      │
                         └─────────────────────┘
```

---

## 26. Estilo arquitectónico del backend

Para el alcance actual del MVP se propone utilizar un único backend organizado internamente mediante módulos funcionales.

No se plantea utilizar una arquitectura de microservicios.

La utilización de un único backend permite:

- reducir complejidad;
- simplificar desarrollo;
- simplificar despliegue;
- facilitar pruebas;
- facilitar depuración;
- mantener una separación lógica entre funcionalidades.

La arquitectura podrá evolucionar posteriormente si las necesidades reales del sistema lo requieren.

---

## 27. Seguridad general

La arquitectura deberá contemplar como mínimo:

- HTTPS en producción;
- autenticación;
- autorización;
- validación de información recibida;
- hash seguro de contraseñas;
- protección de endpoints;
- validación de archivos;
- manejo controlado de errores;
- protección de conexiones Socket.IO;
- control de acceso a operaciones administrativas.

Las implementaciones específicas serán definidas posteriormente.

---

## 28. Decisiones todavía abiertas

La arquitectura general puede definirse aunque todavía existan decisiones técnicas pendientes.

Actualmente resta confirmar:

- framework definitivo del backend;
- base de datos definitiva;
- herramienta de acceso a datos;
- estrategia definitiva de almacenamiento de archivos;
- implementación concreta de autenticación;
- eventos Socket.IO necesarios;
- librerías obligatorias;
- requisitos técnicos de la materia de Backend.

Estas decisiones podrán modificar detalles de implementación sin cambiar necesariamente la arquitectura general definida en este documento.

---

## 29. Relación con el stack tecnológico

Este documento define principalmente **cómo se organiza el sistema**.

El documento de stack tecnológico define principalmente **con qué herramientas se implementará**.

Por ejemplo:

```text
Arquitectura:
Frontend → Backend → Base de datos
```

Mientras que el stack podría definir:

```text
Vue → Node.js → MariaDB
```

Por este motivo, la arquitectura general puede mantenerse aunque posteriormente se modifique alguna tecnología del stack.

---

## 30. Trabajo colaborativo

La arquitectura propuesta no establece que una persona determinada sea responsable exclusivamente de una capa.

El equipo podrá distribuir las tareas según el momento del proyecto.

Un integrante podrá, por ejemplo:

- implementar una funcionalidad backend;
- trabajar luego sobre una vista frontend;
- revisar una consulta SQL;
- corregir documentación;
- participar de pruebas;
- revisar un Pull Request de otro integrante.

Las asignaciones de Taiga representan responsables de tareas específicas y no roles técnicos permanentes dentro del equipo.