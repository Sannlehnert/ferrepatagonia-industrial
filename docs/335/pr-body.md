## Resumen

Implementa la interfaz ADMIN de **Gestión de pagos** para consultar declaraciones, resolver la revisión documental y acreditar pagos de cuentas corrientes de empresas.

- Listado paginado con cliente/empresa, importe, moneda, comprobante, estados documental/financiero y fechas.
- Detalle con reconsulta real al backend.
- Aprobación y rechazo documental con motivo y confirmación expresa.
- Acreditación USD/ARS con evidencia, confirmación explícita e `Idempotency-Key` UUID v4.
- Manejo de doble clic, timeout, `RESULTADO_DESCONOCIDO`, respuesta perdida y reintento con la misma clave.
- Sin creación local de ABONOS: solo la respuesta del backend actualiza la UI.
- Tarjetas responsive, foco contenido en diálogos, `role="status"`/`role="alert"` y controles de 44 px.

## Alcance y dependencias

- Reutiliza el contrato de #333 ya integrado en `develop`.
- No modifica reglas financieras ni código productivo del backend.
- No incorpora #334.
- #317 / PR #158 no está integrado en `develop`; esta rama no asume su contrato.

## Pruebas ejecutadas

- `frontend`: type-check, build y **298 unitarios** OK.
- `backend`: type-check, build y **5 unitarios de pagos** OK.
- `backend`: `npm run test:payments:isolated` → **23/23** sobre MariaDB 11.4.13.
- E2E focalizadas: `node test/helpers/run-e2e.cjs --payment-actions` → **21/21**.
- E2E integradas: `node test/helpers/run-e2e.cjs` → **286 pass, 4 skipped, 0 fail**.
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
