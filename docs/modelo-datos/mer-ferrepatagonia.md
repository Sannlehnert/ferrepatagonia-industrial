# Modelo Entidad-Relación — Ferrepatagonia Industrial

Este documento contiene la representación actual del modelo de datos del MVP de Ferrepatagonia Industrial.

El modelo fue construido a partir del relevamiento, las reglas del negocio y las definiciones realizadas durante el Sprint 1.

La representación utiliza Mermaid para mantener el modelo versionado junto con el código fuente del proyecto.

> Las definiciones relacionadas con usuarios, roles y autenticación podrán actualizarse durante la historia correspondiente.

## MER

```mermaid
erDiagram

    CLIENTE {
        int id_cliente PK
        string nombre_razon_social
        string tipo_cliente
        string cuit
        string email
        string telefono
        string direccion
        boolean es_fiel
        boolean activo
        datetime fecha_alta
    }

    CATEGORIA {
        int id_categoria PK
        string nombre
        string descripcion
        boolean activo
    }

    PRODUCTO {
        int id_producto PK
        int id_categoria FK
        string codigo
        string nombre
        string descripcion
        decimal precio
        int stock
        string imagen
        boolean activo
        datetime fecha_actualizacion
    }

    PEDIDO {
        int id_pedido PK
        int id_cliente FK
        datetime fecha
        string estado
        string modalidad_pago
        decimal subtotal
        decimal descuento
        decimal total
        string observaciones
    }

    DETALLE_PEDIDO {
        int id_detalle_pedido PK
        int id_pedido FK
        int id_producto FK
        int cantidad
        decimal precio_unitario
        decimal descuento
        decimal subtotal
    }

    CUENTA_CORRIENTE {
        int id_cuenta_corriente PK
        int id_cliente FK
        decimal limite_credito
        boolean habilitada
        datetime fecha_alta
        string observaciones
    }

    PAGO {
        int id_pago PK
        int id_cuenta_corriente FK
        datetime fecha
        decimal monto
        string metodo_pago
        string estado
        string comprobante
        string observaciones
    }

    USUARIO {
        int id_usuario PK
        string email
        string password_hash
        boolean activo
        datetime fecha_creacion
        datetime ultimo_acceso
    }

    CLIENTE ||--o{ PEDIDO : realiza
    PEDIDO ||--|{ DETALLE_PEDIDO : contiene
    PRODUCTO ||--o{ DETALLE_PEDIDO : "aparece en"
    CATEGORIA ||--o{ PRODUCTO : agrupa
    CLIENTE ||--o| CUENTA_CORRIENTE : posee
    CUENTA_CORRIENTE ||--o{ PAGO : registra
```

## Decisiones del MVP

- Un cliente puede realizar múltiples pedidos.
- Un pedido confirmado contiene uno o más detalles.
- `DETALLE_PEDIDO` resuelve la relación entre pedidos y productos y conserva los valores utilizados al momento de la operación.
- Un cliente puede no poseer cuenta corriente o poseer una única cuenta.
- Para el MVP cada producto pertenece a una categoría.
- Una cuenta corriente puede registrar múltiples pagos.
- El stock se mantiene como atributo de `PRODUCTO`.
- La condición de cliente fiel se representa mediante `CLIENTE.es_fiel`.
- El comprobante de pago se mantiene como referencia dentro de `PAGO`.
- La cotización del dólar se considera una configuración del sistema y no una entidad independiente.

## Decisiones pendientes

La entidad `USUARIO` se mantiene sin una relación definitiva dentro del MER hasta completar la definición de roles y autenticación.

Durante esa historia se deberá establecer:

- relación entre Usuario y Cliente;
- representación de usuarios administrativos;
- roles existentes;
- permisos asociados a cada rol.

El modelo podrá actualizarse posteriormente a partir de estas definiciones.