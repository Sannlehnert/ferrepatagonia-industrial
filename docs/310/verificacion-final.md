# #310 · Verificación final del PR #125

18 de noviembre de 2026. Rama existente `task/310-imagenes-productos-1-50-pr`. No se abrió otro PR, no se hizo merge a develop ni se cerró #310.

## Estado revisado

Partida remota: `8c8795c9874f449609e3f590dcc2ac517fbc5613`, árbol aislado limpio. Se leyeron las tres revisiones de Santiago en el PR, contra `628e412`, `616ab9f` y `34af44d`. Se contrastó el delta posterior a `34af44d` y el diff exclusivo frente a develop. Los cambios ajenos al alcance proceden de merges previos de develop, no se reescribieron.

Se incorporaron los cinco commits pendientes de develop hasta `56ca40f`, sin conflictos, mediante `5884a4e`. Durante la validación, develop recibió #130; se incorporaron sus siete commits hasta `8323219` mediante `aeb8043`, también sin conflictos. Se conserva #144: `npm audit --audit-level=high` directo, sin excepción temporal ni sustitución del control. Las correcciones de imágenes y validadores están en `f727192`; `83603f1` agrega E2E y evidencias. El SHA final y el resultado remoto de CI se consignan en la descripción del [PR #125](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/125).

## Hallazgos

| Hallazgo anterior | Estado técnico | Evidencia y límite |
| --- | --- | --- |
| Cobertura parcial, 13/50 y luego 12/50 | Resuelto | 50/50: 9 fotografías y 41 ilustraciones. No se presentan como 50 fotos exactas. |
| Disco de 125 mm asociado a otras medidas | Resuelto | Foto limitada a 125 mm; 100 mm tiene dibujo de corte. |
| Inventario y reporte incongruentes | Resuelto | 182 pares SKU/archivo, hashes de origen y publicados conciliados con el E2E. |
| Borceguí, dimensiones y crédito | Resuelto | Recurso preservado a 540 × 960 px y atribución a Victor Adrian. |
| F-01 · Aviso inaccesible | Resuelto | Texto HTML de 14 px como mínimo; catálogo, ficha y carrito; 320/360 px; role=note y ausencia en fotografías. |
| F-02 · Quince cruces de tipo y atributos visibles | Resuelto en el alcance ilustrativo | Se revisaron los 50 SKU individualmente. Dibujos específicos de corte, envases, accesorios, herramientas, anclaje y varilla; colores de cables/chalecos y puño del guante diferenciados. La aceptación UX/UI y de los esquemas de EPP sigue pendiente de Lucci y Santiago. |
| F-03 · Cono/tarugo de otra medida y ala del casco | Resuelto | Cono de 30 cm restringido a ese SKU. Foto de tarugo de 8 mm sustituida en el SKU de 10 mm; casco de ala completa pasa a ilustración. Ranuras laterales del otro casco indicadas en el esquema. |
| F-04 · Validadores permisivos | Resuelto | Mutaciones negativas de bytes, renombrado, familia, autor, fuente, licencia, medidas e informe; decodificación y ambas huellas. |
| F-05 · Persistencia y archivo conservado ambiguo | Resuelto en herramienta/documentación | No recarga la demo persistente. Devuelve archivoPlanificado y verificacionPendiente para recursos existentes; reemplazo manual por SKU documentado. No se migró ninguna instalación persistente. |
| F-06 · Documentación y descripción desactualizadas | Documentación resuelta | Matriz y cifras conciliadas; descripción del PR actualizada en la entrega. |
| F-07 · Asociador rechaza maestro de 100 | Resuelto | Carga y asociación reales por API, 61 disponibles/39 pendientes, antes del fixture de 904. |
| Fixture Node/MariaDB | Resuelto | Marca única UTC de Node; E2E adelanta SQL un día y prueba la marca persistida sin sleep. |
| Aprobación funcional, revisión final y cierre | Pendiente | Corresponde a Santiago y Lucci. No se presupone aprobación ni se cierra #310. |

## Validaciones locales

Todas las ejecuciones finales usaron Node.js **22.22.2**. Las instalaciones iniciales de dependencias usaron npm con su Node 24.14.0 adyacente; para las pruebas se invocó explícitamente Node 22 y npm-cli.js, con ese Node en PATH. No se modificaron lockfiles.

