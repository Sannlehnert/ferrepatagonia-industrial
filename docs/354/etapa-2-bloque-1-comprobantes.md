# Etapa 2 · Bloque 1 — D354-02 Carga de comprobantes

Fecha: 24/11/2026.
Rama: `fix/354-final-acceptance`.
Base de la etapa: `aaa9875`.

## 1. Diagnóstico

El mensaje reportado:

> El archivo está dañado, contiene elementos no permitidos o no coincide con su tipo.

se producía en `PaymentReceipts.vue` al recibir `CONTENIDO_INVALIDO` desde
`validateReceiptContent`.

La validación real se ejecuta en un worker aislado:

- verifica firma, estructura y tipo MIME;
- decodifica imágenes con `sharp` y `failOn: warning`;
- analiza el PDF con `pdf-lib`;
- rechaza acciones activas, archivos embebidos, formularios, multimedia y
  contenido animado.

Se reprodujo el falso positivo con archivos reales:

| Archivo | Resultado antes |
| --- | --- |
| PDF de Chromium con un enlace de verificación | Rechazado |
| CV real exportado por una aplicación de escritorio | Rechazado |
| `shared-mime-info-spec.pdf` del sistema | Rechazado |
| PDF de Chromium sin enlaces | Aceptado |
| PNG/JPG reales de capturas y documentos | Aceptados |

La causa confirmada fue la política de PDF:

- se rechazaba **cualquier** clave `/A` de anotación, incluso un enlace
  `URI` o un salto interno `GoTo`;
- se rechazaba **cualquier** `/OpenAction`, incluso un destino interno benigno
  de apertura de página.

Eso convertía PDFs legítimos con un enlace de comprobante o una vista inicial
en “archivos dañados”. No era un problema de `FormData`: el frontend envía el
archivo como cuerpo binario con `Content-Type` correcto y el backend lo recibe
como `express.raw`.

## 2. Solución aplicada

Se mantuvo la validación estricta y se corrigió el falso positivo:

- se admiten acciones de enlace **iniciadas por el usuario**:
  - `URI` (por ejemplo, verificación en el sitio del banco);
  - `GoTo` (navegación interna);
  - acciones nombradas benignas;
- `/OpenAction` solo se admite como destino interno (`PDFArray` o
  `PDFDict` con `S = GoTo`);
- se sigue rechazando:
  - JavaScript (`/JS`, `/JavaScript`);
  - `Launch`, `GoToR`, `GoToE`, `SubmitForm`, `ImportData`;
  - formularios `XFA`, acciones adicionales `/AA`;
  - archivos embebidos (`/EF`, `/EmbeddedFiles`, `/Filespec`);
  - multimedia (`RichMedia`, `Movie`, `Sound`, `Screen`, `3D`);
  - PDFs con más de 100 páginas;
  - APNG y contenido animado;
  - archivos truncados, firmas MIME incompatibles o imágenes que no decodifican.
- no se desactivaron límites de tamaño, autorización, IDOR, almacenamiento
  privado ni revisión documental.

### Mensajes diferenciados

El worker devuelve un motivo seguro y el backend responde con códigos
distintos:

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `ARCHIVO_VACIO` | 400 | Seleccioná un archivo con contenido. |
| `ARCHIVO_DEMASIADO_GRANDE` | 413 | El comprobante debe pesar hasta 5 MB. |
| `TIPO_NO_PERMITIDO` | 415 | Seleccioná un archivo PDF, JPG o PNG. |
| `ARCHIVO_DANADO` | 422 | El archivo está dañado o incompleto. Probá con otro archivo. |
| `TIPO_INCOMPATIBLE` | 422 | El archivo no coincide con el formato declarado. Verificá que sea PDF, JPG o PNG. |
| `CONTENIDO_NO_PERMITIDO` | 422 | El archivo contiene elementos activos o incrustados no permitidos. Probá con un PDF o una imagen simple. |
| `COMPROBANTES_NO_DISPONIBLES` | 503 | No se pudo procesar el comprobante. Reintentá en unos instantes. |

