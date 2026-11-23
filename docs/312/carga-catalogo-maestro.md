# #312 · Carga del catálogo maestro en MariaDB

El comando importa los 100 SKU de [`catalogo-maestro.csv`](../309/catalogo-maestro.csv) mediante la conexión del backend. Ejecutalo sobre una instalación normal preparada según el [README de base de datos](../../database/README.md), con las migraciones vigentes, incluida la auditoría FER-17. El comando no instala el esquema ni requiere datos de ejemplo.

Usá una credencial operativa con permiso `TRIGGER` sobre `PRODUCTO` y `FER17_PRECIO_EVENTO` para que MariaDB exponga la definición real de los triggers. El importador exige el inventario FER-17 completo: las tablas `FER17_PRECIO_EVENTO` y `PRECIO_USD_EVIDENCIA` con sus columnas y los cuatro triggers (`fer17_producto_alta_evento`, `fer17_producto_precio_evento`, `fer17_precio_evento_no_update`, `fer17_precio_evento_no_delete`) con sus tablas, momentos y operaciones. Antes de insertar compara cada definición contra la migración versionada y aborta si falta, difiere o no está visible.

Antes de cargar, creá o verificá en ADMIN estas categorías: **Construcción y consumibles**, **Electricidad e iluminación**, **Fijaciones**, **Herramientas**, **Neumática**, **Protección personal**, **Ropa y calzado de trabajo** y **Señalización y balizamiento**. Cada nombre debe corresponder a una sola categoría activa según la comparación de MariaDB. Si hay un nombre ausente, inactivo o ambiguo, resolvelo en ADMIN antes de reintentar. El comando no modifica categorías.

Desde `backend/`, con la configuración habitual del backend y después de instalar sus dependencias:

```sh
npm run build
npm run catalogo:importar-maestro -- --confirmar-destino HOST:PUERTO/BASE
```

Reemplazá `HOST:PUERTO/BASE` por los valores de `DB_HOST:DB_PORT/DB_NAME` efectivos. El comando rechaza un destino distinto antes de conectarse.

### Guarda DEMO

Antes de cualquier escritura, y otra vez dentro de la transacción, el importador identifica el destino con `SELECT DATABASE()`, `@@hostname`, `USER()` y `CURRENT_USER()`. Aborta con código distinto de cero sin modificar registros si:

- la base empieza con `ferre_demo_` o `e2e_test_`;
- el hostname empieza con `demo286-`;
- el usuario de conexión es `demo286`;
- existe la tabla `DEMO286_IDENTIDAD`;
- hay cuentas con `CUENTA_CORRIENTE.origen_datos = 'DEMO'`, evidencias con `PRECIO_USD_EVIDENCIA.sintetica = 1`, pedidos con `estado` o `modalidad_pago` que empiecen con `DEMO_`, o más de 100 SKU con prefijo `FP-DEMO-`.

La guarda valida primero la presencia de cada tabla y columna que necesita consultar. Si no puede verificarlas, rechaza por defecto: una tabla o columna ausente nunca se interpreta como autorización. `--confirmar-destino` sigue siendo obligatorio y no desactiva estas comprobaciones.

### Serialización y concurrencia

Dos importadores sobre la misma base se serializan con un bloqueo cooperativo `GET_LOCK`, con nombre derivado de la base y espera acotada (30 segundos por defecto; `MASTER_CATALOG_LOCK_TIMEOUT_SECONDS` admite 1 a 300). El bloqueo se adquiere antes de abrir la transacción, se mantiene hasta después del `COMMIT` y se libera explícitamente en el mismo cierre, incluso ante errores. No reemplaza los locks de InnoDB ni protege frente a escritores externos que no usan el mismo bloqueo: esos conflictos siguen resolviéndose con rollback y el manejo seguro de errores existente.

- **Altas:** conservan el SKU, el nombre propuesto, la descripción pública limpia (`descripcion_propuesta`, sin concatenar la variante, la ficha ni la presentación originales), la categoría y el stock por presentación. Se crean inactivas, con el `precio_referencia_usd` del maestro, sin descuento especial ni imagen. La procedencia es representativa; la carga por sí sola no acredita ni publica el precio. El stock académico queda registrado para revisión antes de publicar.
- **SKU existentes:** se conservan completos, incluso si difieren de la ficha de #309. La salida JSON enumera `insertados` y `conservados`; en los conservados aparecen tanto el SKU del CSV como el código almacenado. MariaDB determina si dos códigos son equivalentes usando la misma comparación que protege el índice único.
- **Auditoría:** los triggers FER-17 registran el evento normal `ALTA` con el `precio_referencia_usd` cargado como `precio_nuevo`. La carga inicial no genera evidencia ni publica el precio; para acreditar y publicar las referencias versionadas en una base operativa se utiliza `--publicar --admin ID` (que registra `PRECIO_USD_EVIDENCIA` sintética y el evento `VERIFICACION`, además de `CAMBIO_PRECIO` con `id_admin` si un producto heredado tenía precio nulo). Las tareas #310 y #311 no son necesarias para cargar las fichas iniciales.
- **Reintentos:** la carga valida el CSV antes de conectarse y escribe las altas en una transacción. Si el proceso falla o la confirmación de MariaDB se pierde, volvé a ejecutar contra el mismo destino. La restricción única permite recuperar el lote conservando lo que ya esté confirmado.

Para reproducir las pruebas desde `backend/`:

```sh
npm run build
npm run test:catalogo-maestro
```

La prueba de integración requiere Docker. Crea su propia MariaDB 11.4 con credenciales efímeras, un puerto en loopback y un volumen dedicado. Aplica el esquema normal, arranca y reinicia la API, y comprueba la carga inicial, los reintentos, un fallo provocado a mitad de lote, la conservación de datos ajenos, la concurrencia serializada, el inventario FER-17 completo y el rechazo sin mutaciones de bases DEMO vacías, parciales y completas. Al finalizar elimina sus recursos y verifica que no queden contenedores ni volúmenes de la prueba.


## Publicación del catálogo de presentación (#313)

Después de cargar, asociar las 100 imágenes mediante el procedimiento de #310/#311 y revisar el plan, el modo explícito `--publicar --admin ID` completa la publicación. Requiere destino confirmado y ADMIN activo. Conserva stock, imágenes y datos ajenos; rechaza fichas/precios modificados en vez de sobrescribirlos. No inicia ni depende de la demo de 904 productos. Procedimiento, autorización de referencias y pruebas: [docs/313/README.md](../313/README.md).
