# #311 — Imágenes del catálogo académico

Ferrepatagonia Industrial es un proyecto académico sin fines comerciales. Los productos, precios y pedidos de esta demostración forman parte de una simulación. No se realizan ventas ni cobros reales. Las imágenes ilustran los productos de la demo y no acreditan especificaciones técnicas, certificaciones ni vínculos con fabricantes o comercios.

## Registro de imágenes

El [CSV de imágenes](imagenes-51-100.csv) cubre los SKU 51 a 100. Para cada imagen se registra el resultado de la revisión visual, su procedencia y el estado del permiso.

- `url_candidata` contiene la URL directa de una foto en revisión. `fuente_candidata` guarda la ficha de origen, cuando está disponible.
- `url_imagen` contiene la URL directa elegida para el catálogo. `fuente`, `autor`, `licencia` y `url_licencia` documentan su procedencia y las condiciones de uso.
- `archivo_candidato` conserva referencias a archivos que ya existen en el proyecto. La entrega de la #311 registra enlaces y atribuciones. La carga del catálogo usará las URLs aprobadas o podrá copiar las fotos al almacenamiento persistente del proyecto si el permiso lo permite.

## Estado de la revisión

- La prueba registrada cubre los 50 SKU del 51 al 100. Los 50 enlaces devolvieron imágenes que Chrome pudo mostrar. Se comprobó que la evidencia corresponde a las URLs actuales del CSV.
- 14 imágenes elegidas tienen autor, ficha de origen y licencia o declaración de dominio público documentada. Para publicarlas, asociar los créditos al catálogo según las condiciones de cada fuente e indicar las adaptaciones que corresponda, como recortes.
- El SKU 81 está aprobado visualmente y su fuente indica dominio público en Estados Unidos. Queda pendiente confirmar su alcance para un despliegue público desde Argentina o elegir otra foto con permiso explícito para ese uso. La imagen muestra marcas de un modelo real y se documenta como ilustrativa. [Ficha de la imagen](https://commons.wikimedia.org/wiki/File:Фильтрующая_полумаска_3М_8210.jpg) · [Alcance de la marca de dominio público](https://creativecommons.org/publicdomain/mark/1.0/)
- El relevamiento de los 50 SKU está completo. Las 36 referencias con permiso pendiente quedan en `url_candidata` y fuera de la demo publicada. Cada fila documenta el resultado de la revisión en `observaciones`. Se propone una tarea vinculada para obtener las autorizaciones o conseguir reemplazos.

## Incorporación de fotos

1. Elegir una foto donde se reconozca el producto. Comprobar que el enlace directo abre y que la foto corresponde al SKU.
2. Buscar una licencia aplicable a esa foto en su página de origen. Si el permiso no está publicado, consultar a quien pueda autorizar el uso. Se pueden agrupar varias fotos de un mismo titular en un solo pedido, indicando cada enlace.
3. Registrar en el CSV la fuente, el crédito requerido y la licencia o, en `observaciones`, la fecha, la referencia y el alcance de la autorización escrita. Confirmar si cubre presentación en clase, publicación en línea y almacenamiento de una copia, según corresponda.
4. Pasar el enlace a `url_imagen` cuando estén confirmados la correspondencia del producto y el permiso para el uso previsto. Mientras falte esa confirmación, usar `url_candidata` como referencia interna.

## Mensaje para solicitar permiso

> Hola, somos estudiantes y estamos preparando una demostración de Ferrepatagonia Industrial, una aplicación académica sin fines comerciales. ¿Nos autorizan a mostrar estas fotos en el catálogo simulado de la presentación en clase? Les dejamos los enlaces a las imágenes para que puedan identificarlas.
>
> Si más adelante publicamos una demo accesible por internet o guardamos una copia de las fotos para servirlas desde nuestra aplicación, ¿la autorización cubriría también esos usos? ¿Cómo prefieren que indiquemos el crédito?