| Comprobación | Resultado |
| --- | --- |
| `node --test data/demo-catalog/generar.test.cjs` | 11/11. Incluye cobertura de los primeros 50 y matriz, maestro, conservación de imágenes, metadatos y decodificación de los 60 activos utilizados. |
| Frontend `npm run type-check` | Correcto. Incluye los specs TypeScript E2E. |
| Frontend `npm test` | 228/228 después de integrar #130 (227/227 antes). |
| Frontend `npm run build` | Correcto, incluido type-check. |
| Backend type-check y build | Correctos. |
| Backend `npm run test:unit` | 1334 correctos, 3 omitidos, 0 fallos en ejecución con loopback. Un intento previo bajo sandbox no pudo hacer fetch local; no se contabiliza como aprobado. |
| Backend `npm run test:dto-source` | 3/3. |
| ADMIN sobre develop actualizado | 17/17 con su runner MariaDB aislado. Se corrigió la misma mezcla UTC_TIMESTAMP/Node en la fixture de evidencia de precio; sin cambios de lógica de negocio. El esquema permaneció idéntico antes/después. |
| `npm audit --audit-level=high`, frontend y backend | 0 vulnerabilidades en ambos. Política #144 conservada. |
| E2E de importación y catálogo con build de producción | 1/1, MariaDB 11.4 descartable y Chromium. Maestro real de 100 SKU: 61 subidas y 39 pendientes. Académico: 904 importados, 182 recursos, 722 pendientes; reimportación, cinco pedidos simulados, cinco cargos y cero pagos. |
| Conciliación E2E/informe versionado | Coinciden los 182 SKU, archivos y ambos hashes. El origen no se confunde con el WebP recodificado por ADMIN. |
| Accesibilidad móvil | Aviso visible, sin desborde y de al menos 14 px. Dos anchos en tres vistas; 182 pares de catálogo/ficha a 360 px. Capturas de carrito conservadas. |
| Desfase temporal | MariaDB unos 27,5 s por delante del host. Además se adelantó un día la sesión SQL. La marca guardada coincide con Node; sin espera artificial. |
| Limpieza | Los pases completos del E2E confirmaron eliminación del contenedor y datos tmpfs. El pase final con #130 integrado también pasó. |
| `git diff --check` | Correcto. |

El CI completo se ejecuta en GitHub Actions al actualizar esta rama. El resultado de ese run se informa con el SHA final en el PR y en la entrega; esta tabla no atribuye ejecución local a las demás suites integradas de CI.

## Archivos y evidencia

- Generación, validación y fuentes: `data/demo-catalog/{ilustraciones.cjs,cobertura-visual.cjs,asociar-fotos.cjs,generar.test.cjs,image-sources.csv,catalog-validation.json,visual-audit.json,README.md}`.
- Activos: 15 ilustraciones nuevas, una corregida (`ilustrativa-adh-sellador.webp`), manifiesto y créditos. Los demás binarios ya revisados se conservaron byte a byte.
- Frontend: clasificación de imágenes y regresiones; E2E de importación/catálogo. No se cambiaron funcionalidades ajenas.
- Backend: únicamente la fixture temporal de `backend/test/adminProduct.test.cjs` unifica la marca UTC de Node, igual que el E2E.
- [Matriz de 50 SKU y límites de correspondencia](imagenes-productos-1-50.md), [CSV de matriz](matriz-verificada.csv), [resultado maestro](maestro-100-verificado.json), [relojes UTC](relojes-utc.json), [carrito 320](aviso-carrito-320.png), [carrito 360](aviso-carrito-360.png).

Las capturas y JSON corresponden al entorno local descartable; sus URLs loopback no son enlaces persistentes de producción. El fixture del maestro solo usa los 100 SKU/nombres reales; los precios y existencias siguen siendo académicos. No se cargaron imágenes en una instalación compartida ni se modificó `sources/`.

## Riesgos residuales

La imagen ilustrativa no certifica talla, medida, potencia, material, certificación o cantidad de un pack. La matriz explicita lo no verificable por fila. La revisión UX/UI de Lucci y la aprobación técnica de Santiago siguen pendientes. No se probó un lector de pantalla nativo; sí el texto HTML y el rol accesible del navegador. La clasificación por SKU del fixture debe actualizarse si posteriormente se reemplaza una ilustración administrada por una foto exacta con UUID. La migración de una demo persistente previa requiere comparar sus recursos y reemplazar manualmente los SKU autorizados.

## Comentario propuesto para Santiago

Santiago: solicito reauditoría del nuevo HEAD de #125. Se corrigieron los recursos pendientes, la trazabilidad y los validadores; la cobertura verificada es 50/50 (9 fotos y 41 ilustraciones). Se probaron importación/asociación del maestro de 100 SKU, avisos a 320/360 px y desfase UTC con MariaDB descartable. La matriz, hashes y evidencias están en docs/310. Queda tu aprobación técnica y la revisión UX/UI de Lucci; sin merge ni cierre de #310.
