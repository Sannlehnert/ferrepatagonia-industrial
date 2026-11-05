# Integración local #241 sobre #240 — 05/11/2026

> INFORME HISTÓRICO de la rama temporal. El estado vigente de la rama oficial está
> en [API de precios](api/precios.md) y [operación](operaciones-precios.md). Los
> bloqueos y cifras siguientes corresponden exclusivamente a aquel ensayo.

**IMPLEMENTACIÓN PARCIAL. Rama exclusivamente local, sin publicación ni PR.**
Este informe complementa `api/precios.md`: las cifras de aquella entrega describen
el PR #64 original, no los resultados nuevos de esta rama temporal.

## Preparación y aislamiento

- PR #63 / Lucci: `09e768d7105c9ee1f78a4158e0ffa071083048c7`, abierto y sin fusionar.
- PR #64 / #241: `7bd1c3ad3e1f96f5299d711dafbf5e897c476daf`, Draft.
- `develop` observado: `d4a799917a7916da7e5620d94139099e87834e38`.
- Worktree `integration-241`, rama `integration/241-on-240`, creada desde HEAD #64.
- Merge local de HEAD #63: `70eabe8561424d92d044bcadd85c55c564bc491e`.
- Sin conflictos. No se modificaron las ramas originales, sus PR ni `develop`.

La historia de #240 incluye cambios de frontend y commits ya publicados de otras
tareas. Aparecen en el merge temporal por ascendencia. No se editaron en esta
integración y no deben trasladarse mediante cherry-pick del merge.

## Implementación real y alcance

`MariaDbPricingSource` consulta las entidades TypeORM de #240 utilizando un único
QueryRunner y transacción `REPEATABLE READ`. La primera lectura no bloqueante crea
la vista consistente InnoDB; identidad/lista y productos usan el mismo manager.
No se reutiliza el pool de excepción del catálogo. Commit/rollback/release son
explícitos; una conexión incierta se descarta.

El canal privado consulta `USUARIO.id_usuario → USUARIO.id_cliente → CLIENTE →
LISTA_PRECIO`, revalida usuario activo/rol CLIENTE y cliente activo, y lee la
asignación vigente. No supone igualdad entre IDs ni asigna por fidelidad/empresa.
Productos y categorías deben estar activos; precio y porcentaje se conservan como
cadenas DECIMAL. El canal público no consulta listas. Ningún precio/lista/cliente
del navegador entra en las consultas. `PricingService` mantiene su validación.

Se corrigió H01 de la auditoría: una carga cuya fecha civil Buenos Aires precede
a la referencia no puede representar el cierre indicado. Se agregaron cuatro
regresiones con UTC/offsets. No se impone una hora bancaria de cierre nueva.

## Bloqueos exactos, sin datos simulados

| Operación | Comportamiento actual | Falta para completar |
| --- | --- | --- |
| Lectura de cliente/lista/productos | Implementada y probada con MariaDB real | Aprobación del modelo #240 para incorporarla a rama oficial |
| Precios USD: lista activa o sin lista | Funciona en servicio/HTTP de prueba con dataset USD explícito | Evidencia de unidad del dataset real y habilitación productiva revisada |
| Dataset legacy sin evidencia | `503 UNIDAD_USD_NO_VERIFICADA` | Verificación/migración de unidad, sin reinterpretar valores por suposición |
| Lista inactiva | Se lee su estado real; resolver devuelve `503 AUDITORIA_LISTA_NO_DISPONIBLE` | Persistencia administrativa para el evento exigido por FER-15 |
| ARS | `422 CALENDARIO_NO_VERIFICADO`, incluso con fila `valida=1` | Calendario con cobertura/versionado/verificación y evidencia de verificación de tasa |
| Rutas en `app.ts` | **Sin montar** | Resolver bloqueos y verificar operación completa antes de exponerlas |

El constructor acepta `usdDatasetEvidence` únicamente como configuración de
servidor. No es prueba automática ni dato enviado por el cliente: la composición
productiva deberá suministrar una referencia real a la revisión del dataset.
Por defecto no tiene evidencia y bloquea. La migración #240 conserva importes,
pero no declara/verifica su unidad ni convierte ARS a USD. En pruebas la evidencia
identifica exclusivamente las filas nuevas sembradas explícitamente como USD.

No existe registro administrativo aprobado en #240 para `recordInactiveList`.
Ese método devuelve un error explícito; no registra en una tabla ajena ni informa
éxito ficticio. El motor conserva la regla 0% de lista y promoción pública en sus
tests unitarios; la resolución integrada inactiva aún no satisface ese flujo.

