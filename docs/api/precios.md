# FER-17 / #241 — servicio productivo FER17-v1

Implementado sobre #240 integrado en develop `2ea4a33e0bf6cde264d0fb256e999645ea4f3f86`.
Sujeto a auditoría independiente, sin autoaprobación ni merge. [Política D01–D12](../decisiones/fer-15-politica-precios.md).
Las cifras y bloqueos del [informe temporal](../integracion-241-on-240.md) son históricos.

## HTTP y seguridad

Montado en `app.ts`, detrás de protección de origen/HTTPS/proxy existente,
cookieParser, Passport y JSON. Fuente real `MariaDbPricingSource`, sin fixtures en
producción ni flags para sustituirla.

- `POST /api/precios`: público. Siempre lista 0%, incluso con cookie válida.
- `POST /api/precios/mios`: Passport JWT y `authorizeRoles('CLIENTE')`.

Único cuerpo admitido, sin query:

```json
{"moneda":"USD","productos":[{"productoId":701,"cantidad":2}]}
```

USD/ARS; 1–100 productos distintos; cantidades enteras 1–2147483647. IDs enteros
positivos de INT. Rechaza propiedades adicionales tanto en raíz como en líneas,
incluidos cliente, lista, importes y descuentos. No hay consulta por cliente ajeno.
El JWT identifica `id_usuario`; la fuente resuelve `USUARIO.id_cliente` y revalida
usuario activo/rol y cliente activo. No concede descuentos por fidelidad/crédito.
Empresas pendientes/rechazadas pueden consultar, sin conceder permiso de checkout.

Cada respuesta del router usa `Cache-Control: private, no-store` y `Vary: Cookie`.
No existe caché comercial. Fallos operativos se sanitizan, sin SQL/stack/credenciales.

## Respuesta y exactitud

`{data: PriceResult}`; contrato tipado en `pricing.types.ts`. Ejemplo sintético
abreviado para una línea pública base USD 100, especial 5%, cantidad 2:

```json
{
  "data": {
    "regla":"FER17-v1","ivaIncluido":true,"moneda":"USD","datosSinteticos":true,
    "productos":[{
      "productoId":701,"moneda":"USD","precioBaseUSD":"100.00",
      "descuentoAplicado":"5.00","origenDescuento":"ESPECIAL_PUBLICO",
      "precioUnitarioUSD":"95.00","cantidad":2,"subtotalUSD":"190.00",
      "subtotalARS":null,"estadoPrecio":"DEFINIDO","precioComprable":true
    }],
    "totalUSD":"190.00","totalARS":null,"cotizacion":null
  }
}
```

Las líneas acreditadas también incluyen `evidenciaBaseUSD` con referencia, instante
de verificación y marca sintética. ARS incluye tasa exacta a ocho decimales, ID de
cotización, referencia, carga UTC, verificación, evidencia y versión/evidencia/fecha
de calendario. No se devuelven clientes/listas ajenos ni actores administrativos.
`datosSinteticos` señala fixtures explícitos; nunca los presenta como precios/BNA reales.
Las referencias de evidencia deben ser identificadores publicables, sin datos privados.

Dinero/porcentajes: cadenas canónicas con dos decimales; tasa: ocho. BigInt a escalas
fijas, sin Number/parseFloat monetario y sin dependencia adicional. Rechaza entradas
negativas, no finitas, fuera de rango/escala; no normaliza silenciosamente escalas
inválidas. Descuento = max(lista activa o 0, especial público), aplicado una vez.
`AMBOS` es empate positivo, sin duplicación. IVA incluido; nunca se agrega de nuevo.

HALF_UP unitario USD antes de multiplicar cantidad; ARS convierte cada subtotal de
línea con tasa exacta y redondea a centavos. Total ARS suma líneas redondeadas.
Se comprueban máximos de línea y total 9999999999.99. Subtotal de 0.01 USD con tasa
sintética 1.50 produce 0.02 ARS por línea: dos líneas totalizan 0.04, no 0.03.

Estados: `DEFINIDO`, `PRECIO_AUSENTE`, `BASE_CERO`, `BASE_NO_VERIFICADA`, `FINAL_CERO`,
`ARS_CERO`. No se confunden null y cero explícito. Base positiva sin evidencia no
se publica como USD: base/unitario/subtotal null, no comprable. Precio cero sigue
siendo cero, no un centinela. Si una línea no tiene precio USD positivo no hay
total USD parcial. ARS cero bloquea su total, conservando consulta USD.
`precioComprable` describe precio, no stock reservado ni autorización de compra.

