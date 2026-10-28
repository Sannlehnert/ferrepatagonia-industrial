# #216 — Verificación reproducible de CI

Node 22.22.2, npm ci y lockfiles sin cambios respecto de develop. Permisos contents: read. CI ejecuta auditoría npm, tipos, builds, 1.213 tests backend, 56 frontend, 25 E2E Chromium y 2 tests de cleanup en el merge sintético con develop. Los números son los observados, no una expectativa que sustituya futuros resultados.

## Evidencia histórica verificada

- HEAD inicial: 887a3956f4f736fd5ee1e7149ade24ef26005863.
- Develop verificado: 4ab2b20037669cb67421ecc10b1de432c17b8ad3 (incluye #212, #217, #214 y #220).
- Verde: https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/40746213727 ; HEAD 887a3956; merge sintético e14460ee4ea3d4b5d1a171642918e186ef86fb83.
- Verde anterior: https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/40745497127 ; HEAD e4b7ac7135c109bd2efc424e9795b250fdd089e0.
- Fallo histórico: https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/40742460381 ; HEAD d0285a58c263c7a31302334c706a9bf3e2d31bcd. Faltaba el módulo mariadb antes de ejecutar Playwright. No constituye prueba negativa de aserción fallida.

Los archivos de evidencia local originales son históricos (Node 24.14, frontend 55); no representan el CI actual.

## Verificación Docker

Ambos jobs capturan inventario previo y posterior. Bash estricto propaga errores de docker, sort y comm. El diagnóstico comienza con verification=error y clean=false; únicamente una comparación completada puede declarar clean=true. Una fuga produce exit 1. Los diagnósticos y resúmenes se preservan con if: always(). No se borran recursos ajenos ni se usa prune.

Comandos de CI: npm ci; npm audit --audit-level=high; npm run type-check; npm run build; npm run test:unit; npm run test:dto-source; npm run test:integration; node --test backend/test/e2e-cleanup.test.cjs; npm test (frontend); npx playwright install --with-deps chromium; node backend/test/helpers/run-e2e.cjs.

## Alcance de la evidencia

La prueba negativa real se documenta abajo. La ejecución verde final debe corresponder al HEAD publicado en los checks de #50. El fallo histórico de preparación no sustituye la aserción real.

Artifacts: únicamente diagnósticos Docker y reporte HTML de Playwright. Se excluye test-results de la publicación para no subir traces, cookies o JWT de pruebas fallidas.

## Evidencia nueva de correcciones finales

- Pruebas locales focalizadas sobre los bloques reales del workflow: 12/12 PASS (6 escenarios por job: limpio, fuga, baseline ausente, fallo Docker, sort y comm). Comandos Docker simulados; no se crearon recursos reales. Ver evidence/verifier-focused-results.json.
- Prueba negativa real: PR temporal #53, commit 02f46dbfbd7557caa682e5fd6311377e1657c933. Run https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/40760563063 ; job frontend 123071025234, paso Run frontend unit tests: CI_NEGATIVE_PROBE_216 compara actual 1 con expected 2. Resultado 56 PASS, 1 FAIL, 0 SKIP; exit 1 y job FAILURE. Ver negative-assertion-actions.json. El marcador no forma parte del PR #50.
- Corrección técnica publicada en 918f2d67b81636488f1e0ec78507fdeea256aaff. La ejecución final asociada al HEAD documental se verifica desde los checks del PR #50; no se sustituye por resultados locales.
- Los artifacts frontend publican únicamente index.html del reporte y el diagnóstico Docker. Se excluyen test-results y el directorio de attachments/data para evitar publicar traces y datos HTTP.