El frontend conserva `CONTENIDO_INVALIDO` como compatibilidad, pero muestra los
nuevos mensajes cuando el backend los devuelve.

## 3. Archivos modificados

- `backend/src/services/receipts/receipt-file.worker.ts`
- `backend/src/services/receipts/receipt-storage.ts`
- `frontend/src/components/PaymentReceipts.vue`
- `backend/test/payment-receipts.test.cjs`
- `frontend/test/payment-receipts.test.cjs`
- `frontend/e2e/account/payment-receipts.real.spec.ts`
- `backend/test/fixtures/receipts/comprobante-transferencia.pdf`
- `backend/test/fixtures/receipts/comprobante-transferencia.png`
- `backend/test/fixtures/receipts/comprobante-transferencia.jpg`

Los tres fixtures fueron generados con Chromium real. El PDF incluye un enlace
`URI` benigno; el JPG y el PNG son capturas reales del mismo comprobante.

## 4. Pruebas ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm --prefix backend run build` | Correcto |
| `npm --prefix backend run type-check` | Correcto |
| `npm --prefix backend run test:receipts:isolated` | 10/10 correctas |
| `node --test frontend/test/payment-receipts.test.cjs` | 7/7 correctas |
| `node backend/test/helpers/run-e2e.cjs --receipts` | 10/10 correctas |
| Validación directa de PDFs reales del sistema y del repositorio | Aceptados |
| Validación de 76 imágenes reales del repositorio | 76/76 aceptadas |

La suite MariaDB nueva comprueba:

- carga y descarga de PDF con enlace benigno;
- carga de PNG y JPG reales;
- rechazo de PDF suplantado por PNG (`TIPO_INCOMPATIBLE`);
- rechazo de PDF truncado (`ARCHIVO_DANADO`);
- rechazo de `OpenAction URI` y JavaScript (`CONTENIDO_NO_PERMITIDO`);
- rechazo de JPG truncado;
- archivo vacío, tamaño excesivo y MIME no permitido;
- ausencia de cambios en pedidos, cuentas, pagos, movimientos e imputaciones.

La E2E de comprobantes usa el PDF real con enlace para un cliente PARTICULAR y
un JPG real para una EMPRESA, verifica descarga privada, revisión ADMIN y
persistencia. También comprueba que un cliente ajeno recibe 404.

## 5. Reproducción manual

```bash
npm --prefix backend run build
node backend/test/helpers/run-e2e.cjs --receipts
```

Recorrido manual en el entorno aislado:

1. Iniciar sesión como `cliente@e2e.test`.
2. Abrir Mi Cuenta → Pedidos → detalle de un pedido.
3. Adjuntar `backend/test/fixtures/receipts/comprobante-transferencia.pdf`.
4. Confirmar que aparece “Comprobante recibido” y “Pendiente de revisión”.
5. Descargar el comprobante y verificar que el archivo coincide.
6. Como EMPRESA, subir el JPG real desde Cuenta corriente.
7. Como ADMIN, abrir Comprobantes de pago, descargar y aprobar documentalmente.
8. Verificar que la aprobación no cambia saldo, movimientos ni pagos.

## 6. Riesgo residual y límites

- Un enlace `URI` puede dirigir a un sitio externo. Se admite porque es una
  acción iniciada por el usuario y no ejecuta código; el archivo se sirve como
  descarga con `Content-Disposition: attachment`, CSP sandbox y `nosniff`.
- No se admite ninguna acción automática al abrir el documento salvo un destino
  interno de página.
- Los PDFs cifrados o con contraseña siguen considerándose no válidos para este
  flujo.
- No se modificaron reglas de acreditación, pagos, saldos ni comprobantes ya
  persistidos.
