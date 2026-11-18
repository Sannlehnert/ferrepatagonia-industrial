# T-S7-07.1 — Reconciliación de carrito postcompra (#325)

## Alcance y diagnóstico

Validación realizada el 18/11/2026 desde `feature/325-cart-post-purchase`, con base en `develop` (`89735dedd5f10314b9cb4fdf78a419869c8effee`).

La implementación existente ya reconcilia el carrito tras una confirmación. No se reprodujo un defecto que requiera modificar código de producción. Esta entrega agrega cinco regresiones de integración entre los stores reales y registra la evidencia de los recorridos existentes con navegador y MariaDB descartable.

- Servidor: `executePendingAccountOrder` persiste pedido, cargo y consumo de ítems dentro de la misma transacción. La recuperación por clave no crea una nueva compra.
- Store de pedidos: `finishAttempt` reconcilia al recibir una confirmación. Una respuesta incierta conserva la clave; un rechazo comercial no vacía el carrito.
- Store de carrito: `reconciliarPedidoConfirmado` invalida los datos consumidos y consulta el estado persistente. Una lectura anterior no puede sobrescribir el resultado nuevo. Si hay una escritura pendiente, deja que termine y consulte su resultado.
- Interfaz: muestra los ítems del store y permite volver a consultar si falla la lectura posterior a una compra ya confirmada.

La entrega no implementa la reconsulta de elegibilidad ni su feedback de la #326. Las pruebas usan el checkout vigente por cuenta corriente; no acreditan el futuro checkout normal por transferencia de las #322–#324.

## Cobertura de aceptación

| Criterio | Evidencia |
| --- | --- |
| Compra confirmada deja carrito consistente con backend | Regresiones nuevas de confirmación, lectura tardía y fallo de recarga; E2E H08 compara ítems, stock, pedidos, cargos e intentos mediante SQL. |
| Rechazo preserva ítems | Regresión nueva de rechazo y E2E de crédito insuficiente; se conservan los ítems y no se agrega otro pedido/cargo. |
| Recarga y reintentos sin duplicaciones | Regresión nueva de doble envío y respuesta perdida; E2E de recuperación a 360/1280 px, H06 y H07. |
| Recuperar una compra anterior respeta los ítems agregados después | Regresión nueva con recarga de sesión y carrito nuevo; la recuperación consulta el servidor, sin enviar escrituras de vaciado. |
| Segunda compra independiente | E2E H01/H02 y H08: nueva clave y un pedido/cargo por cada compra confirmada. |

Los tests nuevos están en `frontend/test/cartPostPurchase.test.cjs`: conectan `cart` y `accountOrder` de producción, sustituyendo únicamente transporte, almacenamiento y avisos externos. No prueban por sí solos las transacciones SQL; esa evidencia corresponde a los E2E reales.

## Reproducción y resultados

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

Pendientes para el cierre de la tarea: publicación por el responsable de la rama, CI del HEAD publicado y revisión técnica independiente de Zahir. La task no requiere validación UX/UI según su descripción.
