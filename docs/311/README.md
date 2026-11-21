# #311 — Imágenes de los SKU 51–100

## Entrega preparada

Los 50 SKU del segundo lote tienen un recurso local asociado: **17 fotografías y 33 ilustraciones**. Se reutilizan 11 fotografías existentes y se incorporan seis fotografías y 30 ilustraciones nuevas; los cuatro carteles comparten una ilustración cuya leyenda coincide. Los primeros 50 SKU conservan sus asociaciones y archivos byte a byte. El maestro de #309 queda con **100/100 SKU con fuente de imagen**.

Las ilustraciones siguen el criterio de #310 acordado para los casos sin fotografía adecuada. Son esquemas propios por tipo de producto, con el aviso visible «IMAGEN ILUSTRATIVA / No es la variante exacta». No acreditan dimensiones, materiales, talles, certificaciones ni homologación. No se incorporaron fotos candidatas con permiso pendiente. La mascarilla del SKU 81 se reemplazó por una ilustración propia para no depender de la declaración de dominio público limitada a Estados Unidos de la candidata anterior.

## Correspondencia y procedencia

La [matriz de los 50 SKU](imagenes-51-100.csv) identifica número, SKU, nombre canónico, tipo, recurso local, autor, fuente, licencia, límites visuales y SHA-256. `url_imagen` apunta al recurso público local; `archivo_candidato` conserva el nombre del archivo elegido. `url_candidata` y `fuente_candidata` conservan trazabilidad del relevamiento y **no son instrucciones de publicación**. El [relevamiento anterior](evidence/relevamiento-anterior.csv) es un antecedente, no el estado vigente de cobertura.

El registro operativo está en [image-sources.csv](../../data/demo-catalog/image-sources.csv), con créditos por archivo en [creditos.txt](../../frontend/public/demo-catalog/creditos.txt). Las seis fotografías añadidas proceden de Wikimedia Commons: E27 y mecha de mampostería bajo CC BY-SA; llave combinada bajo CC BY; mecha de madera y arandela Grower con declaración de dominio público de su autor; mameluco bajo CC BY-SA. Las fichas, versiones de licencia, autores y adaptaciones se consignan individualmente. Se conserva la atribución y se documenta la conversión a WebP, sin recortar ni ampliar por encima del tamaño descargado.

[Fuentes verificadas](evidence/fuentes-verificadas.json) registra la obtención y huellas de las seis fotos. Cuatro descargas originales respondieron HTTP 429 el 20/11/2026: se usaron copias locales del relevamiento previo y se volvieron a consultar las fichas de licencia. Las otras dos descargas respondieron HTTP 200. No se presenta esa limitación como una descarga actual exitosa; el catálogo sirve los WebP locales.

Las observaciones explicitan cuando una unidad representa un pack o no se puede acreditar tamaño, potencia, talla o marca. La llave combinada permite reconocer el marcado de 10 mm. Las ilustraciones distinguen caja de embutir/superficie, mascarilla copa/plana, prefiltro/retenedor y camisa/campera. No se alteran datos comerciales para ajustarlos a una imagen.

## Evidencia visual

- [SKU 51–60](evidence/lamina-51-60.webp)
- [SKU 61–70](evidence/lamina-61-70.webp)
- [SKU 71–80](evidence/lamina-71-80.webp)
- [SKU 81–90](evidence/lamina-81-90.webp)
- [SKU 91–100](evidence/lamina-91-100.webp)

Las láminas muestran los 50 recursos junto a su nombre canónico y tipo. [Recursos locales](evidence/recursos-locales.json) registra decodificación completa, dimensiones, tamaño y huella. [Primeros 50 preservados](evidence/primeros-50-preservados.json) contiene las huellas de #310 tomadas sobre `14abaa4`; la regresión comprueba que no cambian.

El generador vectorial nuevo es [ilustraciones-311.cjs](../../data/demo-catalog/ilustraciones-311.cjs), integrado al generador compartido. El [manifiesto](../../frontend/public/demo-catalog/ilustraciones-manifest.json) verifica cada WebP contra el SVG y la leyenda obligatoria. La clasificación en frontend incluye los nuevos SKU para conservar el aviso accesible cuando ADMIN guarda la imagen con nombre UUID.

## Verificación reproducible

Desde la raíz del proyecto:

