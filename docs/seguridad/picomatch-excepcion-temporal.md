# Retiro del verificador temporal y seguimiento de picomatch

**Revisión:** 18/11/2026 · **Estado:** verificador retirado; riesgo residual pendiente de revisión formal · **Responsable de seguimiento:** Santiago Agustín Lehnert (Sannlehnert, mantenedor del repositorio).

## Motivo del mantenimiento de CI

La excepción temporal introducida en el PR #132 exigía que la auditoría completa siguiera informando GHSA-fc5q-39xc-vjpf mientras el lockfile contuviera picomatch 4.0.7. Un informe limpio bloqueaba por cobertura no acreditada, incluso si upstream retiraba el advisory. Ese requisito dejó de ser adecuado para controlar CI.

Se retiraron el verificador, su prueba de alcance, sus siete tests unitarios y los dos comandos npm asociados. El paso `Run frontend security audit` vuelve a ejecutar `npm audit --audit-level=high` desde `frontend/`, con su código de salida bloqueante. Se conservan las demás verificaciones del workflow. No se agrega una lista de exclusión ni se deshabilita la auditoría nativa.

## Estado del advisory y del lockfile

Al consultar el [advisory GHSA-fc5q-39xc-vjpf / CVE-2026-112366](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) el 18/11/2026, GitHub lo marca como **retirado ese mismo día**. La ficha continúa publicada con el rango original `<=4.0.7` y sin versión corregida indicada (`None`). Por lo tanto, no corresponde describirlo como un advisory activo ni presentar su retiro como una corrección del paquete. La [discusión upstream](https://github.com/micromatch/picomatch/pull/235) cuestiona la clasificación como vulnerabilidad y desaconseja aceptar patrones no confiables.

En la base revisada de `origin/develop` (`f8f85e5110a6fcb08f762fb5a7ef7a05a3392e09`), `frontend/package-lock.json` conserva una única instalación de `picomatch@4.0.7`, marcada `dev: true`, dentro del rango originalmente reportado. Las rutas de desarrollo revisadas provienen de Vite, Vue DevTools, `vue-tsc` y `npm-run-all2`. Este mantenimiento no cambia dependencias ni el lockfile y no incorpora un parche de picomatch.

Un resultado de cero vulnerabilidades de npm audit describe el informe del registro en ese momento; **no demuestra que el comportamiento de ReDoS haya sido corregido**.

## Riesgo residual y cierre pendiente

Se mantiene pendiente la evaluación del riesgo de denegación de servicio del proceso Node que ejecuta herramientas de desarrollo o CI si procesa patrones glob no confiables. El retiro del verificador no constituye una aceptación formal ni el cierre de ese riesgo. El seguimiento permanece abierto hasta contar con una versión corregida confirmada o una decisión formal del equipo que documente alcance, exposición y tratamiento. La auditoría y el merge de este mantenimiento quedan a cargo de Lucci.

El responsable debe revisar el advisory, el [seguimiento upstream](https://github.com/micromatch/picomatch/issues/247) y las versiones publicadas. Si se confirma una corrección, actualizar las dependencias compatibles y el lockfile en un cambio separado y ejecutar ambas auditorías, tipos, tests y build. Si el equipo decide aceptar o reclasificar el riesgo, registrar explícitamente la justificación y el responsable; no convertir el informe limpio de npm en una excepción silenciosa. El vencimiento anterior del 24/11/2026 correspondía al mecanismo retirado y no implica una extensión ni aceptación del riesgo.

## Validación reproducible

Con Node.js `22.22.2` y npm `10.9.7`, desde la raíz del repositorio:

```sh
npm ci --prefix frontend
npm audit --omit=dev --audit-level=high --prefix frontend
npm audit --audit-level=high --prefix frontend
npm run type-check --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
git diff --check
```

Ambas auditorías deben ejecutarse sin excepciones y respetando sus códigos de salida. La auditoría de producción se conserva como validación explícita de este mantenimiento; el workflow mantiene la auditoría completa bloqueante. La cantidad de tests se obtiene del HEAD real de develop, descontando únicamente los siete tests exclusivos del verificador retirado.
