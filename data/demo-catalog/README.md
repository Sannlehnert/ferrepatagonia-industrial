# #286 · Catálogo académico de Ferrepatagonia Industrial

El CSV contiene 904 SKU con precios en USD, stock y descuentos simulados. Las descripciones identifican el tipo de artículo y su variante. Para elegir productos de protección en una operación real se requiere la ficha del proveedor.

## Base y alcance

El PR #102 incorpora `develop` en `c0b8ac5`, que incluye #285 y #278. El flujo de subida ADMIN almacena las imágenes en `PRODUCT_IMAGE_STORAGE_DIR` y devuelve `/api/product-images/<uuid>.webp`. La prueba académica usa un directorio temporal y lo elimina junto con la base. [PR #101](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/101)

El entorno E2E habitual parte de 27 productos, de los cuales 25 son visibles. El perfil de #286 conserva las categorías y las listas de prueba, habilita una cuenta de empresa de prueba y comienza con 0 productos para que todas las filas visibles y las fotos de Home provengan de FER-16. Las categorías adicionales se crean mediante ADMIN en esa instalación y sus IDs se leen desde la API pública. Para pasar de 0 a más de 900 visibles hacen falta 901 filas. Se verificó la siguiente distribución.

| Categoría en la base descartable | ID | SKU |
| --- | ---: | ---: |
| Herramientas E2E | 1 | 145 |
| Fijaciones E2E | 2 | 73 |
| Neumática | 5 | 36 |
| Protección personal | 6 | 217 |
| Ropa y calzado de trabajo | 7 | 108 |
| Señalización y balizamiento | 8 | 109 |
| Electricidad e iluminación | 9 | 108 |
| Construcción y consumibles | 10 | 108 |

El generador declara 25 familias en [`variantes.cjs`](variantes.cjs). Usa atributos comerciales para el SKU, como tipo, medida, talle, color o presentación. El stock inicial es positivo en las 904 filas. Los descuentos especiales del 5% y del 15% permiten contrastar descuentos menores y mayores que el 10% de la lista de la empresa E2E.

## Repetir la carga descartable

Desde la raíz del repositorio, con Node compatible con los `engines` del proyecto, Docker activo y `mariadb:11.4` disponible:

```sh
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix frontend exec -- playwright install chromium
node --test data/demo-catalog/generar.test.cjs
E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs --demo-catalog
```

En PowerShell, fijá `$env:E2E_PRODUCTION_BUILD='1'` antes de ejecutar la última línea sin el prefijo de asignación. El ejecutor crea una MariaDB nueva en `tmpfs` con puerto de loopback, usa la API y el build real, y elimina el contenedor al terminar. Los informes del caso quedan en `frontend/test-results/demo-catalog/`. Los JSON versionados registran una ejecución local y no forman parte de la carga.

## Presentación local con datos persistentes

Desde la raíz de este checkout del PR #102, con Docker Desktop iniciado y los dos proyectos compilados, ejecutá en una terminal:

```powershell
node backend/test/helpers/run-demo286-local.cjs
```

