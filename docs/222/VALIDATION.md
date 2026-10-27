# #222 — entrega y evidencia

Base y remoto reconsultados antes de publicar: `f83f30710eb79eed920d53bc88b476da68bedf5b`. Rama `feature/222-dtos-class-validator`, destino develop. Al cierre de la inspección previa al push solo se encontró PR #45 abierto (Tailwind); no había ramas publicadas de #212/#217/#222. No se puede observar trabajo local aún no publicado de compañeros. No se modificó su rama ni se envió comunicación en su nombre.

## Resultado reproducible

Desde backend: `npm ci` y `npm test`. Este último ejecuta build, test:unit, test:dto-source y los dos helpers de MariaDB. Requiere Node >=22 y Docker con mariadb:11.4. Desde frontend: `npm ci`, `npm test`, `npm run build`. Entorno ejecutado: Windows, Node v24.14.0. No hay .env en esta copia.

| Comprobación | Resultado final |
|---|---|
| Baseline antes del refactor | 196 unit/HTTP + 45 integraciones generales + 8 categorías PASS |
| tsc backend | PASS |
| Unit/HTTP backend (196 anteriores + 306 nuevos) | 502 PASS, 0 FAIL, 0 SKIP |
| tsx, 7 clases reales por middleware HTTP (positivo/negativo por clase) | 1 test PASS, 0 FAIL, 0 SKIP |
| MariaDB: admin, catálogo, registro, auth, clientes, ORM, fallos/transacciones | 47 PASS, 0 FAIL, 0 SKIP |
| MariaDB: categorías | 8 PASS, 0 FAIL, 0 SKIP |
| Frontend tests | 55 PASS, 0 FAIL, 0 SKIP |
| Frontend type-check + build | PASS |
| git diff --check | PASS |
| npm audit backend | 1 HIGH heredada en body-parser; no vulnerabilidad reportada en los paquetes nuevos. Pendiente de #212, no corregida aquí. |

Los helpers crean y eliminan contenedores nuevos sin volúmenes, con nombre/BD/password aleatorios y puerto loopback aleatorio. No se usa BD real ni producción. Fingerprint de SHOW CREATE TABLE antes/después (excepto contador AUTO_INCREMENT): `7a9e0906eba41a1c02e61a1a386df565cb3324b5249f9938229a9bdf51905886`, idéntico en ambos helpers.

La integración conserva pruebas de SKU único/migración idempotente, duplicados de email concurrentes, rollback sin CLIENTE huérfano, bloqueo de stock sin escrituras tardías, corte de conexión, saturación y categorías. Nuevos casos verifican filas intactas ante rechazo, null parcial que conserva campos omitidos, persistencia 1.239→1.24 y registro/login con contraseña de 72 bytes que incluye espacios: original funciona, trim falla y exceso recibe 400.

## Cambios y revisión

- `src/dtos/{auth,catalog,products}`: siete clases y reglas que mantienen longitudes/unidades/normalización anteriores; `validation.ts`, `policies.ts`, `rules.ts` centralizan instanciación, allowlists, errores y parseo.
- `src/middlewares/validate-dto.middleware.ts` y tres routers: validación de body/query/params antes de controladores/servicios; ADMIN continúa detrás de authenticate/authorizeRoles.
- Controladores consumen `res.locals.dto` y nunca el body crudo para persistir. Query de Express 5 conserva su getter; filtros duplicados/estructurados se prueban vía HTTP real.
- Validadores síncronos delegan a los mismos DTO; servicio de productos reutiliza las reglas para llamadas internas. Existencia, unicidad y transacciones permanecen en servicio/repositorio/DB.
- Dependencias: dos directas nuevas y tres transitivas; ninguna versión anterior del lock modificada. Scripts agregan tests DTO/tsx. Sin cambio frontend, SQL, esquema, JWT/Passport ni entidades.
- [CONTRACTS.md](CONTRACTS.md) detalla campos y diferencias: 400 para extras de login/productos/stock, IDs canónicos INT, tipos/longitud de login, precedencia 400 sobre 404 para entradas inválidas. Se conservan envelopes y errores de persistencia.

## Incidencias de validación resueltas y límites

Primera regresión: dos tests de resultado incierto enviaban `{}` a servicios interceptados. Los DTO ahora rechazan ese input antes del stub. Se corrigieron los fixtures a producto válido y actualización válida, conservando las expectativas 500 y mensaje de incertidumbre.

Primera ejecución de los tests nuevos: tres expectativas asumían `{message}` para JSON null de productos, pero express.json conserva `{error}`; se corrigió el test, no el contrato. Se eliminó un cierre duplicado del pool en teardown.

Intento de reutilizar tests con mocks sobre exports de tsx falló porque esbuild expone getters sin método reemplazable. Se sustituyó por `dto-source.test.cjs`, que prueba las siete clases reales por HTTP sin mocks y sin depender de design metadata. No se omiten tests para ocultar ese fallo: suite de contratos con stubs se ejecuta sobre dist y compatibilidad de decoradores se prueba sobre fuentes.

Evidencia en `evidence/`: logs finales completos, baseline y auditoría. No se midió cobertura porcentual ni se ejecutó E2E de navegador (#214). La HIGH de body-parser sigue abierta para #212. No se hace merge, aprobación, cierre de #222 ni cambios en Taiga.
