# #216 — Verificación de CI y automatización de pruebas

## Resolución de auditoría cruzada (PR #50)

- **Develop incorporado**: Sincronización completada con `#214`, heredando suites E2E, helpers de cleanup y lockfiles oficiales sin alteraciones.
- **Runtime compatible**: Configurado Node `22.22.2` en GitHub Actions para eliminar cualquier advertencia `EBADENGINE` contra los lockfiles de backend y frontend.
- **E2E y Cleanup en CI**: Incorporada la ejecución de `backend/test/e2e-cleanup.test.cjs` y `backend/test/helpers/run-e2e.cjs` (25 tests de Playwright con backend y MariaDB efímero).
- **Limpieza de MariaDB**: Eliminación estricta de contenedores y volúmenes anónimos (`docker rm -f -v`) verificada mediante aserciones post-ejecución y `if: always()` en los runners.

### Conteo final de validaciones locales y en CI
- Backend: 1.213 pruebas exitosas (unitarias, integración MariaDB, DTO-source y cleanup).
- Frontend: 55 pruebas y build de Vite exitosos.
- Cero vulnerabilidades críticas (`npm audit`).
- Cero contenedores ni volúmenes huérfanos post-ejecución.