## Persistencia y transacción

[Operación, migraciones y carga manual](../operaciones-precios.md).
Se conserva exactamente el esquema #240. La extensión #241 añade cuatro tablas;
no convierte precios ni altera productos, pedidos o cotizaciones históricos.

Toda la lectura usa un QueryRunner TypeORM y `REPEATABLE READ`: identidad/lista,
productos/evidencias, calendario y cotización pertenecen a la misma vista InnoDB.
El cálculo ocurre dentro de esa transacción. La lista inactiva aplica 0% conservando
especial público y registra evento en la misma transacción; cualquier fallo de
cálculo/persistencia revierte el evento y no publica una respuesta de éxito.
La observación se deduplica por usuario/cliente/lista/fecha civil Buenos Aires.
Solicitudes repetidas o simultáneas no producen duplicaciones diarias innecesarias.

La evidencia USD está vinculada al importe exacto actual, un ADMIN y un instante
no futuro. Cambiar el precio invalida esa evidencia hasta nueva revisión. No hay
evidencia global de dataset que habilite importes arbitrarios por configuración.

ARS exige calendario activo/verificado/versionado con cobertura explícita de cada
fecha recorrida. Nunca presume feriados. Referencia = mayor hábil estrictamente
anterior a la fecha civil `America/Argentina/Buenos_Aires`. USD no requiere calendario.
Solo se busca la tasa de esa referencia, sin fallback a otra fecha. `valida=1` en
la tabla original no basta: exige verificación BNA/VENDEDOR, tasa/referencia/actor
idénticos al registro original, cronología carga≤verificación≤uso y H01. La carga
civil original debe coincidir con el UTC acreditado convertido mediante la zona IANA.
Se evita la conversión implícita de DATETIME por la zona horaria del driver/host.

La respuesta conserva valores y referencias de la resolución: puede copiarse como
snapshot en una futura operación sin recalcular históricos. Persistir pedidos,
checkout y aceptación de cambios futuros corresponden a otras historias.

## Errores

| HTTP | Código o formato |
| --- | --- |
| 400 | `SOLICITUD_INVALIDA`, `CANTIDAD_INVALIDA`; JSON inválido usa error genérico existente |
| 401/403 | Middlewares `{message}`; servicio `NO_AUTENTICADO` / `NO_AUTORIZADO` |
| 404 | `PRODUCTO_INEXISTENTE`, también para producto/categoría no visibles |
| 422 | `DATOS_COMERCIALES_INVALIDOS`, `IMPORTE_FUERA_DE_RANGO`, `CALENDARIO_NO_VERIFICADO`, `COTIZACION_AUSENTE`, `COTIZACION_INVALIDA` |
| 500 | `{message:"Error interno del servidor."}` sin detalles internos |

Falta de precio/evidencia y lista ausente/inactiva son estados/reglas comerciales,
no errores operativos. La identidad, evidencia y trazabilidad se consultan en servidor.

## Validación final local (05/11/2026)

- Build y type-check backend: aprobados.
- `test:unit`: 1139/1139, incluye 90 casos focales de precios/HTTP.
- `test:dto-source`: 2/2.
- `test:integration`: 274/274 = 234 admin/ORM/#240 + 8 categorías + 32 precios.
- Total backend: **1415**, sin fallos ni skips; no duplicar ejecución focal.
- Frontend: 124/124 y build/type-check aprobados, sin cambios funcionales frontend.
- La extensión se ejecutó dos veces sobre esquema #240 con valor legacy 173.12:
  conservado sin crear evidencia ni convertirlo. Esquema nuevo también se ensaya.
- Las 32 pruebas usan aplicación productiva, HTTP, JWT, Passport, TypeORM y MariaDB
  reales. Cubren aislamiento, IDOR, estados, ARS/HALF_UP, cronología, rechazo de tasa,
  eventos concurrentes deduplicados, rollback, errores SQL y snapshot concurrente.

Fuera de alcance: #242, #243, FER-16, carrito, crédito, checkout y APIs administrativas.
La carga manual verificable es operación de datos controlada, no una interfaz de administración.
