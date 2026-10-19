# FER-15 · Taiga #207 — Modelo de listas de precios por cliente

**Propuesta para revisión de Sprint 4 · 18/10/2026.** Diseño mínimo sujeto a validación comercial; no modifica el MER, SQL, código ni el contrato público.

## Modelo y relaciones propuestos

| Entidad | Atributos mínimos y restricciones propuestas |
| --- | --- |
| `LISTA_PRECIO` (nueva) | `id_lista_precio` INT PK; `nombre` obligatorio; `moneda` CHAR(3) obligatoria, código autorizado por negocio; `activa` booleano obligatorio. |
| `LISTA_PRECIO_PRODUCTO` (nueva) | `id_lista_precio` y `id_producto` FK, PK compuesta; `precio` DECIMAL(12,2) NOT NULL, CHECK >= 0. Cada fila fija el importe de un producto en la moneda de su lista. |
| `CLIENTE` (existente) | Proponer `id_lista_precio` INT NULL, FK a `LISTA_PRECIO`: cero o una lista asignada por cliente. No implementado en esta tarea. |

Una lista puede asignarse a **0..N clientes** y contener **0..N productos**; un producto puede pertenecer a **0..N listas** mediante `LISTA_PRECIO_PRODUCTO` (N:M). Cada detalle referencia exactamente una lista y un producto. La FK nullable en `CLIENTE` evita una tabla de asignaciones para una sola lista actual y permite compartirla; una lista exclusiva se asignaría a un único cliente. Se descartan por ahora múltiples listas por cliente, prioridades y vigencias.

## Asignación y resolución propuestas

1. Administración asignaría, reemplazaría o quitaría la lista del cliente, sin automatismos por registro, aprobación, `es_fiel` o cuenta corriente. El backend resolvería el cliente desde su identidad autenticada y validaría la asignación.
2. Para cada producto, buscaría su importe en la lista asignada y activa. Ese importe explícito sería el precio aplicable, sin descuentos ni conversiones implícitos.
3. **Fallback propuesto:** sin lista, con lista inactiva o sin ese producto, devolver precio no definido y requerir definición comercial antes de confirmar ese ítem. No usar automáticamente `PRODUCTO.precio`, cero ni otra lista. Una lista general o precio base como fallback requiere aprobación expresa.

El visitante no tiene asignación de cliente; la visibilidad de precios para visitante, particular y empresa sigue pendiente. El catálogo público conserva `precio: null` y `estadoPrecio: 'PENDIENTE_DEFINICION'`, sin moneda, hasta aprobar e implementar otro contrato; esta propuesta no activa precios personalizados en ese endpoint.

## Compatibilidad, integridad e histórico

Se reutilizan `CLIENTE`, `PRODUCTO`, `PEDIDO` y `DETALLE_PEDIDO`. `PRODUCTO.precio DECIMAL(12,2)` ya existe y exige valor no negativo: su significado como precio base y su publicación **no están aprobados**. Las nuevas FK usarían RESTRICT para evitar referencias rotas; se preferiría desactivar listas. La PK compuesta impide duplicar precios por lista/producto; una asignación debe apuntar a lista activa, validada al asignar y al resolver.

La asignación no concede permiso de compra: conforme al MER, una `EMPRESA` `PENDIENTE` o `RECHAZADA` **no puede confirmar pedidos**, incluso con lista, cuenta corriente o `es_fiel`. Al confirmar, el backend debería revalidar permisos y precio en la operación transaccional y conservar el importe aplicado en `DETALLE_PEDIDO.precio_unitario`; cambios posteriores de lista no recalculan pedidos históricos.

## Decisiones para validar con cliente/equipo

Confirmar una lista por cliente y posibilidad de compartirla; quién administra asignaciones; visibilidad por perfil; significado del precio base; fallback y listas incompletas; tratamiento de cero, impuestos, descuentos y redondeo. El README menciona cotización del dólar, pero **no acredita precios en USD**: moneda de listas/pedidos y conversiones requieren definición. MER y SQL no almacenan moneda ni cotización histórica; si se aprueba conversión o multimoneda, habrá que diseñar su persistencia antes de implementar para interpretar los importes históricos.

**Fuentes locales:** [MER vigente](../modelo-datos/mer-ferrepatagonia.md), [schema.sql](../../database/schema.sql), [README: alcance y decisiones comerciales](../../README.md), [arquitectura: pedidos e histórico](../arquitectura/arquitectura-general.md), [contrato del catálogo](../api/catalogo.md). La política provisional de precios figura en HEAD y en la copia local; los cambios locales sin commit de #194 sobre búsqueda/categoría no se toman como nuevas decisiones comerciales.
