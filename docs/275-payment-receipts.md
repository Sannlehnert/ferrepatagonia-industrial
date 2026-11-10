# Comprobantes de pago (#275)

El comprobante documenta la recepción de una transferencia. La carga y la revisión documental conservan el pedido, el pago, la cuenta corriente, sus movimientos y los saldos. El campo histórico `PAGO.comprobante` sigue siendo una referencia del registro de pago.

## Operaciones y pantallas

| Perfil | Operación | Pantalla |
| --- | --- | --- |
| Particular activo | Pedido propio persistido con modalidad `TRANSFERENCIA`. | **Mi cuenta → Historial de pedidos → Ver detalle → Comprobantes de pago** |
| Empresa activa con cuenta corriente | Transferencia destinada al saldo general o con referencia a un pedido propio `CUENTA_CORRIENTE`. Una cuenta inhabilitada para compras conserva la posibilidad de documentar el pago de deuda. | **Mi cuenta → Cuenta corriente** para saldo general. **Historial de pedidos → Ver detalle** para vincular un pedido. |
| ADMIN activo | Listado, descarga y revisión documental. La primera revisión registra el usuario y el instante, y los reintentos conservan ambos. | **Administración → Comprobantes de pago** |

El checkout existente confirma compras empresariales por cuenta corriente. Para demostrar el recorrido particular hace falta un pedido `TRANSFERENCIA` persistido por un proceso autorizado. La prueba de navegador usa un pedido de prueba en MariaDB descartable.

## API autenticada

| Método | Ruta | Acceso |
| --- | --- | --- |
| POST | `/api/pedidos/:pedidoId/comprobantes` | Particular o empresa titular, según la modalidad del pedido. |
| GET | `/api/pedidos/:pedidoId/comprobantes` | Titular. |
| GET | `/api/pedidos/:pedidoId/comprobantes/:id` | Descarga del titular, con coincidencia exacta de pedido. |
| POST | `/api/cuenta-corriente/comprobantes` | Empresa titular. `?pedidoId=<id>` permite referenciar un pedido propio de cuenta corriente. Al omitirlo se documenta el saldo general. |
| GET | `/api/cuenta-corriente/comprobantes` | Empresa titular. Incluye saldo general y referencias a pedidos de esa cuenta. |
| GET | `/api/cuenta-corriente/comprobantes/:id` | Descarga de la empresa titular. |
| GET | `/api/admin/comprobantes` | ADMIN. |
| GET | `/api/admin/comprobantes/:id` | Descarga de ADMIN. |
| PATCH | `/api/admin/comprobantes/:id/revision` | ADMIN. Marca `REVISADO` sin cuerpo. |

El POST recibe los bytes en el cuerpo y un `Content-Type` exacto entre `application/pdf`, `image/jpeg` e `image/png`. Límite de 5 MiB (5.242.880 bytes). Usa la cookie de sesión vigente y la política de mismo origen para escrituras. El nombre de entrada se descarta. El servidor valida estructura y contenido en un worker limitado, decodifica las imágenes y rechaza PDFs cifrados o con acciones, archivos embebidos o multimedia activa. Se conservan los bytes originales de los archivos aceptados.

El POST devuelve `201 { data }`. Repetir el mismo contenido para el mismo destino devuelve `200 { data }` con el comprobante existente. Los listados reciben `?pagina=1` y devuelven `{ data: { items, paginaSiguiente } }`, con hasta 50 elementos. Cada DTO incluye `id`, `pedidoId`, `cuentaCorrienteId`, `tipoMime`, `bytes`, `fecha` UTC, `estadoRevision` y `revisadoEn`. ADMIN recibe también `clienteId` y `cliente`. Los binarios se entregan como adjunto y todas las respuestas llevan `Cache-Control: private, no-store`.

| Estado | Motivo |
| --- | --- |
| 400 | Parámetros inválidos o archivo vacío. |
| 401 / 403 | Sesión ausente o rol insuficiente. |
| 404 | Destino ajeno o inexistente, modalidad incompatible o comprobante fuera del alcance de la ruta. |
| 413 / 415 / 422 | Tamaño excedido, tipo o codificación no admitidos, o contenido dañado o no permitido. |
| 503 | Saturación de cargas o indisponibilidad de la persistencia. |

## Despliegue y recuperación

1. Aplicar `database/migrate-273-order-instant.sql` y `database/migrate-275-payment-receipts.sql` en la base existente. Una base inicial creada con `schema.sql` incluye ambos cambios. Revisar la convención histórica de [#273](273-order-history.md).
2. Crear un directorio exclusivo y persistente, fuera del checkout y de todas las raíces públicas. En Unix debe ser accesible solo por el usuario de la API (modo `0700`). En Windows aplicar una ACL equivalente. Configurar su ruta absoluta en `RECEIPT_STORAGE_DIR`. Si hay réplicas, deben compartir el mismo volumen privado. Ajustar el límite del proxy para permitir el tamaño máximo.
3. Respaldar y restaurar el directorio junto con `COMPROBANTE_PAGO`. El UUID de la fila es la clave del archivo. Un fallo confirmado de SQL limpia el archivo y una carga concurrente idéntica conserva una única fila. Si se pierde el acuse del COMMIT, el archivo se conserva y el reintento puede recuperar la fila por huella. Tras una caída abrupta, reconciliar con la API detenida y una copia de seguridad. Comparar los UUID del volumen con la tabla, retirar los archivos sin fila y restaurar los que falten desde el respaldo.

Las pruebas de API se ejecutan con `npm run test:receipts:isolated` desde `backend/`. La prueba de navegador se ejecuta desde la raíz con `node backend/test/helpers/run-e2e.cjs --receipts` después de compilar el backend e instalar Chromium para Playwright. CI ejecuta ambas suites con base y almacenamiento descartables.
