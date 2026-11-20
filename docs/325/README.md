# T-S7-07.1 — Reconciliación de carrito postcompra (#325)

## Alcance y diagnóstico

Validación realizada el 18/11/2026 desde `feature/325-cart-post-purchase`, con base en `develop` (`89735dedd5f10314b9cb4fdf78a419869c8effee`).

La implementación existente ya reconcilia el carrito tras una confirmación. No se reprodujo un defecto que requiera modificar código de producción. La entrega inicial agregó cinco regresiones de integración entre los stores reales y registra la evidencia de los recorridos existentes con navegador y MariaDB descartable.

- Servidor: `executePendingAccountOrder` persiste pedido, cargo y consumo de ítems dentro de la misma transacción. La recuperación por clave no crea una nueva compra.
- Store de pedidos: `finishAttempt` reconcilia al recibir una confirmación. Una respuesta incierta conserva la clave; un rechazo comercial no vacía el carrito.
- Store de carrito: `reconciliarPedidoConfirmado` invalida los datos consumidos y consulta el estado persistente. Una lectura anterior no puede sobrescribir el resultado nuevo. Si hay una escritura pendiente, deja que termine y consulte su resultado.
- Interfaz: muestra los ítems del store y permite volver a consultar si falla la lectura posterior a una compra ya confirmada.

La entrega no implementa la reconsulta de elegibilidad ni su feedback de la #326. Las pruebas de esta task cubren el checkout por cuenta corriente. La API de transferencia de #322 ya está integrada, pero esta cobertura no certifica el recorrido de interfaz de #323/#324 ni amplía su alcance.

## Cobertura de aceptación

| Criterio | Evidencia |
| --- | --- |
| Compra confirmada deja carrito consistente con backend | Regresiones nuevas de confirmación, lectura tardía y fallo de recarga; E2E H08 compara ítems, stock, pedidos, cargos e intentos mediante SQL. |
| Rechazo preserva ítems | Regresión nueva de rechazo y E2E de crédito insuficiente; se conservan los ítems y no se agrega otro pedido/cargo. |
| Recarga y reintentos sin duplicaciones | Regresión nueva de doble envío y respuesta perdida; E2E de recuperación a 360/1280 px, H06 y H07. |
| Recuperar una compra anterior respeta los ítems agregados después | Regresión nueva con recarga de sesión y carrito nuevo; la recuperación consulta el servidor, sin enviar escrituras de vaciado. |
| Segunda compra independiente | E2E H01/H02 y H08: nueva clave y un pedido/cargo por cada compra confirmada. |

Los tests nuevos están en `frontend/test/cartPostPurchase.test.cjs`: conectan `cart` y `accountOrder` de producción, sustituyendo únicamente transporte, almacenamiento y avisos externos. No prueban por sí solos las transacciones SQL; esa evidencia corresponde a los E2E reales.

## Reproducción y resultados iniciales (18/11/2026)

