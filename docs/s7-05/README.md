# S7-05.1 — Diagnóstico de precios públicos y particulares

- Fecha: 15/11/2026
- Rama: `feature/s7-05-1-pricing-diagnosis`
- Base: `develop` en `413ad8e` (merge #108)
Alcance: diagnóstico y pruebas. La verificación posterior a crear/editar precios corresponde a T-S7-05.2.

## Dictamen ejecutivo

No se encontró un error en la lógica FER-17 de `POST /api/precios` ni de
`POST /api/precios/mios`. Los precios se resuelven correctamente cuando existen
una base USD positiva y una evidencia vigente que coincide con el importe actual.

Los síntomas de la demo se explican por tres causas distintas:

1. **Despliegue desactualizado:** la base persistente observada tiene **14 tablas**
   y no incluye las tablas FER-17 (`PRECIO_USD_EVIDENCIA`, `FER17_CALENDARIO`,
   `FER17_COTIZACION_VERIFICACION`, `FER17_LISTA_INACTIVA_EVENTO`). Las rutas de
   precios responden **500** al consultar una tabla inexistente. No es un bug de
   cálculo: es una instalación sin la migración/esquema requerido.
2. **Ausencia de evidencia comercial:** aun con el esquema completo, un producto
   con precio positivo pero sin evidencia USD válida queda en
   `BASE_NO_VERIFICADA`, sin importe publicado. Es la regla FER-17, no una falla.
3. **Datos sintéticos en la demo:** si se cargan evidencias con `sintetica=1`, la
   API devuelve el importe con `datosSinteticos:true` y
   `evidenciaBaseUSD.synthetic:true`, pero el frontend rechaza esos precios para
   visitantes y clientes particulares fuera del flujo académico #286. Es una
   restricción intencional para no presentar fixtures como precios reales.

El contrato del catálogo también es intencional: `GET /api/catalogo` y
`GET /api/catalogo/:id` devuelven `precio:null` y
`estadoPrecio:"PENDIENTE_DEFINICION"`. Los importes se consultan exclusivamente
por `/api/precios` o `/api/precios/mios`.

## Estado de partida

- `git status` limpio sobre `develop`.
- HEAD de partida: `413ad8e`.
- Rama creada desde esa base: `feature/s7-05-1-pricing-diagnosis`.
- La base persistente no se modificó. Solo se ejecutaron consultas de lectura.
- Evidencia: [persistent-db-read-only.txt](evidence/persistent-db-read-only.txt).

Resultado observado en la base persistente:

```text
14 tablas
productos: 4
usuarios: 9
clientes: 8
triggers: fer260_cuenta_revision, fer260_imputacion_insert, fer260_imputacion_update
```

No existe `PRECIO_USD_EVIDENCIA` ni las demás tablas FER-17. La aplicación puede
iniciar y el catálogo responde, pero la consulta de precios falla al intentar el
`LEFT JOIN` contra esas tablas.

## Entorno aislado de reproducción

Se levantó MariaDB **11.4.13** en un contenedor descartable con:

- `database/schema.sql` completo: **21 tablas**;
- `database/migrate-fer-20-account-movements.sql` aplicado dos veces:
  **3 triggers FER-20**;
- fixtures exclusivos del contenedor, nunca instalados en la base persistente.

Verificación SQL:

```text
21 tablas
fer260_cuenta_revision:BEFORE:UPDATE:CUENTA_CORRIENTE
fer260_imputacion_insert:BEFORE:INSERT:IMPUTACION_MOVIMIENTO_CUENTA
fer260_imputacion_update:BEFORE:UPDATE:IMPUTACION_MOVIMIENTO_CUENTA
```

Evidencia completa: [pricing-diagnosis-21tables.txt](evidence/pricing-diagnosis-21tables.txt).

## Escenarios reproducidos

Fixtures del entorno aislado (solo prueba):

| Producto | Precio | Evidencia | Uso |
| --- | --- | --- | --- |
| 701 | 100.00, especial 5 % | 100.00, válida, no sintética | visitante y particulares |
| 702 | NULL | — | producto sin precio |
| 703 | 100.00 | — | precio positivo sin evidencia |
| 704 | 100.00 | 90.00, válida | evidencia dejó de coincidir |
| 705 | 100.00 | 100.00, sintética | comportamiento de fixtures |

Resultados HTTP:

| Escenario | Petición | HTTP | Estado / importe | Observación |
| --- | --- | ---: | --- | --- |
| Visitante, precio verificado | `POST /api/precios`, producto 701 | 200 | `DEFINIDO`, USD 95.00 | `datosSinteticos:false`, `Cache-Control: private, no-store` |
| Particular con lista 10 % | `POST /api/precios/mios`, usuario 901 | 200 | `DEFINIDO`, USD 90.00 | `origenDescuento:"LISTA"` |
| Particular sin lista | `POST /api/precios/mios`, usuario 902 | 200 | `DEFINIDO`, USD 95.00 | `origenDescuento:"ESPECIAL_PUBLICO"` |
| Producto sin precio | `POST /api/precios`, producto 702 | 200 | `PRECIO_AUSENTE`, total `null` | producto visible, no comprable |
| Precio positivo sin evidencia | `POST /api/precios`, producto 703 | 200 | `BASE_NO_VERIFICADA`, importes `null` | `precioBaseUSD`, `precioUnitarioUSD` y `subtotalUSD` nulos |
| Evidencia desactualizada | `POST /api/precios`, producto 704 | 200 | `BASE_NO_VERIFICADA`, importes `null` | precio 100.00 vs evidencia 90.00 |
| Evidencia válida + lista | `POST /api/precios/mios`, usuario 901 | 200 | `DEFINIDO`, USD 90.00 | caso positivo completo |
| Sin sesión | `POST /api/precios/mios` | 401 | `{"message":"No autenticado."}` | no se consulta la fuente |
| Rol ADMIN | `POST /api/precios/mios` | 403 | `{"message":"El rol autenticado no tiene permiso."}` | ruta exclusiva de CLIENTE |
| Error operativo real | `POST /api/precios` con tabla ausente | 500 | `{"message":"Error interno del servidor."}` | sin SQL, stack ni credenciales |
| Recuperación posterior | `POST /api/precios` | 200 | USD 95.00 | la conexión vuelve a operar |
| Catálogo | `GET /api/catalogo/701` | 200 | `precio:null`, `PENDIENTE_DEFINICION` | separación intencional de contratos |
| Evidencia sintética | `POST /api/precios`, producto 705 | 200 | `DEFINIDO`, `datosSinteticos:true` | el frontend la rechaza fuera del flujo académico |

Los códigos y valores anteriores coinciden con el contrato documentado en
[docs/api/precios.md](../api/precios.md).

## Evidencia de la causa en la instalación persistente

Se simuló en otro contenedor una instalación a la que se le retiran únicamente
las cuatro tablas FER-17. El catálogo siguió respondiendo 200, pero:

```text
POST /api/precios       -> 500 {"message":"Error interno del servidor."}
POST /api/precios/mios  -> 500 {"message":"Error interno del servidor."}
GET  /api/catalogo/701  -> 200 con precio:null / PENDIENTE_DEFINICION
```

Evidencia: [legacy-missing-fer17-tables.txt](evidence/legacy-missing-fer17-tables.txt).

La base persistente real tiene 14 tablas, por lo que además carece de otras
tablas posteriores; la dependencia que rompe precios es la ausencia de las tablas
FER-17. Este hallazgo es de **configuración/despliegue**, no de la regla FER-17.

## Bugs confirmados

**No se confirmó ningún bug funcional en el backend de precios.**

Comportamientos que parecen fallas pero son reglas intencionales:

- Base ausente, base cero o final cero: producto visible, no comprable.
- Base positiva sin evidencia o con evidencia de otro importe:
  `BASE_NO_VERIFICADA`, sin importe publicado.
- Lista inactiva: se aplica 0 % de lista, se conserva la promoción especial y se
  registra el evento administrativo.
- Catálogo sin precio numérico: el importe se obtiene por FER-17.
- Evidencia sintética: no se presenta como precio comercial fuera del flujo
  académico aislado.

Única brecha de cobertura corregida:

- El runner de precios no verificaba que la instalación limpia tuviera las
  **21 tablas y los 3 triggers FER-20**. Ahora lo comprueba después de aplicar las
  migraciones, antes de ejecutar la suite.

## Problemas de interfaz derivados a T-S7-05.3

No se modificaron componentes de interfaz. Se registran para esa tarea:

1. **Error de precios genérico:** `ProductPrice.vue` muestra “Precio no disponible”
   tanto para un 500 operativo como para un 401/403, un 422 comercial o un rechazo
   de datos sintéticos. El usuario no distingue una falla del servidor de una
   restricción comercial.
2. **Rechazo por lote:** `getPrices` valida `datosSinteticos` a nivel de respuesta.
   Una sola línea sintética hace fallar el lote completo y deja sin precio a
   productos verificados de la misma página. Conviene evaluar presentación por
   línea o separar lotes.
3. **Etiqueta `DEFINIDO`:** en `ProductPrice.vue` la etiqueta de `DEFINIDO` es
   “Precio a confirmar”, la misma que `PRECIO_AUSENTE`. En el flujo normal una
   línea `DEFINIDO` comprable muestra el importe, pero la copia es ambigua si se
   llegara a renderizar el fallback.
4. **Sin indicador de datos sintéticos:** cuando la API devuelve
   `datosSinteticos:true`, la UI solo muestra “Precio no disponible”. Para una
   demo académica podría ser más claro indicar que se trata de datos simulados,
   sin presentarlos como precio comercial.

## Cambios necesarios para T-S7-05.2

La implementación actual de administración de productos no escribe ni invalida
`PRECIO_USD_EVIDENCIA`. Por eso, al crear o editar un precio, la evidencia anterior
deja de coincidir y el producto pasa a `BASE_NO_VERIFICADA` hasta una nueva
verificación. Eso es correcto según FER-17, pero falta el flujo de verificación:

1. Tras crear o modificar `PRODUCTO.precio`, exigir una revisión documental del
   importe exacto antes de publicarlo como `DEFINIDO`.
2. Registrar la evidencia con el precio exacto vigente, referencia publicable,
   ADMIN responsable, instante UTC real, `valida=1` y `sintetica=0` en una
   instalación normal.
3. No copiar automáticamente la evidencia anterior a un precio nuevo.
4. Invalidar o reemplazar la evidencia anterior en la misma operación, sin dejar
   una fila que pueda volver a coincidir por casualidad.
5. Mantener los fixtures sintéticos exclusivamente en bases descartables.
6. Evaluar si la respuesta administrativa debe informar explícitamente que el
   precio quedó pendiente de verificación.

## Pruebas ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm --prefix backend run type-check` | OK, sin errores |
| `npm --prefix backend run build` | OK |
| `npm --prefix backend run test:unit` | 1265/1265 |
| `npm --prefix backend run test:pricing:mariadb` | 42/42; 21 tablas + 3 triggers verificados |
| `npm --prefix frontend test` | 221/221 |
| `npm --prefix frontend run build` | OK, incluye `vue-tsc` |
| `git diff --check` | OK, sin errores de whitespace |

Evidencia de la suite de precios: [pricing-suite.txt](evidence/pricing-suite.txt).

La suite de precios cubre los ocho escenarios pedidos, incluidos estados
`DEFINIDO`, `PRECIO_AUSENTE` y `BASE_NO_VERIFICADA`, listas activas/inactivas,
sesión inválida, rol no autorizado y error SQL real sanitizado. Las pruebas
frontend cubren presentación positiva, rechazo de datos sintéticos, estados sin
importe y aislamiento entre sesiones.

## Archivos modificados

```text
backend/test/helpers/run-pricing-mariadb.cjs
backend/test/pricing.mariadb.test.cjs
docs/s7-05/README.md
docs/s7-05/evidence/legacy-missing-fer17-tables.txt
docs/s7-05/evidence/persistent-db-read-only.txt
docs/s7-05/evidence/pricing-diagnosis-21tables.txt
docs/s7-05/evidence/pricing-suite.txt
```

No se modificaron reglas comerciales, validaciones de evidencia, componentes de
frontend ni la base persistente.

## Entrega y revisión

- Rama local: `feature/s7-05-1-pricing-diagnosis`.
- No se realizó merge.
- No se creó PR remoto: la política de trabajo prohíbe empujar cambios a un
  repositorio remoto sin autorización explícita. La rama queda lista para que
  Lucci revise y, si corresponde, se publique el PR hacia `develop`.
- Título sugerido de PR: `test(pricing): diagnose public and particular price visibility (S7-05.1)`.

## Riesgos y pendientes

- La base persistente de 14 tablas seguirá devolviendo 500 en precios hasta que se
  aplique el esquema/migraciones FER-17 en una instalación controlada. No se tocó
  esa base por indicación de la tarea.
- La demo no debe resolverse cargando evidencias sintéticas en una instalación
  normal: eso activaría `datosSinteticos:true` y el frontend las rechazaría, además
  de presentar fixtures como si fueran precios comerciales.
- La verificación posterior a crear/editar precios queda explícitamente para
  T-S7-05.2.
