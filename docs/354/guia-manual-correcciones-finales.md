# Guía manual breve — correcciones finales #354

Esta guía cubre únicamente los cuatro bloques intervenidos. Usar un entorno
aislado con MariaDB descartable. No usar `ferrepatagonia_presentacion`,
`ferrepatagonia_dev` ni `ferrepatagonia_qa354`.

## Preparación

```bash
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend run build
npm --prefix frontend run build
```

Las E2E se inician con el ejecutor del repositorio:

```bash
node backend/test/helpers/run-e2e.cjs <specs>
```

## 1. Comprobantes a 1024 px

```bash
node backend/test/helpers/run-e2e.cjs --receipts
```

Recorrido manual:

1. Iniciar sesión como `admin@e2e.test`.
2. Abrir `Comprobantes de pago`.
3. Usar una ventana de 1024 × 900 con el menú lateral ADMIN visible.
4. Verificar un comprobante pendiente:
   - nombre, fecha, estado y referencia ocupan el ancho de la fila;
   - las acciones Descargar, Aprobar y Rechazar quedan debajo;
   - no hay desplazamiento horizontal global.
5. Repetir en 320, 360, 390, 768, 1024 y 1280 px.

Capturas: `docs/354/evidence/receipts-1024-before.png` y
`receipts-1024-after.png`.

## 2. Rechazo de comprobantes

```bash
npm --prefix backend run test:receipts:isolated
node --test frontend/test/payment-receipts.test.cjs
```

Si un archivo real sigue siendo rechazado:

1. Abrir DevTools → Network.
2. Adjuntar el archivo.
3. Anotar endpoint, HTTP, `code` del JSON y `data-error-code` del aviso.
4. Si `code = CONTENIDO_INVALIDO`, el backend desplegado está desactualizado:
   reconstruir y reiniciar el backend de esta rama.
5. Si `code` es `ARCHIVO_DANADO`, `TIPO_INCOMPATIBLE` o
   `CONTENIDO_NO_PERMITIDO`, guardar una muestra anonimizada o reproducida con
   la misma aplicación y adjuntarla al diagnóstico.

No subir comprobantes bancarios reales al repositorio.

## 3. Footer sin Área Empresas

```bash
node backend/test/helpers/run-e2e.cjs catalog/footer-access.real.spec.ts catalog/home-premium.spec.ts
```

Verificar:

1. El footer no muestra «Área empresas».
2. El footer muestra Inicio, catálogo, Ingresar y Crear cuenta.
3. «Ingresar» abre `/login`.
4. «Crear cuenta» abre `/registro`.
5. El encabezado conserva el acceso «Empresas» y el bloque de Home sigue
   ofreciendo ingreso y registro empresarial.

## 4. Cuenta corriente CLIENTE y ADMIN

```bash
node backend/test/helpers/run-e2e.cjs account/credit-experience.mock.spec.ts
node backend/test/helpers/run-e2e.cjs account/credit-end-to-end.real.spec.ts
node backend/test/helpers/run-e2e.cjs admin/credit-companies.real.spec.ts admin/accounts.real.spec.ts
node backend/test/helpers/run-e2e.cjs --fer19
```

### CLIENTE

1. Iniciar sesión con una empresa.
2. Abrir Mi Cuenta → Cuenta corriente.
3. Confirmar que la primera tarjeta responde:
   - situación actual;
   - próximo paso;
   - acción permitida.
4. Verificar el resumen: crédito disponible primero, utilizado, límite, saldo y
   plazo.
5. Confirmar que el indicador de utilización aparece solo con cobertura
   completa.
6. Probar los estados: empresa pendiente, aprobada sin crédito, solicitud
   pendiente, solicitud aprobada sin habilitación, cuenta elegible, compra
   bloqueada y cuenta inhabilitada.
7. Recorrer operaciones: comprar, declarar pago, adjuntar comprobante,
   vencimientos, movimientos e historial.
8. Repetir en 320, 360, 390, 768, 1024 y 1280 px.

### ADMIN

1. Iniciar sesión como administrador.
2. Abrir Cuentas corrientes.
3. Verificar cabecera, acceso a solicitudes pendientes, búsqueda por razón
   social/CUIT, filtros y paginación.
4. Abrir el detalle de una empresa y recorrer las cinco secciones.
5. Confirmar que aprobar, rechazar, habilitar, deshabilitar y modificar límite
   explican sus requisitos.
6. Confirmar que la pestaña Consulta contable conserva FER-19 y no duplica
   lecturas.
7. Repetir en 320, 360, 390, 768, 1024 y 1280 px.

## Cierre

D354-02 quedó resuelto: la causa era la resolución del worker en desarrollo. La
carga de PDF, JPG y PNG se verifica en desarrollo y producción con
`npm --prefix backend run test:receipt-worker`, además de la suite integral de
comprobantes. El resto de los bloques se considera PASS según las pruebas
registradas en `docs/354/etapa-4-correcciones-finales.md`.
