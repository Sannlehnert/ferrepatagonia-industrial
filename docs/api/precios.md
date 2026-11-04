# FER-17 / Taiga #241 — cálculo backend FER17-v1

Estado: **IMPLEMENTACIÓN PARCIAL — DEPENDENCIA #240**. No habilitar en producción.

## Alcance y base revisada

Rama `feature/241-backend-precios-cliente`, creada desde `develop`
`e651b3e1fd27870db224966f864208500db441d3`.
Política: [FER-15 D01–D12](../decisiones/fer-15-politica-precios.md).
La instrucción de #241 toma esa política como aprobada; el documento conserva su
encabezado histórico de revisión. No se modifica ni se atribuye una aprobación nueva.

El 04/11/2026 se inspeccionó el [PR #63 / #240](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/63),
rama `feature/FER-17-240-price-lists-data-model`, commit
`da63f450189b4a176172e34e9783dc347d7c3a65`: abierto, sin merge y sin reviews
registradas. No se fusionó ni se copiaron entidades, tablas o migraciones.

`develop` todavía tiene `PRODUCTO.precio` obligatorio, sin especial, listas ni
cotizaciones. Su valor legacy no se considera USD por suposición. El catálogo
vigente mantiene `precio: null` / `PENDIENTE_DEFINICION`.

## Implementación

| Archivo backend | Responsabilidad |
| --- | --- |
| `src/services/pricing/money.ts` | Decimales a escala fija con BigInt, límites y HALF_UP. |
| `src/services/pricing/pricing.types.ts` | Contratos de entrada, snapshot de servidor, fuente y resultado. |
| `src/services/pricing/pricing.engine.ts` | `calculateLine`: máximo de descuentos, unitario USD, cantidad y conversión por línea. |
| `src/services/pricing/pricing.quote.ts` | `resolveQuote`: calendario verificado, anterior hábil en Buenos Aires, vigencia y trazabilidad. |
| `src/services/pricing/pricing.service.ts` | `parsePriceRequest` y `PricingService.resolve`: autorización, contexto comercial y totales. |
| `src/routes/pricing.routes.ts` | Factory `createPricingRouter`, middlewares actuales y errores sanitizados. |
| `test/pricing.test.cjs` | Pruebas del motor, calendario, servicio y límites sin MariaDB. |
| `test/pricing.http.test.cjs` | HTTP real con Passport/JWT, repositorio de sesión y fuente comercial simulados. |
| `package.json` | Ambas suites agregadas a `test:unit`, ejecutadas también por CI. |

Se usa BigInt porque todas las operaciones tienen escalas fijas y acotadas: base y
porcentajes con 2 decimales y tasa con 8. No hace falta una biblioteca adicional;
no se cambian dependencias ni lockfile. No hay Number/parseFloat para importes.
Los números JS se usan para IDs, cantidades y fechas. El BigInt permanece interno;
la API entrega cadenas decimales canónicas: dinero/porcentajes 2 decimales, tasa 8.
Entradas fuera de escala/rango se rechazan, incluso si sobran ceros.

Unitario = HALF_UP(base × (100 − máximo(lista, especial)) / 100, 2).
Subtotal USD = unitario redondeado × cantidad. Subtotal ARS = HALF_UP(subtotal USD ×
tasa exacta, 2). Total ARS suma los renglones ya redondeados. Se verifican límites
de importes de línea y totales; no se acumulan descuentos ni se agrega IVA.

## Contrato HTTP preparado, todavía sin montar

Una vez aprobada e integrada la persistencia y validada su conexión, la composición
será `app.use('/api', createPricingRouter(service))`, después del lector JSON y con
las protecciones HTTP existentes. **Esta entrega no realiza ese montaje**: no hay
adaptador comercial productivo ni activación por variable de entorno.

- `POST /api/precios`: canal general, ignora identidad/cookie para el cálculo.
- `POST /api/precios/mios`: `authenticate`, `authorizeRoles('CLIENTE')`.

Único cuerpo admitido, sin parámetros query:

```json
{"moneda":"USD","productos":[{"productoId":7,"cantidad":2}]}
```

Se admiten USD/ARS y 1–100 productos distintos; cantidades 1–2147483647.
Se rechazan propiedades adicionales también en cada renglón, incluidos cliente,
lista, importes o descuentos. No hay ruta de consulta por cliente/lista arbitrarios.

Respuesta `{ data: PriceResult }` definida en `pricing.types.ts`: regla, IVA incluido,
moneda, líneas con producto/base/descuento/origen/unitario/cantidad/subtotales/estado,
totales y cotización exacta con referencia, carga, verificación y versión de calendario.
El DTO no incluye IDs de clientes/listas, sus nombres ni actores administrativos.
`AMBOS` significa empate positivo de porcentajes; el descuento se aplica una vez.

Estados: `DEFINIDO`, `PRECIO_AUSENTE`, `BASE_CERO`, `FINAL_CERO`, `ARS_CERO`.
Ausente conserva null; cero conserva `0.00`. Si alguna línea no tiene precio USD
positivo, totalUSD es null para impedir un total parcial. Si alguna línea ARS no
es comprable, totalARS es null. `ARS_CERO` conserva el resultado USD consultable.
`precioComprable` describe solo la condición de precio: no concede permiso de
checkout ni valida/reserva stock o aprobación empresarial.

Sin lista: 0% de lista. Inactiva: 0% de lista y evento hacia el sink administrativo
`recordInactiveList`; la promoción pública sigue aplicando. Una FK colgante o una
relación contradictoria es inconsistencia, no ausencia normal de asignación.

Errores controlados: 400 `SOLICITUD_INVALIDA` / `CANTIDAD_INVALIDA`, 401
`NO_AUTENTICADO`, 403 `NO_AUTORIZADO`, 404 `PRODUCTO_INEXISTENTE`, 422
`DATOS_COMERCIALES_INVALIDOS`, `IMPORTE_FUERA_DE_RANGO`, `CALENDARIO_NO_VERIFICADO`,
`COTIZACION_AUSENTE`, `COTIZACION_INVALIDA`. Los middlewares actuales conservan su
formato `{ message }`; los errores comerciales usan `{ code, message }`. Fallos
operativos devuelven 500 genérico sin SQL, credenciales ni stack. No se convierten
fallos de fuente en descuentos cero ni en producto sin precio.

Todas las respuestas del router, incluso fallos de autenticación, llevan
`Cache-Control: private, no-store` y `Vary: Cookie`. No hay caché del servicio.

## Adaptador pendiente y correspondencia con #240

`PricingSource.load(usuarioId | null, productoIds, at)` recibe exclusivamente el
ID USUARIO derivado por Passport de la sesión revalidada, o null en canal público.
No recibe cliente/lista/precios desde HTTP. Debe consultar un snapshot consistente
de servidor, sin mezclar lecturas de diferentes revisiones comerciales:

1. Resolver `USUARIO.id_usuario → USUARIO.id_cliente → CLIENTE`, sin asumir igualdad
   entre IDs. Revalidar usuario activo, rol CLIENTE y cliente activo. Empresas
   pendientes/rechazadas pueden consultar; confirmar compras pertenece a FER-18.
2. Proyectar `CLIENTE.id_lista_precio` y `LISTA_PRECIO` con
   `porcentaje_descuento`, `activa` a `PricingClient`. Mantener lista asignada
   inactiva para auditarla; no asignar por fidelidad, crédito ni tipo de cuenta.
3. Proyectar productos y categorías visibles/activos, con `PRODUCTO.precio` como
   base USD **solo tras verificar la unidad de datos**, y `descuento_especial_pct`
   opcional. Un producto no visible no debe aparecer en el snapshot solicitado.
4. Cargar calendario manual verificado con cobertura explícita de cada día que se
   recorre hacia atrás, incluidos fines de semana/feriados; no usar APIs externas.
5. Seleccionar cotización de la referencia exacta calculada, con tasa decimal,
   fecha, carga, actor, validez y evidencia/fecha de verificación. No basta `valida=1`.
6. Implementar `recordInactiveList` en un registro administrativo autorizado. Un
   fallo del sink permanece operativo; no se finge una auditoría persistida.

El servicio vuelve a comprobar vínculo usuario, actividad, coherencia de asignación,
porcentajes y límites. El canal público siempre usa descuento de lista cero aunque
una fuente defectuosa devolviera un cliente.

El PR #63 propone nombres compatibles para listas, productos y asignación, además
de precio nullable. `CotizacionSchema` propone `tasa`, `fecha_referencia`,
`fecha_carga`, `actor`, `valida`. **No contiene calendario versionado/verificado ni
evidencia de verificación de tasa**. Esos contratos de persistencia deben resolverse
con los responsables de #240/FER-17; no se inventa almacenamiento en #241 ni se
interpreta el default `valida=1` como evidencia. `VerifiedCalendar` y `VerifiedQuote`
son contratos internos para ese adaptador, no nuevas entidades ORM.

## Validación y pendientes

Ejecutar desde `backend`: `npm ci`, `npm run build`, `npm run type-check`,
`npm run test:unit`, `npm run test:dto-source`, `npm run test:integration`.
La suite focal puede ejecutarse con:

```sh
node --require ./test/helpers/test-env.cjs --test test/pricing.test.cjs test/pricing.http.test.cjs
```

Validación local del 04/11/2026 (Node 24.14.0, Docker/MariaDB desechable):
build y type-check aprobados; `test:unit` 1133/1133 (incluye 84 nuevos de precios),
`test:dto-source` 2/2 y `test:integration` 230/230 (222 + 8). Sin fallos ni skips.
Total: 1365 pruebas, sin contar dos veces la ejecución focal. El lockfile se instaló
con `npm ci --ignore-scripts`; no se agregó ninguna dependencia.

Las pruebas focales verifican 84 casos; las comerciales usan fixtures en memoria.
Las pruebas HTTP abren sockets reales y ejecutan Passport/authorizeRoles reales,
pero reemplazan el lookup de sesión y `PricingSource`. **No demuestran integración
de precios con MariaDB**. La suite MariaDB preexistente, cuando pasa, solo acredita
regresiones de los módulos ya integrados.

Pendiente para completar #241: aprobación e integración de #240; contratos de
calendario/verificación y datos USD confirmados; adaptador transaccional real;
pruebas MariaDB de identidad/asignaciones, descuentos/especiales, cambios concurrentes,
vigencia y auditoría; montaje de rutas tras esa validación. Mantener PR en Draft.
No cerrar #241 ni declarar FER-17 terminado con las pruebas simuladas.

Fuera de alcance: #242, #243, migraciones #240, importador FER-16, carrito/checkout
FER-18 y administración de cotizaciones/calendario. Sin merge ni autoaprobación.