`COTIZACION` solo tiene `id_cotizacion`, `tasa`, `fecha_referencia`, `fecha_carga`,
`actor`, `valida`. No hay soporte completo para `VerifiedCalendar`/`VerifiedQuote`.
El adaptador devuelve calendario/cotización null; no selecciona una tasa antigua,
no llama APIs externas ni transforma `valida=1` en evidencia inventada.

La composición HTTP probada es:

```ts
const source = new MariaDbPricingSource({ usdDatasetEvidence: referenciaRealDeRevision });
const service = new PricingService(source);
// Montar solo después de resolver los bloqueos, detrás de las protecciones
// HTTP, cookieParser, Passport y JSON existentes:
// app.use('/api', createPricingRouter(service));
```

Por ahora solo el harness MariaDB monta esas rutas; `app.ts` mantiene el catálogo
vigente y la deshabilitación productiva. No hay flag que active rutas incompletas.

## Contratos a coordinar con Lucci

1. Evidencia de unidad USD y tratamiento de datos históricos; no confundir
   conservar DECIMAL con validar moneda.
2. Calendario manual, cobertura, versión, fuente, actor y fecha de verificación.
3. Evidencia/fecha de verificación de la cotización y significado de `valida`.
   Acordar además la zona horaria del DATETIME de carga, sin asumir UTC del driver.
4. Registro administrativo de lista inactiva: destino y garantías de persistencia.
5. Validar los contratos definitivos antes de habilitar ARS o montar HTTP.

No se modificó `database/schema.sql`, la migración ni las entidades de Lucci como
parte del commit propio. Sin administración #242/#243, importador, carrito o checkout.

## Validación ejecutada

Node 24.14.0, Docker/MariaDB 11.4 desechable. Sin mocks comerciales ni de lookup
de sesión en la suite nueva; JWT/Passport, HTTP, TypeORM y MariaDB son reales.

- `npm run build`: aprobado.
- `npm run type-check`: aprobado.
- `npm run test:unit`: **1137/1137**, incluidos cuatro casos nuevos H01.
- `npm run test:dto-source`: **2/2**.
- `npm run test:integration`: **258/258** = 234 admin/ORM/modelo #240 + 8 categorías
  + **16 nuevas de precios**. Sin fallos ni skips. Total general **1397**.
- `npm run test:pricing:mariadb` permite repetir solo las nuevas. Sus 16 casos
  están incluidos en el total anterior, no se suman dos veces.
- `git diff --check`: aprobado.

Las nuevas pruebas cubren: identidad con IDs distintos, clientes/listas y precios
diferentes, sin lista/fidelidad, lista inactiva bloqueada por auditoría pendiente,
especial mayor/menor y cambios posteriores, rechazo de IDs/importes arbitrarios,
producto sin precio/cero/final cero, invisibilidad, HALF_UP, errores SQL sanitizados,
sesión/rol/actividad y protección de moneda legacy. También insertan cotizaciones
ausente/flag válida/invalidada y verifican que ninguna habilite ARS sin calendario.
**No acreditan conversión ARS integrada válida**: sigue bloqueada por contrato.

La prueba concurrente pausa el orden de consultas reales después de leer la
identidad/lista; otra conexión confirma en una sola transacción lista 40% y base
200. La primera resolución conserva lista 10% y base 100 (90 USD); la siguiente
ve ambos cambios (120 USD). No se sustituyen resultados del repositorio.

El runner nuevo crea base/puerto aleatorios, usa el esquema y ejecuta la migración
original de Lucci, y elimina su contenedor con volúmenes en finally. Las regresiones
de #240 también ensayan upgrade legacy e idempotencia. Ninguna base de usuario se usa.

## Trasladar al PR #64 después del merge de #240

1. Guardar el SHA del commit propio posterior al merge temporal (`git log -1`).
2. Tras aprobación y merge real de #240, actualizar referencias y la rama #64
   mediante el flujo acordado hacia `develop`. No fusionar esta rama temporal.
3. Aplicar **solo** el commit propio con `git cherry-pick <sha-propio>`; no aplicar
   `70eabe8` ni commits de Lucci. Resolver diferencias contra el modelo finalmente aprobado.
4. Completar contratos faltantes, repetir build/tipos/suites y revisar que el diff
   del PR #64 muestre únicamente cambios propios de #241.
5. Mantener Draft y #241 parcial hasta cerrar esas dependencias y revisión independiente.

No se publicó la rama temporal ni se creó un PR de integración. No se tocó Taiga.
