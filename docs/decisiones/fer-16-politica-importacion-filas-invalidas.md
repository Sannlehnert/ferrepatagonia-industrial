# Política de Importación de Productos: Previsualización, Idempotencia y Manejo de Filas Inválidas (#236)

## 1. Alcance y Contexto
Esta política define el comportamiento transaccional del backend ante la importación masiva de productos (archivos CSV y XLSX), garantizando que nunca se produzcan escrituras parciales no informadas ni duplicación de registros por reintentos o colisiones concurrentes.

## 2. Fase de Previsualización (Sin Escritura)
* Los endpoints `POST /api/admin/productos/importar/previsualizar` y `POST /api/admin/productos/importar/preview` ejecutan un análisis completo en memoria.
* Devuelve el desglose exacto: `totalRows`, `validRowsCount`, `invalidRowsCount`, `duplicateInFileCount`, `existingInDbCount`, el listado de errores por fila y un `previewToken` con tiempo de expiración (TTL de 30 minutos).
* No realiza ninguna mutación en la base de datos MariaDB.

## 3. Fase de Confirmación Explícita e Idempotencia
* La confirmación se ejecuta mediante `POST /api/admin/productos/importar/confirmar` con rol `ADMIN`.
* **Protección ante solicitudes repetidas:** el `previewToken` cambia su estado a `PROCESSING` y luego a `COMPLETED`. Intentos simultáneos o repetidos devuelven `409 Conflict`, impidiendo el alta duplicada del lote.
* **Candados de concurrencia:** se adquieren bloqueos temporales sobre los códigos SKU en memoria durante la transacción para evitar colisiones entre administradores.

## 4. Política para Filas Inválidas y Duplicadas
* **Filas inválidas de formato/DTO:** se marcan como `rechazado`, informando fila y motivo sin persistir.
* **SKUs ya existentes en el catálogo:** se marcan como `omitido`, preservando los datos preexistentes sin sobreescribirlos de manera no autorizada.
* **Colisión concurrente (`ER_DUP_ENTRY`):** capturada y reportada como `omitido`/`rechazado` dentro del reporte final.
* **Resultado final:** se garantiza que `totalProcesados = importados + omitidos + rechazados`. Cada ítem queda explícitamente informado en el desglose final.