# #310 · Corrección final P2 de procedencia y licencias

18 de noviembre de 2026. Corrección posterior a la reauditoría del HEAD `379e6669a8940817d7c49f7206e114bef2f802e9`, sobre la misma rama del PR #125.

## Cambio

`validarFuente()` deja de buscar subcadenas en el bloque narrativo. Para el nombre exacto del archivo exige un único bloque de créditos y un único `Registro:`. Extrae, en orden, autor, fuente, URL original, licencia y referencia de licencia, y compara cada valor completo con el CSV mediante igualdad estricta. No se normalizan dominios, versiones, prefijos ni fragmentos como equivalencias.

Los registros incompletos, con campos vacíos, separadores extra, espacios ambiguos, o bloques/registros duplicados se rechazan. La restricción se aplica al archivo consultado, no globalmente a créditos históricos sin asociación. Antes del cambio se comprobó la cobertura efectiva: los **60 archivos utilizados por los 182 SKU** ya tienen exactamente un registro válido de cinco campos; no fue necesario editar `creditos.txt`.

Se conservan los controles de WebP, tamaño, dimensiones en la suite, familia, asociación SKU, manifiesto y hashes. Los SKU que comparten recurso deben coincidir con el mismo registro independiente del CSV.

## Regresiones y validación

Se agregaron tres pruebas independientes del SKU `FP-DEMO-ELE-CALADORA-500-W`. Cada una valida primero el valor original y después exige rechazar:

1. `CC BY-SA 4.0` sustituida por `CC BY`.
2. La ficha completa de Wikimedia sustituida por `https://commons.wikimedia.org/`.
3. La referencia completa de licencia sustituida por `https://creativecommons.org/`.

Con el validador de `379e666`, las tres pruebas nuevas fallan por ausencia de la excepción esperada (0/3). Con la corrección, la suite completa aprueba **15/15**. Las tres mutaciones originales de la auditoría se repitieron además sobre las lecturas del CSV: tanto el CLI de cobertura como la suite terminan con código **1** en cada caso. No se modifican físicamente los archivos para esas pruebas.

Se añadió una cuarta prueba que cubre registros ausentes, incompletos, ambiguos y duplicados, asociación por nombre exacto y compatibilidad con un bloque histórico ajeno sin `Registro:`.

Ejecutado con **Node.js 22.22.2**:

- `node --test data/demo-catalog/generar.test.cjs`: 15/15.
- `node data/demo-catalog/cobertura-visual.cjs`: código 0. Resultado idéntico a `visual-audit.json`.
- Verificación completa de fuentes y créditos: 182 SKU y 60 archivos, sin inconsistencias.
- Frontend `npm run type-check`: correcto.
- `node --test frontend/test/illustrative-image.test.cjs`: 2/2.
- `git diff --check`: correcto.

## Alcance preservado y entrega

Las **50 asociaciones visuales permanecen intactas: nueve fotografías y 41 ilustraciones**. No se modificaron ni regeneraron WebP, manifiesto, CSV de fuentes, matriz, créditos ni informes JSON de cobertura/catálogo. La política CI de #144 y la integración con develop se conservan.

La descripción actualizada del PR se prepara con las cifras 50/50 y 9/41. Se intenta publicarla exclusivamente mediante el conector autorizado; si devuelve 403, se entrega para copiar manualmente, sin recurrir a credenciales almacenadas ni otros accesos. El SHA publicado y el resultado del nuevo CI se informan en la entrega del chat.

Comentario para reauditoría: «Santiago: solicito reauditoría del nuevo HEAD de #125. La procedencia y licencia se comparan ahora por campos completos de `Registro:`; las tres mutaciones señaladas se rechazan, con 15/15 pruebas. Las 50 asociaciones y todos los recursos visuales se conservaron. Queda tu aprobación técnica y UX/UI de Lucci; sin merge ni cierre de #310».