Abrí [la tienda](http://localhost:5173/) cuando aparezca «Demo» en la terminal. La [salud de la API](http://localhost:3000/api/health) debe devolver `api: ok` y `database: ok`. Los puertos 5173 y 3000 deben estar libres antes de iniciar. Si está abierto el entorno de desarrollo, cerrá sus dos procesos de Node; no hace falta detener su MariaDB. Se puede usar `--puertos-ensayo` para probar sin interferir con el entorno de desarrollo (frontend 55173, API 53000).

La primera ejecución crea un contenedor y un volumen exclusivos, importa los 904 SKU mediante FER-16 y asocia las 132 fotos mediante #285. Comprueba precios, catálogo e imágenes con Chromium y deja la tienda abierta para usarla manualmente. Las siguientes ejecuciones vuelven a usar ese contenedor y sus archivos; no vuelven a importar ni alteran el stock, los pedidos o las cuentas existentes. Para ver solo la clave generada de las tres cuentas en PowerShell, ejecutá `(Get-Content -Raw ../.demo286-local/perfil.json | ConvertFrom-Json).accountPassword`. No compartas ni subas el archivo de perfil a Git.

| Rol | Usuario | Recorrido |
| --- | --- | --- |
| Particular | `cliente@e2e.test` | **Mis pedidos** → pedido de transferencia de prueba → **Comprobantes de pago** → adjuntar PDF, PNG o JPG ficticio. |
| Empresa aprobada | `empresa-cuenta@e2e.test` | Buscar `FP-DEMO-MAN-LLAVE-AJUSTABLE-150-MM` → **Agregar** → **Ver carrito completo** → **Cuenta corriente** → **Confirmar pedido a cuenta corriente**. Verificar el comprobante marcado como simulado y el historial en **Mis pedidos**. |
| ADMIN | `admin@e2e.test` | **Productos** → buscar por SKU y editar; **Comprobantes de pago** → revisar el comprobante. |

Para mostrar Socket.IO, dejá la ficha de la llave abierta en un segundo perfil de navegador autenticado con la cuenta empresa antes de confirmar. El stock baja una unidad en la ficha sin recargar. Usá datos ficticios también al registrar nuevos usuarios. Revisar un comprobante no acredita un pago.

El verificador opcional `node frontend/e2e/demo-catalog/verificar-local.cjs --ensayar` comprueba que la web apunta a la base académica y hace un ensayo con efectos persistentes: registra un usuario, confirma un pedido y carga y revisa un comprobante ficticio. Usalo en una instalación académica sin pedidos simulados previos. Si falla después de confirmar, `--continuar-comprobante` permite terminar la parte del comprobante sin repetir el pedido. Tras un ensayo completo, `--comprobar-reinicio` verifica por lectura la conservación de datos y archivos.

**Detener y volver a iniciar.** Presioná Enter en la terminal del lanzador para cerrar web y API. Ejecutá el mismo comando para reabrirlas. Si Docker estaba detenido, abrilo primero: el lanzador arranca el contenedor académico registrado y comprueba su identidad. La base vive en su volumen Docker y las fotos y comprobantes se guardan en `../.demo286-local`, fuera del árbol público. Conservá el directorio y el volumen juntos; no uses `docker compose down -v`, `docker volume prune` ni vuelvas a aplicar el esquema.

**Respaldo y recuperación.** Con web y API detenidas, copiá `../.demo286-local` completo a un lugar privado y tomá un volcado lógico del contenedor académico registrado en `perfil.json`. Ejemplo desde PowerShell 7.4 o posterior, con Docker en marcha, en un directorio privado de respaldo:

```powershell
$demoPerfil = Get-Content -Raw ../.demo286-local/perfil.json | ConvertFrom-Json
docker inspect --format '{{.Name}} {{.Config.Hostname}}' $demoPerfil.id
# Ambos nombres deben ser demo286- seguido del token de perfil.json.
docker exec $demoPerfil.id sh -c 'mariadb-dump --single-transaction -u "$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' > demo286.sql
if ($LASTEXITCODE -ne 0) { throw 'No usar ese respaldo: falló mariadb-dump.' }
```

Si se detiene el equipo o Docker, reiniciá el mismo contenedor y repetí el comando de inicio. Si falta un directorio, el volumen, o la carga inicial quedó a medias, el lanzador se detiene en lugar de reconstruir datos. Conservá el estado anterior y el respaldo. Una restauración desde SQL debe hacerse sobre otra instancia académica aislada, con un nuevo perfil e identidad validados por el equipo; no se admite redirigir el lanzador a una MariaDB arbitraria ni aplicar el volcado a desarrollo o a producción.

## Preparar el CSV y asociar fotos

El [CSV versionado](productos-ferrepatagonia-demo.csv) es el resultado reproducible para las categorías de la [base E2E](categorias-e2e.json). La carga oficial de #286 conserva la columna `imagen` vacía y asocia las fotos por SKU una vez importado el lote. Para preparar un CSV de otra instalación, obtené el JSON de `GET /api/categorias`. Si algún nombre difiere, prepará un objeto JSON que asocie el nombre de la tabla anterior con el nombre activo exacto en destino. Revisá la correspondencia de cada familia y evitá crear categorías duplicadas.

```sh
node data/demo-catalog/generar.cjs categorias-destino.json catalogo-destino.csv "" equivalencias.json
```

El archivo de equivalencias es opcional cuando coinciden los nombres. El generador exige una única categoría activa por nombre y crea un archivo nuevo. Después de importar, configurá `DEMO_ADMIN_EMAIL` y `DEMO_ADMIN_PASSWORD` en la sesión del operador. Ejecutá el comando primero sin `--aplicar` para revisar el plan y comprobar que los SKU y sus nombres coinciden con el catálogo de destino.

```sh
node data/demo-catalog/asociar-fotos.cjs "$ORIGEN"
node data/demo-catalog/asociar-fotos.cjs "$ORIGEN" --aplicar
```

`ORIGEN` es el origen HTTPS del frontend o `http://127.0.0.1:<puerto>` en la instalación local. El script obtiene los IDs actuales del listado ADMIN y sube los WebP por `PUT /api/admin/productos/:id/con-imagen` con `producto={}`. Conserva las fotos ya asociadas y permite repetir la carga después de un corte. Revisá las fotos preexistentes antes de darlas por verificadas. Ejecutá la asociación sin ediciones ADMIN concurrentes sobre los mismos SKU, porque el endpoint vigente no tiene escritura condicional por versión. La fuente y sus créditos se conservan una vez por archivo. #285 genera un UUID por asociación y elimina el archivo reemplazado, por lo que compartir una misma URL administrada entre productos requeriría cambiar el contrato de almacenamiento. [Registro de fuentes](image-sources.csv) · [Contrato de imágenes ADMIN](../../docs/api/admin-productos.md)

Para una instalación compartida se requiere la autorización expresa indicada en #286, identificar la base y verificar un respaldo reciente. Usá el importador ADMIN de CSV/XLSX y comprobá `validRowsCount`, `existingInDbCount`, duplicados y errores de fila en el preview. El tamaño del archivo debe ser inferior al límite de 5 MiB y el lote admite hasta 1.000 filas. Para una primera carga se esperan 904 filas elegibles. Guardá el `previewToken`, confirmá una vez y recuperá el resultado en `GET /api/admin/productos/importar/confirmaciones/:previewToken`. Si se pierde la respuesta, consultá ese estado con el mismo token y conciliá los SKU contra el destino antes de decidir cualquier reintento. Un nuevo preview del CSV ya cargado detecta los 904 SKU existentes y ofrece cero filas elegibles. Para actualizar las fotos de un SKU existente usá la edición ADMIN autorizada, ya que FER-16 omite los SKU preexistentes.

## Contrato del checkout académico

FER-16 guarda `precio_base_usd` como `PRODUCTO.precio`. En la prueba, FER-17 devolvió `BASE_NO_VERIFICADA` para las 904 filas antes de acreditar importes. El perfil descartable usa `PRECIO_USD_EVIDENCIA` con el precio exacto cotejado, un ADMIN del fixture, la marca `sintetica=1` y una referencia con la huella del CSV. Con esa evidencia FER-17 cotizó 904/904 SKU en USD, tanto en el canal público como con la lista empresarial. La auditoría coteja cada unitario, subtotal y total por lote. [Operación de evidencia FER-17](../../docs/operaciones-precios.md)

El servidor normal (`npm start`) arranca sin la capacidad académica. Solo se emite desde el servidor hijo por IPC de dos lanzadores locales: `--demo-catalog` verifica el contenedor descartable con `tmpfs`, y `run-demo286-local.cjs` verifica un contenedor distinto con volumen exclusivo e identidad SQL propia. Ambos requieren MariaDB 11.4, un puerto dinámico en loopback y credenciales aleatorias. La cotización y la escritura comprueban dentro de sus transacciones el nombre de la base y el servidor esperado; el modo persistente verifica también la marca SQL de esa instalación. La cuenta bloqueada debe tener `origen_datos=DEMO` y todas las líneas deben tener evidencia sintética explícita de #286. Las variables del despliegue normal y los datos de una petición carecen de un mecanismo para habilitar la capacidad. La demo persistente no se debe publicar en la red ni reutilizar con datos reales.

La compra usa la misma transacción de pedidos y mantiene los controles de usuario, empresa aprobada, cuenta y crédito, stock, cotización firmada e idempotencia. La cotización firma la marca `simulado`. La confirmación, recuperación, elegibilidad e historial exponen `simulado: true` en el caso académico. El precio personalizado y las líneas del carrito exponen `compraAcademica: true` cuando corresponde, y conservan la evidencia sintética. La referencia histórica del pedido usa `FER17-v1:ACADEMICO:SHA256:` y el detalle, el pedido y el cargo quedan marcados. ADMIN muestra esos pedidos como `DEMO` y en solo lectura. Las respuestas comerciales conservan sus contratos y el rechazo `PRECIO_SINTETICO`.

El perfil E2E elimina sus datos al terminar. El lanzador persistente conserva únicamente el catálogo, las cuentas y los datos académicos de esa presentación. La revisión independiente debe comprobar ambos puntos de activación, la verificación de identidad de la base, el tratamiento de la evidencia y las regresiones normales antes del merge.

## Evidencia y cobertura pendiente

Se verificaron **132 SKU con 19 archivos fotográficos**, publicados mediante #285 y decodificados anónimamente en catálogo y ficha a 360 px. Los primeros cuatro también se verificaron en Home. Quedan **772 SKU sin foto aprobada**, agrupados en **295 modelos o variantes visuales pendientes**. `node data/demo-catalog/cobertura-visual.cjs` reproduce ese inventario desde el CSV y el registro de fuentes. Las fotos compartidas representan el modelo sin escala o una unidad de un pack. Las potencias, colores, leyendas y formas que distinguen modelos requieren una coincidencia específica. La búsqueda descartó candidatos por discrepancias visuales y algunos originales devolvieron HTTP 429. [Inventario por grupo](visual-audit.json) · [Informe de catálogo](catalog-validation.json) · [Fuentes, autores y licencias](image-sources.csv)

Los 904 precios pasaron la auditoría de FER-17 en USD. La empresa descartable confirmó cinco pedidos de categorías distintas, con cinco cargos simulados, cero pagos y nueve unidades descontadas. El replay y la recuperación conservaron los mismos pedidos y cargos. Se rechazó la sobreventa al agregar al carrito y cuando cayó el stock tras cotizar. La compra por interfaz produjo eventos de stock y pedido en un segundo proceso Chromium. La ficha se reconcilió por REST al recibir el evento y al reconectar. [Informe de precios y compras](pricing-report.json)

Las cinco compras están comprobadas en MariaDB descartable. El despliegue compartido requiere una validación distinta y autorización expresa para cualquier carga sobre esa base.

Para la presentación del 11/11/2026 se confirmó que no hay un despliegue compartido. La instalación persistente local se validó en los puertos de la presentación: 904 SKU, 132 fotos, Home, paginación, búsqueda, filtro y ficha anónimos. En navegador se registró un particular y se probó el ingreso de particular, empresa y ADMIN. ADMIN modificó y restauró el stock por su API. La empresa confirmó un pedido simulado por USD 8,01, con un cargo simulado y cero pagos; la llave pasó de 24 a 23 unidades y la segunda sesión recibió los eventos de stock y pedido. El historial mostró el pedido. Sobre el pedido de transferencia de prueba del particular se cargó y descargó un PNG, se comprobó el rechazo de la descarga por otra cuenta y se marcó revisado como ADMIN.

Tras reiniciar web, API y el contenedor MariaDB, se comprobaron los 904 SKU, las 132 asociaciones, el stock de 23 unidades, el usuario registrado, el pedido y la descarga íntegra del comprobante revisado. Se generó un respaldo privado del SQL y de los archivos; no se ensayó la restauración desde ese respaldo. En la regresión aislada de pedidos pasaron 81 pruebas, incluido el rechazo `PRECIO_SINTETICO` en el servidor normal. Quedan pendientes las 772 fotos no aprobadas y la revisión independiente del lanzador persistente.
