# #312 · Carga del catálogo maestro en MariaDB

El comando importa los 100 SKU de [`catalogo-maestro.csv`](../309/catalogo-maestro.csv) mediante la conexión del backend. Ejecutalo sobre una instalación normal preparada según el [README de base de datos](../../database/README.md), con las migraciones vigentes, incluida la auditoría FER-17. El comando no instala el esquema ni requiere datos de ejemplo.

Antes de cargar, creá o verificá en ADMIN estas categorías: **Construcción y consumibles**, **Electricidad e iluminación**, **Fijaciones**, **Herramientas**, **Neumática**, **Protección personal**, **Ropa y calzado de trabajo** y **Señalización y balizamiento**. Cada nombre debe corresponder a una sola categoría activa según la comparación de MariaDB. Si hay un nombre ausente, inactivo o ambiguo, resolvelo en ADMIN antes de reintentar. El comando no modifica categorías.

Desde `backend/`, con la configuración habitual del backend y después de instalar sus dependencias:

```sh
npm run build
npm run catalogo:importar-maestro -- --confirmar-destino HOST:PUERTO/BASE
```

Reemplazá `HOST:PUERTO/BASE` por los valores de `DB_HOST:DB_PORT/DB_NAME` efectivos. El comando rechaza un destino distinto antes de conectarse.

- **Altas:** conservan el SKU, el nombre propuesto, la descripción junto con la variante y ficha originales, la presentación, la categoría y el stock por presentación. Se crean inactivas, con precio, descuento e imagen nulos. El stock académico queda registrado para revisión antes de publicar.
- **SKU existentes:** se conservan completos, incluso si difieren de la ficha de #309. La salida JSON enumera `insertados` y `conservados`; en los conservados aparecen tanto el SKU del CSV como el código almacenado. MariaDB determina si dos códigos son equivalentes usando la misma comparación que protege el índice único.
- **Auditoría:** los triggers FER-17 siguen registrando el evento normal de alta con importe nulo. El comando no genera evidencia ni inicia una verificación. Las tareas #310 y #311 no son necesarias para cargar las fichas.
- **Reintentos:** la carga valida el CSV antes de conectarse y escribe las altas en una transacción. Si el proceso falla o la confirmación de MariaDB se pierde, volvé a ejecutar contra el mismo destino. La restricción única permite recuperar el lote conservando lo que ya esté confirmado.

Para reproducir las pruebas desde `backend/`:

```sh
npm run build
npm run test:catalogo-maestro
```

La prueba de integración requiere Docker. Crea su propia MariaDB 11.4 con credenciales efímeras, un puerto en loopback y un volumen dedicado. Aplica el esquema normal, arranca y reinicia la API, y comprueba la carga inicial, los reintentos, un fallo provocado a mitad de lote y la conservación de datos ajenos. Al finalizar elimina sus recursos y verifica que no queden contenedores ni volúmenes de la prueba.