```sh
node --test data/demo-catalog/generar.test.cjs
node data/demo-catalog/cobertura-visual.cjs
```

Prueba completa con build de producción en PowerShell:

```powershell
$env:E2E_PRODUCTION_BUILD = '1'
node backend/test/helpers/run-e2e.cjs --demo-catalog
```

El helper utiliza MariaDB descartable y limpia su contenedor al terminar. Primero importa el maestro de 100 SKU y sube las imágenes mediante ADMIN. Luego verifica el fixture de 904 SKU: las 221 asociaciones disponibles, bytes publicados por HTTP, catálogo y detalle en Chromium a 360 px, avisos ilustrativos, respuesta sin imagen, conservación al repetir la asociación y escenarios comerciales existentes. Los informes se generan en `frontend/test-results/demo-catalog/`; las capturas `detalle-311-*.png` muestran ejemplos del lote nuevo.

Resultado del 20/11/2026: **17/17 pruebas del catálogo, 274/274 pruebas frontend, builds backend/frontend y type-check aprobados**. La prueba completa de producción pasó en 3,9 minutos y confirmó la limpieza del contenedor. [Validación](evidence/validacion.json) · [50 SKU por HTTP](evidence/catalogo-51-100-http.json) · [100 asociaciones ADMIN](evidence/catalogo-maestro-100.json). El [informe general](../../data/demo-catalog/catalog-validation.json) contiene la evidencia HTTP real de esta ejecución, sin registros provisionales. No se ejecutan migraciones ni cargas sobre la base de desarrollo personal.

## Alcance y revisión pendiente

La cobertura completa corresponde al **maestro de 100 SKU**. El fixture ampliado de 904 contiene 221 asociaciones y mantiene 683 SKU sin imagen; esos SKU adicionales no forman parte de #311. Los informes históricos de #310 corresponden a su versión anterior y no se reescriben como si hubieran verificado este lote.

La entrega queda preparada para comprobación visual manual, revisión técnica de Zahir y validación UX/UI de Lucci. El cierre requiere las revisiones y el CI del commit publicado. No sustituye la auditoría integral de catálogo/persistencia de #313 ni acredita un despliegue compartido. No se modifican pedidos, pagos, crédito ni controles ADMIN.

## Ajustes de revisión UX/UI · 21/11/2026

A partir de la devolución de Lucci en PR #124, se separó el recuadro de imagen del aviso ilustrativo en Home. La proporción 1.7 y el recorte se aplican únicamente a la imagen; el aviso ocupa su propio espacio debajo. Se mantienen el vínculo aria-describedby, el retiro del aviso ante imagen fallida y las ilustraciones entregadas. No se convierte el componente completo a Tailwind ni se modifican estilos globales.

Se ampliaron a un mínimo de 44 × 44 px los enlaces de breadcrumbs de catálogo y ficha. Las fuentes de las ilustraciones propias de #311 apuntan a la ruta de develop que quedará disponible al integrar el PR, conservando coincidencia exacta entre registro operativo, matriz del lote y créditos públicos. No cambian archivos de imagen, asociaciones, autores ni licencias.

La regresión reprodujo 0 px de contenido útil en la ilustración de Home a 360 px antes del ajuste. Tres escenarios a 360/768/1280 px comprueban contenido visible, misma altura del recuadro que la foto contigua, aviso debajo y vinculado, retiro ante 404, ausencia de desborde horizontal y áreas táctiles de breadcrumbs. Usan datos de API reales con una respuesta controlada para colocar una ilustración del lote junto a una fotografía. Las capturas home-ilustracion-*.png quedan en frontend/test-results/production y no se versionan.

Validación sobre la rama integrada con develop (merge local dba5a8d): 17/17 pruebas del catálogo y cobertura visual aprobadas; 291/291 pruebas frontend, builds backend/frontend y TypeScript aprobados; 28/28 E2E de Home, ficha y carga/reemplazo de imágenes aprobados con build de producción. Capturas de los tres tamaños revisadas; limpieza del contenedor y datos tmpfs confirmada.

Se conservan como limitaciones aceptadas para seguimiento posterior S7-311-01 (clasificación ilustrativa por SKU ante sustituciones futuras) y S7-311-02 (validación UUID preexistente del backend), según la devolución de Lucci. No se modifican esos mecanismos en esta corrección. Pendientes publicación, CI del nuevo HEAD y revalidación UX/UI para la aprobación final.