Ejecutar desde la raíz del repositorio, con dependencias instaladas y Docker disponible:

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm test --prefix frontend
node.exe backend/test/helpers/run-e2e.cjs cart/account-order.mock.spec.ts cart/account-order.real.spec.ts cart/account-order.recovery.real.spec.ts
git diff --check
```

Resultados locales:

- Builds de backend y frontend, incluido TypeScript: aprobados.
- Pruebas del frontend: **238 aprobadas**, incluidas las **5 regresiones nuevas**.
- E2E seleccionados: **14 aprobados**, sin omitidos ni reintentos automáticos. Incluyen 8 casos con HTTP interceptado y 6 casos con backend real.
- MariaDB aislada: `e2e_test_59a61bc9facc4f448e1c1599f48c7c84`.
- Limpieza: el ejecutor confirmó eliminación del contenedor y datos en tmpfs.

Ejemplo verificado por H08: stock 5 → 3 al comprar dos unidades; ítems vacíos, un pedido de USD 20 y un cargo de USD 20. Repetir la clave no altera esas filas. Una segunda compra de una unidad usa otra clave, deja stock 2 y agrega exactamente un pedido/cargo de USD 10.

La entrega inicial se publicó en el PR #139. Zahir emitió APROBABLE CON OBSERVACIONES sobre a8ca41e: actualizar la rama, consultar si Santi esperaba otro escenario y reforzar la lectura obsoleta para no depender solo de la señal cancelada. La task no requiere validación UX/UI según su descripción.

## Refuerzo de la revisión técnica (20/11/2026)

La rama se actualizó mediante fast-forward a 6beb356 y contiene el develop obtenido en el fetch de Bruno (cero commits pendientes desde esa referencia al verificar). No se modifican stores, servicios ni reglas de negocio.

La regresión de lectura obsoleta se ejecuta en dos variantes: cancelación efectiva y cancelación sin efecto. La segunda inyecta un AbortController derivado cuyo abort() registra el intento sin cancelar su señal, únicamente en el runtime aislado del test; no altera el controlador global. Se confirma la compra, se aplica el carrito actualizado y después se libera la respuesta anterior con ítems consumidos. Esa lectura debe devolver false, conservar el carrito vacío y sincronizado, mantener loading=false y no generar otro POST.

Se mantienen las cinco regresiones anteriores y se agrega esa variante: seis casos en total. No se elimina la comprobación de cancelación real del caso original.

Como ensayo de sensibilidad externo al repositorio, se ejecutó el test contra una transformación en memoria del store que elimina solo active === controller de isCurrent(). Resultado esperado y observado: cinco casos pasan y falla exclusivamente la variante sin cancelación efectiva. Esto verifica que la nueva cobertura detecta la pérdida de la protección por identidad de petición; no es un defecto del código original ni un cambio incluido en el PR.

Santi confirmó el escenario adicional de escritura pendiente; se incorpora a continuación. Pendientes: publicar este refuerzo, CI del nuevo commit y confirmación técnica final de Zahir. La task no requiere validación UX/UI.

Validación local del refuerzo: seis regresiones focalizadas aprobadas; builds backend/frontend y TypeScript aprobados; 280/280 pruebas frontend aprobadas. Se reejecutaron los 14 E2E documentados: 14/14 aprobados (44 s), con comprobaciones SQL de stock, ítems, pedidos, cargos e intentos. Base temporal e2e_test_85c8d03313e44747afb1859a50073c48; limpieza del contenedor y datos tmpfs confirmada. git diff --check sin errores.

## Escritura pendiente solicitada por Santi

Se agregan dos regresiones de stores reales con transporte controlado: una adición del carrito se inicia y queda pendiente mientras se confirma la compra. La reconciliación invalida la vista consumida, conserva la operación y su señal sin cancelar, y no inicia un GET ni otra escritura hasta que aquella termina. El transporte modela una adición que el servidor aplica después del COMMIT: el estado final debe contener esa unidad posterior, sin reponer las dos consumidas.

Se cubren respuesta de escritura recibida y respuesta perdida después de aplicarse. En el segundo caso se conserva el error de operación, pero la lectura del servidor reconcilia el carrito correctamente. Ambas verifican un solo POST de compra, una sola mutación del carrito, un solo GET posterior, confirmación y comprobante conservados, intento persistido limpio y estados loading/operation/needsSync finales consistentes.

Estos dos escenarios son modelos deterministas de concurrencia entre stores y transporte; no se presentan como carreras SQL ni sustituyen la evidencia de los 14 E2E con base real ya registrada. No se alteran stores, endpoints ni reglas de negocio. La suite focalizada suma ocho casos.

Ensayo de sensibilidad externo: al retirar únicamente la guarda que espera la escritura pendiente (if (active && !reading) return), fallan exactamente las dos regresiones nuevas y pasan las otras seis. La transformación se hizo en memoria en un archivo temporal fuera del repositorio, sin modificar el store original.

Última validación de este agregado: ocho regresiones focalizadas y 282/282 pruebas frontend aprobadas; git diff --check sin errores. No se repitieron builds ni los 14 E2E después de agregar estos dos tests: su resultado aprobado previo sigue registrado sobre el mismo código de producción, que no cambió. La ampliación actual se limita al harness de prueba y esta documentación.
