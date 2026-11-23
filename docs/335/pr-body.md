## Resumen

Implementa la interfaz ADMIN de **Gestión de pagos** para consultar declaraciones de cuentas corrientes y pagos directos a pedidos `TRANSFERENCIA`, resolver la revisión documental y acreditar pagos de cuentas corrientes de empresas.

- Listado paginado con cliente/empresa, destino (`Cuenta corriente` o `Pedido #id`), importe, moneda, comprobante, estados documental/financiero y fechas.
- Detalle en diálogo modal accesible (`AdminPaymentDetailDialog`) con reconsulta real al backend, restauración de foco y soporte para `Escape`.
- Aprobación y rechazo documental con motivo y confirmación expresa, serialización concurrente `409 PAGO_YA_REVISADO` y bloqueo ante comprobantes rechazados en `/admin/comprobantes`.
- Acreditación USD/ARS con evidencia, confirmación explícita e `Idempotency-Key` UUID v4.
- Manejo de doble clic, timeout, `RESULTADO_DESCONOCIDO`, respuesta perdida, errores `4xx` definitivos y reintento con la misma clave.
- Sin creación local de ABONOS: solo la respuesta del backend actualiza la UI.
- Tarjetas responsive, foco contenido en diálogos, `role="status"`/`role="alert"`, enlaces de descarga y controles de al menos 44 px.

## Alcance y dependencias

- Integrado con el contrato unificado de #333 y #317 / PR #158 en `develop`.
- Endurece `reviewPayment` en backend (`409 PAGO_YA_REVISADO` ante carreras `APROBADO` vs `RECHAZADO`, validación de `COMPROBANTE_PAGO.estado_revision` bajo lock y alineación de `pedidoId`).
- Integra `--payment-actions` en `.github/workflows/ci.yml` (`frontend-ci`).
- No rompe contratos de `#158` ni `#334`.

## Pruebas ejecutadas

- `frontend`: type-check, build y **348/348 unitarios** OK (`8/8` en `test/admin-payments.test.cjs`).
- `backend`: type-check, build y **1407/1410 unitarios** OK (3 omitidos preexistentes, 0 fallos).
- `backend`: `npm run test:payments:isolated` → **25/25** sobre MariaDB 11.4.13.
- E2E `--payment-actions`: **21/21**.
- E2E `--payments` (no-regresión `#334`): **3/3**.
- E2E `--receipts` (no-regresión `#275`/`#318`): **10/10**.
- `git diff --check` OK.

## Evidencia SQL

- Aprobar documentación: **0 ABONOS**, `PAGO.estado = PENDIENTE`.
- Rechazar documentación: **0 ABONOS**, `PAGO.estado = RECHAZADO`.
- Acreditar USD 250,00: **exactamente 1 ABONO**.
- Acreditar ARS 300.000,00: **exactamente 1 ABONO** de USD 300,00 con cotización FER17-v1.
- Doble clic, reintento con misma clave y respuesta perdida: **1 ABONO** en cada caso.
- Cotización ausente/inválida y ADMIN revocado: **0 ABONOS**.

Las capturas responsive están en `docs/335/captures/` y el detalle completo en `docs/335/README.md`.

## Revisión solicitada

- Revisión técnica: **Bruno**.
- Validación UX/UI: **Lucci**.
