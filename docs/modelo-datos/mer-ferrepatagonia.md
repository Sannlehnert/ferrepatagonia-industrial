# Ferrepatagonia Industrial — Modelo entidad-relación

> Propuesta de actualización de la tarea #98, basada en el MER previo y en las definiciones de acceso del MVP. Mantener el historial y las secciones adicionales del archivo original del repositorio si existieran.

```mermaid
erDiagram
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

    CLIENTE {
        int id_cliente PK
        string tipo_cliente
        string nombre_razon_social
        string doc_cliente
        string cuit
        string email
        string telefono
        string direccion
        boolean es_fiel
        boolean activo
        datetime fecha_alta
    }

    USUARIO {
        int id_usuario PK
        int id_cliente FK,UK
        string email
        string password_hash
        string rol
        boolean activo
        datetime fecha_creacion
        datetime ultimo_acceso
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
        int id_pedido FK
        int id_cuenta_corriente FK
        datetime fecha
        decimal monto
        string metodo_pago
        string estado
        string comprobante
        string observaciones
    }

    CATEGORIA ||--o{ PRODUCTO : agrupa
    PRODUCTO ||--o{ DETALLE_PEDIDO : aparece_en
    CLIENTE ||--o{ PEDIDO : realiza
    PEDIDO ||--|{ DETALLE_PEDIDO : contiene
    CLIENTE ||--o| CUENTA_CORRIENTE : posee
    CLIENTE o|--o| USUARIO : dispone_de_acceso
    PEDIDO o|--o{ PAGO : recibe_pagos_directos
    CUENTA_CORRIENTE o|--o{ PAGO : registra_pagos_de_cuenta
```

## Reglas y alcance de la actualización

**Identidad y roles (definición de la historia #68)**

- `USUARIO.rol` admite `CLIENTE` o `ADMIN`. El visitante no necesita registro en `USUARIO`.
- `CLIENTE.tipo_cliente` admite `PARTICULAR` o `EMPRESA`. Es una característica comercial, no un rol de autenticación.
- Si `USUARIO.rol = CLIENTE`, `USUARIO.id_cliente` es obligatorio y referencia un único `CLIENTE`.
- Si `USUARIO.rol = ADMIN`, `USUARIO.id_cliente` es nulo; no se crea una entidad `ADMINISTRADOR` para el MVP.
- `USUARIO.id_cliente` es único cuando no es nulo, de modo que cada `CLIENTE` tiene cero o una cuenta de acceso. La notación del diagrama expresa la opcionalidad general; las reglas condicionales por rol deben implementarse como restricciones y/o validaciones de backend.
- La cuenta corriente y la condición de cliente fiel no son roles. El acceso a operaciones de crédito requiere comprobar habilitación, propiedad y reglas comerciales vigentes.

**Pagos y comprobantes (ajuste propuesto para representar compras convencionales)**

- `PAGO.id_pedido` referencia un pedido cuando el pago corresponde a una compra convencional, sea de un cliente particular o de una empresa.
- `PAGO.id_cuenta_corriente` referencia una cuenta corriente cuando el pago corresponde a un abono de esa cuenta.
- En el diseño inicial, **exactamente uno** entre `id_pedido` e `id_cuenta_corriente` tiene un valor por pago; ambos campos son individualmente anulables. El diagrama ER, por sí solo, no representa esta exclusividad: debe aplicarse con una restricción `CHECK` o validación transaccional.
- Para un pago directo, el cliente autorizado se obtiene a partir de `PEDIDO.id_cliente`; para un abono de cuenta corriente, de `CUENTA_CORRIENTE.id_cliente`. En ambos casos, el backend comprueba la pertenencia antes de aceptar o mostrar comprobantes.
- Subir un comprobante no implica que el pago esté validado: su estado se administra según el flujo de pagos.
- **Supuesto de alcance por confirmar:** un pago de cuenta corriente se registra contra la cuenta, no se distribuye automáticamente entre múltiples pedidos. Si se necesita imputar un único abono a varias facturas/pedidos, hará falta modelar esa imputación por separado.

**Nota de implementación:** verificar la sintaxis de tipos y claves con el motor de base de datos finalmente elegido. Mermaid es un modelo conceptual: la nulabilidad condicional, `UNIQUE`, `CHECK`, claves foráneas, dominios de valores y políticas de borrado se definirán en el esquema/migraciones SQL.
