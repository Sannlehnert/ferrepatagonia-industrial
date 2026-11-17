# #310 · Imágenes de los productos 1 al 50

Tarea T-S7-02.2 de la historia #288. El orden y los SKU provienen del catálogo maestro de la #309 (PR #122).

## Resultado

**12 de 50 SKU tienen imagen aprobada** y **38 quedan pendientes**. No se asoció ninguna foto cuando faltaba una coincidencia visual con el modelo y la variante. El criterio de «imagen en los 50 SKU» no está cumplido y requiere una decisión del equipo (ver «Opciones»).

Las fotos agregadas se registran en [`image-sources.csv`](../../data/demo-catalog/image-sources.csv) y en [`creditos.txt`](../../frontend/public/demo-catalog/creditos.txt). Cada foto se asocia solo a los SKU cuya variante coincide con lo que muestra: el disco de corte a 1 SKU (125 mm, porque la propia etiqueta del disco fotografiado indica «125 × 1 mm»; el modelo pasó a exigir una foto por medida), el borceguí a 9 talles (sin escala visible) y los dos cascos amarillos a 1 SKU cada uno. Con esto el registro pasa de 132 SKU y 19 archivos a **144 SKU y 23 archivos**; faltan **760 SKU**.

## Correcciones de la auditoría (PR #125, SHA 628e412)
- **Disco de corte:** la foto muestra un disco de 125 mm y se había reutilizado para nueve medidas. Ahora solo se asocia al SKU de 125 mm y `ABR-disco-metal` pasó al conjunto `separar` de [`cobertura-visual.cjs`](../../data/demo-catalog/cobertura-visual.cjs). El n.º 2 (100 mm) vuelve a pendiente.
- **Borceguí:** la imagen medía 960 × 1707 y se redimensionó a 540 × 960 (máximo de 960 px por lado). El crédito incluye la atribución que pide Commons: «© Victor Adrian / https://bestformyfeet.com».
- **Informe `catalog-validation.json`:** se regenera con la prueba real de catálogo para que `imagenes` y `conImagenVerificada` coincidan (144).

## Criterios aplicados
- Fuente: Wikimedia Commons, con licencia CC0, CC BY, CC BY-SA o dominio público registrada por archivo.
- La foto debe coincidir con el modelo y con lo que la variante hace visible (color, forma, leyenda, potencia). Una foto sin escala representa varias medidas de un mismo modelo.
- Formato: WebP de 960 px de lado máximo, de hasta 5 MiB.
- Se descartó una candidata si diferían la presentación, el color, el material o el modelo, aunque fuera del mismo tipo de producto.

