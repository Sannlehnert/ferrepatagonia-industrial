# Auditoría del frontend y retiro de la excepción de picomatch

GitHub retiró el [GHSA-fc5q-39xc-vjpf / CVE-2026-112366](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) el 18/11/2026. La excepción temporal para sus diez hallazgos y la exigencia de que el informe los incluyera dejaron de aplicar. El [mantenedor de picomatch](https://github.com/micromatch/picomatch/pull/235#issuecomment-6315749381) recomienda no aceptar patrones no confiables; el retiro no constituye una actualización de `picomatch` ni una garantía frente a patrones costosos.

La auditoría ahora bloquea **todos** los hallazgos altos o críticos tanto de producción como de desarrollo, sin excepciones, incluidos nuevos advisories de picomatch. También bloquea errores de npm, informes incompletos, inventarios inconsistentes y hallazgos de producción ausentes del informe completo.

Desde `frontend/`, ejecutar `npm ci`, `npm run audit:ci` y `node --test test/audit-ci.test.cjs`. Para verificar las seis configuraciones heredadas con Node 22.22.2 y npm 10.9.7, ejecutar `npm run test:audit-scope`.

El runner comprueba la instalación y la correspondencia del manifiesto con el lockfile. Audita una copia temporal del manifiesto y lockfile con el registro oficial, configuración vacía y alcances explícitos: la auditoría completa incluye dev, optional y peer; producción omite dev e incluye prod, optional y peer. Las variables npm_config, NODE_ENV y las opciones de carga de Node heredadas se excluyen de los procesos npm hijos. Se contrastan los contadores del inventario y los nodos vulnerables con el lockfile.