## Matriz por SKU
| N.º | SKU | Producto | Estado de la imagen |
| ---: | --- | --- | --- |
| 1 | `FP-DEMO-ABR-DISCO-LIJA-100-MM` | Disco de lija con respaldo adhesivo · 100 mm | **Pendiente.** Sin foto con licencia libre que muestre un disco de lija con respaldo adhesivo. |
| 2 | `FP-DEMO-ABR-DISCO-METAL-100-MM` | Disco de corte para metal · 100 mm | **Pendiente.** La única candidata muestra un disco de 125 mm (lo indica su etiqueta); no representa 100 mm. |
| 3 | `FP-DEMO-ABR-LIJA-AGUA-GRANO-1000` | Hoja de lija al agua 230 × 280 mm · grano 1000 | **Pendiente.** El grano visible exige una foto por variante; la candidata no muestra el grano 1000. |
| 4 | `FP-DEMO-ABR-LIJA-MADERA-GRANO-100` | Hoja de lija para madera 230 × 280 mm · grano 100 | **Pendiente.** El grano visible exige una foto por variante; la candidata no muestra el grano 100. |
| 5 | `FP-DEMO-ADH-CINTA-DOBLE-12-MM` | Cinta de montaje doble faz · 12 mm | **Pendiente.** La candidata mezcla dos cintas distintas y no representa la de 12 mm. |
| 6 | `FP-DEMO-ADH-COLA-100-ML` | Cola vinílica para madera · 100 ml | **Pendiente.** La candidata es un envase de otra presentación; no es cola vinílica de 100 ml. |
| 7 | `FP-DEMO-ADH-CONTACTO-100-ML` | Adhesivo de contacto · 100 ml | **Pendiente.** La candidata es un tubo de 35 ml de otra marca; no coincide con 100 ml. |
| 8 | `FP-DEMO-ADH-SELLADOR-CAJA-DE-10-CARTUCHOS` | Sellador acrílico blanco · caja de 10 cartuchos | **Pendiente.** La candidata es un cartucho de silicona con pistola, no sellador acrílico en caja de 10. |
| 9 | `FP-DEMO-ALT-ARNES-TALLE-2XL-3XL-AZUL` | Arnés de cuerpo completo · talle 2XL/3XL azul | **Pendiente.** La única candidata muestra a una persona con casco y chaleco; no es el producto aislado. |
| 10 | `FP-DEMO-ALT-BOLSO-ARNES-10-L` | Bolso para guardar arnés · 10 L | **Pendiente.** Sin candidata con licencia libre. |
| 11 | `FP-DEMO-ALT-ETIQUETA-ARNES-PACK-DE-100-UNIDADES` | Etiqueta de identificación para inventario de arneses · paquete de 100 unidades | **Pendiente.** Sin candidata con licencia libre. |
| 12 | `FP-DEMO-ALT-PROTECTOR-CINTA-150-MM` | Funda para cinta de arnés · 150 mm | **Pendiente.** Sin candidata con licencia libre. |
| 13 | `FP-DEMO-AUD-TAPON-ALETAS-PACK-DE-100-UNIDADES` | Tapón auditivo con aletas y cordón · paquete de 100 unidades | Preexistente · `tapones-aletas-cordon.webp` · Bill Ebbesen · CC BY-SA 3.0 |
| 14 | `FP-DEMO-AUD-TAPON-ESPUMA-PACK-DE-100-UNIDADES` | Tapón auditivo de espuma sin cordón · paquete de 100 unidades | Preexistente · `tapones-espuma.webp` · Clemente · Dominio público por el autor |
| 15 | `FP-DEMO-AUD-OREJERA-AMARILLO` | Orejera de copa con diadema · amarillo | **Pendiente.** Las candidatas son un dibujo, un estante mixto o orejeras de otros colores; no hay una amarilla aislada. |
| 16 | `FP-DEMO-AUD-TAPON-CORDON-PACK-DE-100-UNIDADES` | Tapón auditivo de espuma con cordón · paquete de 100 unidades | **Pendiente.** La candidata muestra tapones sin cordón; el SKU lleva cordón. |
| 17 | `FP-DEMO-CAB-CABLE-AZUL-0-5-MM2` | Cable unipolar azul en rollo de 25 m · 0,5 mm² | **Pendiente.** Sin foto de cable unipolar azul de 25 m. |
| 18 | `FP-DEMO-CAB-CABLE-BIPOLAR-0-5-MM2` | Cable bipolar negro en rollo de 10 m · 0,5 mm² | **Pendiente.** Sin foto de cable bipolar negro de 10 m. |
| 19 | `FP-DEMO-CAB-CABLE-MARRON-0-5-MM2` | Cable unipolar marrón en rollo de 25 m · 0,5 mm² | **Pendiente.** Sin foto de cable unipolar marrón de 25 m. |
| 20 | `FP-DEMO-CAB-CABLE-NEGRO-0-5-MM2` | Cable unipolar negro en rollo de 25 m · 0,5 mm² | **Pendiente.** Sin foto de cable unipolar negro de 25 m. |
| 21 | `FP-DEMO-CAL-BOTIN-38-AR` | Botín de trabajo de cuero negro con puntera · 38 AR | Preexistente · `botin-trabajo-negro.webp` · Persmas24 · CC0 1.0 |
| 22 | `FP-DEMO-CAL-ZAPATO-38-AR` | Zapato de trabajo bajo con puntera · 38 AR | Preexistente · `zapato-trabajo-bajo.webp` · Liftarn · CC BY-SA 3.0 |
| 23 | `FP-DEMO-CAL-BORCEGUI-38-AR` | Borceguí de trabajo marrón con puntera · 38 AR | Agregada en #310 · `borcegui-marron.webp` · Best For My Feet · CC BY 3.0 |
| 24 | `FP-DEMO-CAL-BOTA-PVC-38-AR` | Bota de trabajo de PVC con puntera · 38 AR | **Pendiente.** La candidata es una bota de PVC en la que no se ve la puntera. |
| 25 | `FP-DEMO-CAS-CASCO-BLANCO-BARBOQUEJO` | Casco industrial blanco con barboquejo | Preexistente · `casco-blanco-barboquejo.webp` · Miya · CC BY-SA 4.0 |
| 26 | `FP-DEMO-CAS-CASCO-ALA-AMARILLO` | Casco industrial de ala completa · amarillo | Agregada en #310 · `casco-ala-completa-amarillo.webp` · רנדום · CC BY-SA 3.0 |
| 27 | `FP-DEMO-CAS-CASCO-CORTO-AMARILLO` | Casco industrial de visera corta · amarillo | Agregada en #310 · `casco-visera-corta-amarillo.webp` · Batholith · Dominio público |
| 28 | `FP-DEMO-CAS-CASCO-RANURAS-AMARILLO` | Casco industrial con ranuras laterales · amarillo | **Pendiente.** Sin candidata de casco amarillo con ranuras laterales. |
| 29 | `FP-DEMO-CHA-CHALECO-AMARILLO-TALLE-2XL` | Chaleco reflectivo amarillo con cierre · talle 2XL | **Pendiente.** La candidata no muestra el cierre. |
| 30 | `FP-DEMO-CHA-CHALECO-BOLSILLO-TALLE-2XL` | Chaleco reflectivo amarillo con bolsillos · talle 2XL | **Pendiente.** Sin candidata con bolsillos. |
| 31 | `FP-DEMO-CHA-CHALECO-MALLA-TALLE-2XL` | Chaleco reflectivo naranja de malla · talle 2XL | **Pendiente.** Sin candidata de chaleco naranja de malla. |
| 32 | `FP-DEMO-CHA-CHALECO-NARANJA-TALLE-2XL` | Chaleco reflectivo naranja con cierre · talle 2XL | **Pendiente.** Sin candidata de chaleco naranja con cierre. |
| 33 | `FP-DEMO-CIN-CINTA-DELIMITAR-AMARILLA` | Cinta para delimitar sectores · amarilla | **Pendiente.** Las candidatas llevan leyendas o colores distintos de la cinta amarilla lisa. |
| 34 | `FP-DEMO-CIN-CINTA-PISO-AMARILLA` | Cinta adhesiva para demarcación de pisos · amarilla | **Pendiente.** Las candidatas son demarcaciones aplicadas en piso, no el rollo de cinta. |
| 35 | `FP-DEMO-CIN-CINTA-TEXTO-100-M` | Cinta impresa de delimitación amarilla y negra · 100 m | **Pendiente.** La candidata es amarilla con texto, no con franjas amarillas y negras. |
| 36 | `FP-DEMO-CIN-CINTA-VISUAL-12-MM` | Cinta adhesiva reflectiva de señalización · 12 mm | **Pendiente.** La candidata muestra cintas aplicadas en una barrera, no la cinta de 12 mm. |
| 37 | `FP-DEMO-CON-CONO-NARANJA-18-CM` | Cono de señalización naranja · 18 cm | Preexistente · `cono-naranja-30-cm.webp` · Michael Malak · Dominio público por el autor |
| 38 | `FP-DEMO-CON-CONO-NARANJA-30-CM` | Cono de señalización naranja de 30 cm | Preexistente · `cono-naranja-30-cm.webp` · Michael Malak · Dominio público por el autor |
| 39 | `FP-DEMO-CON-BARRA-CONOS-0-6-M` | Barra de enlace para conos · 0,6 m | **Pendiente.** Sin candidata con licencia libre. |
| 40 | `FP-DEMO-CON-CADENA-100-M` | Cadena de balizamiento plástica · 100 m | **Pendiente.** Sin candidata con licencia libre. |
| 41 | `FP-DEMO-ELE-CALADORA-500-W` | Sierra caladora con cable · 500 W | Preexistente · `caladora-500w.webp` · Tsungam · CC BY-SA 4.0 |
| 42 | `FP-DEMO-ELE-AMOLADORA-1000-W` | Amoladora angular con cable · 1000 W | **Pendiente.** La potencia (1000 W) no es verificable visualmente; la candidata no la declara. |
| 43 | `FP-DEMO-ELE-LIJADORA-150-W` | Lijadora orbital con cable · 150 W | **Pendiente.** La potencia (150 W) no es verificable visualmente; la candidata no la declara. |
| 44 | `FP-DEMO-ELE-TALADRO-500-W` | Taladro percutor con cable · 500 W | **Pendiente.** La potencia (500 W) no es verificable visualmente; la candidata es un taladro de otro tipo. |
| 45 | `FP-DEMO-FIJ-TARUGO-NYLON-10-MM` | Tarugo de nailon · 10 mm | Preexistente · `tarugo-nailon.webp` · Hungryjabberwock · Dominio público |
| 46 | `FP-DEMO-FIJ-ABRAZADERA-12-MM` | Abrazadera de montaje para caño · 12 mm | **Pendiente.** Las candidatas son abrazaderas de carpintería, no de montaje para caño. |
| 47 | `FP-DEMO-FIJ-ANCLAJE-M10` | Anclaje metálico de expansión · M10 | **Pendiente.** La candidata es un diagrama, no una fotografía del anclaje. |
| 48 | `FP-DEMO-FIJ-VARILLA-M10` | Varilla roscada zincada de 1 m · M10 | **Pendiente.** La candidata (Threaded rods of different sizes, CC BY-SA 4.0) se pudo descargar al reintentar, pero muestra varillas de distintas medidas mezcladas en un exhibidor; no permite afirmar que sea M10 de 1 m. Se descartó para no crear una asociación engañosa. |
| 49 | `FP-DEMO-GUA-GUANTE-ALGODON-TALLE-2XL` | Guante de algodón tejido · talle 2XL | **Pendiente.** Sin candidata de guante tejido de algodón. |
| 50 | `FP-DEMO-GUA-GUANTE-DESCARNE-TALLE-2XL` | Guante de cuero descarne de puño largo · talle 2XL | **Pendiente.** Las candidatas tienen puño corto; el SKU es de puño largo. |

## Opciones para los 38 pendientes (alcance parcial pendiente de aprobación formal)
1. Pedir a Santiago o Lucci que tomen o aporten fotografías propias (con licencia del equipo) para los SKU sin candidata. Es la única vía que cubre variantes con color, potencia o leyenda específicos.
2. Aceptar fotos genéricas del tipo de producto con una leyenda de «imagen ilustrativa». Hoy el catálogo no tiene esa leyenda y el criterio de #285 pide coincidencia visual, por lo que no se aplicó.
3. Dejarlos con el texto «Sin imagen» que ya muestra la tienda, como el resto de los 760, y registrar un seguimiento con responsable y fecha.

## Verificación
- `node data/demo-catalog/cobertura-visual.cjs`: valida SKU conocidos y sin duplicados, evidencia completa, WebP y que ninguna foto se reutilice entre grupos distintos.
- `node --test data/demo-catalog/generar.test.cjs`.
- Los contadores fijos de los E2E pasaron de 132 a 144 fotos y de 772 a 760 SKU sin foto.
