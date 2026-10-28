# #217 — Fase 2A: Passport JWT y autorización vigente

Fecha: 27/10/2026. Rama local: `feature/217-passport-jwt-security`.

Base inicial: **8080f210be80162048fb73420bc825369c9bc855**, develop remoto confirmado antes de crear la rama. Incluye #221/TypeORM (PR #44), #222/DTO (PR #46) y #215. Referencia utilizada: informe de fase 1, `audit-217-20261027/INFORME-217-FASE-1.md`, conservado fuera del repositorio.

## Resultado

Todas las rutas protegidas ejecutan la estrategia real de Passport JWT y vuelven a consultar al usuario mediante TypeORM. Una sesión cuyo usuario fue desactivado, eliminado o cambió de rol devuelve 401 antes del controlador y de cualquier operación de negocio. CLIENTE vigente recibe 403 en administración. Un fallo de consulta devuelve 500 genérico; no se permite acceso ni se informa falsamente que las credenciales son inválidas.

La rama y los commits permanecen locales. No se hizo push, PR, merge ni cambios en Taiga.

## Arquitectura implementada

1. `app.ts` ejecuta cookie-parser y después `authPassport.initialize()`.
2. `authenticate` borra el contexto previo e invoca `authPassport.authenticate('jwt', {session:false}, callback)` en cada petición protegida.
3. La estrategia de `config/passport.config.ts` extrae exclusivamente la cookie `jwt_token` string. No acepta Authorization/Bearer, query ni body como transporte alternativo. Verifica firma, solo HS256 y expiración.
4. `readAuthClaims` exige objeto, ID entero seguro positivo, ADMIN/CLIENTE y `exp` numérico finito. Se consume únicamente después de verificación criptográfica. Un JWT sin `exp` es rechazado antes de consultar la BD. `verifyToken` conserva su API de compatibilidad y utiliza la misma regla de claims; las rutas protegidas usan Passport.
5. La estrategia reutiliza `restoreUsuario`: llama a `findUsuarioById`, consulta real TypeORM sin password_hash, exige usuario activo y coincidencia de rol con el token. Cualquier cambio de rol invalida la sesión anterior, tanto descenso como ascenso. No hay caché entre peticiones.
6. El wrapper asigna `req.auth` mínimo y `req.authUser` público, tipados. `/me` reutiliza ese usuario y conserva su JSON sin realizar una segunda consulta.
7. Todo `/api/admin` cruza una sola guarda authenticate+ADMIN. `adminProductRouter` se monta dentro de `adminRouter`, bajo `/productos`; se elimina el montaje directo y la guarda duplicada. Sus DTO y controladores siguen conectados.

El lookup representa el estado vigente al consultar la identidad en esa petición; no se promete cancelar una operación ya en curso si se desactiva el usuario después de ese punto. No se agregó bloqueo global ni revocación persistente.

## Corrección del P1

En la fase 1, un token ADMIN legítimo seguía obteniendo 200 en productos/clientes después de desactivar, eliminar o degradar la cuenta, mientras /me respondía 401. Ahora el mismo token recibe **401 en /me, clientes y todos los métodos administrativos**, incluidas rutas desconocidas. Las pruebas modifican filas de USUARIO reales en una base desechable después de emitir el token y comprueban ausencia de escrituras de productos.

No se confía en el rol del frontend ni exclusivamente en el JWT. No se agrega el rol actual a un token antiguo que no coincide: debe iniciarse sesión otra vez.

## Contratos preservados

| Área | Resultado |
|---|---|
| Login | Mismo DTO, credenciales sin normalización adicional, bcrypt, mensaje `Login exitoso`, proyección user y cookie. La estrategia protege peticiones posteriores; no se añadió Passport Local. |
| Registro | Mismo DTO, rol CLIENTE asignado por servidor, hash, transacción, JSON 201 y 400/409. |
| JWT | Emisor HS256 de dos horas. Rechazo deliberado nuevo de tokens sin exp y sesiones desactualizadas. |
| Cookies | Sin cambios de configuración: jwt_token, HttpOnly, SameSite Strict, Secure en production, path / por Express, host-only, duración 7200 s. |
| /me | Mismo `{user}`, sin renovación de cookie. 401 `{message:'No autenticado.'}`. Error de consulta 500 `{message:'Error interno del servidor.'}`. |
| Autorización | CLIENTE vigente en ADMIN: 403 `{message:'El rol autenticado no tiene permiso.'}`. Visitante o sesión inválida: 401. |
| Logout | Mismo mensaje y borrado de cookie; idempotente. Copia capturada de un token sigue siendo válida mientras usuario y token sean válidos, porque la revocación persistente está fuera de alcance. |
| Administración | Prefijos, métodos, DTO, JSON y errores de negocio 400/404/409/500 preservados. Ruta desconocida: ADMIN vigente 404, CLIENTE vigente 403, visitante/sesión inválida 401. |
| Fallo de identidad | Nuevo punto de fallo necesario por la revalidación: 500 genérico, sin SQL, parámetros, token, password, hash ni detalle de Passport. No llega al negocio. |

## Archivos de implementación

- `backend/src/config/passport.config.ts`: instancia/estrategia Passport JWT y extractor cookie.
- `backend/src/middlewares/auth.middleware.ts`: ejecución real Passport, separación 401/500, contexto verificado y autorización existente.
- `backend/src/services/token.service.ts`: validación compartida y exp obligatorio; emisor intacto.
- `backend/src/services/auth.services.ts`: tipado explícito de la sesión y reutilización de restoreUsuario; reglas de consulta/activo/rol existentes.
- `backend/src/types/auth.ts`, `backend/src/types/express.d.ts`: SessionUser y req.authUser.
- `backend/src/app.ts`, `backend/src/routes/admin.routes.ts`, `backend/src/routes/adminProduct.routes.ts`: inicialización y un único árbol administrativo protegido.
- `backend/src/controllers/auth.controller.ts`: /me consume usuario ya verificado. Login/logout no cambian sus opciones ni respuestas.
- `backend/package.json`, `backend/package-lock.json`: Passport/tipos, script type-check y nuevas suites.

Pruebas nuevas: `auth.passport.test.cjs`, `auth.passport-source.test.cjs`, `auth.security.integration.test.cjs`. Helpers nuevos: `session-fixture.cjs` (solo fila unitaria), `protected-routes.cjs` (inventario compartido), `auth-user.cjs` (cuentas reales y credenciales efímeras en BD desechable).

Pruebas adaptadas: `auth.middleware.test.cjs`, `clientes.test.cjs`, `database-outcome.test.cjs`, `dto.test.cjs`, `adminProduct.test.cjs`, `clientes.integration.test.cjs`, `database-policy.integration.test.cjs`, `helpers/run-admin-products-mariadb.cjs`.

Las unitarias reemplazan solo el repositorio de identidad cuando corresponde a ese nivel, manteniendo Passport real. Las integraciones crean USUARIO/CLIENTE persistidos con IDs generados y eliminan exclusivamente sus filas. No se introdujo un bypass de autenticación, un rol especial de test ni un modo sin consulta de identidad. No se eliminaron tests anteriores ni se debilitaron sus assertions de permisos/negocio.

## Dependencias y equipo

Versiones consultadas en el registro npm e instaladas explícitamente: `passport` 0.7.0, `passport-jwt` 4.0.1, `@types/passport` 1.0.17 y `@types/passport-jwt` 4.0.1. Compatibilidad verificada con Express 5, TS 5.9 y Node 24.14.0; engines del proyecto permanece >=22.

Comparación estructural del lock contra develop: **0 paquetes anteriores modificados**. Se añaden ocho entradas: las cuatro directas, `passport-strategy`, `pause`, `utils-merge` y `@types/passport-strategy`. Passport JWT comparte la versión existente de jsonwebtoken.

Al inicio solo estaba publicada la otra rama `feature/214-integrated-e2e`, PR #47. No se encontró rama/PR específico ni actualización backend integrada de #212; esto no descarta trabajo local de Lucci. No se modificó ninguna rama ajena. Antes de integrar habrá que reconfirmar dependencias/remotos. La auditoría npm conserva **1 HIGH heredada en body-parser**; sin alertas nuevas en las dependencias añadidas. No se ejecutó audit fix.

## Pruebas y resultados exactos

Baseline utilizado: fase 1 sobre el mismo develop, **558 pruebas backend PASS**. No se confunde ese resultado anterior con los tests nuevos.

| Verificación final | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unitarias/HTTP (suite completa) | 728 | 0 | 0 |
| Fuentes con tsx: DTO + aplicación real con Passport | 2 | 0 | 0 |
| MariaDB: suite general y seguridad | 218 | 0 | 0 |
| MariaDB: categorías | 8 | 0 | 0 |
| **Total** | **956** | **0** | **0** |

Build `tsc`: PASS. Type-check `tsc --noEmit`: PASS. `git diff --check`: PASS. No hubo fallos finales, cancelaciones ni tests omitidos. Aumento respecto del baseline: 398 tests contados por el runner, varios parametrizados; no se presenta como cobertura porcentual ni como 398 reglas independientes.

La suite Passport añade una matriz de 11 rutas/métodos: /me, clientes, listado/detalle/alta/edición/desactivación/stock de productos, ruta administrativa desconocida, POST desconocido y DELETE no implementado. Comprueba ADMIN, CLIENTE, estados inválidos, fallo de lookup y tokens ausentes/malformados/vencidos/sin exp/HS384/none/firma incorrecta/alteración/nbf futuro/claims inválidos. También prueba exclusividad de cookie y bloqueo por la estrategia. Espías delegados a la estrategia real y a la consulta real cuentan exactamente una ejecución por petición; una denegación forzada de la estrategia devuelve 401 en todo el inventario.

La integración reproduce cambios reales de activo/rol/eliminación y tanto ascenso como descenso de rol. Comprueba 401 uniforme, ausencia de escrituras, saturación real del pool TypeORM → 500 controlado en todas las rutas y recuperación posterior. Fallos arbitrarios de consulta con status/code/parameters sensibles se prueban en la capa unitaria, sin convertirlos en 401/409 ni exponerlos.

Login/me/logout reales se prueban en modos development/production: atributos de set/clear, TTL, JSON público, sin renovación y semántica stateless conservada. Los asserts de cookies solo evalúan atributos; no imprimen los valores del token. La prueba tsx usa `src/app.ts` real y la estrategia real, sustituyendo únicamente el límite de driver TypeORM sin conexión externa.

Se conservaron y ejecutaron las pruebas de SKU, redondeo 1.239→1.24, DTO, stock, timeout sin escritura tardía, email concurrente, rollback, categorías y metadatos ORM. Las bases fueron exclusivamente contenedores nuevos mariadb:11.4, sin volúmenes, UUID, password efímera y puerto aleatorio loopback. Los helpers rechazan bases fuera de su patrón desechable.

SHOW CREATE TABLE antes/después en ambos runners permaneció idéntico, excluyendo solo contador AUTO_INCREMENT: `7a9e0906eba41a1c02e61a1a386df565cb3324b5249f9938229a9bdf51905886`.

### Reproducción

Desde backend, con Node >=22 y Docker disponible:

```text
npm ci
npm run type-check
npm test
```

Esta ejecución instaló los paquetes nuevos con npm install sobre el lock existente; no se afirma haber realizado una reinstalación limpia mediante npm ci. `npm test` compila y ejecuta unitarias, tsx e integraciones con runners aislados. Evitar `node --test test/*.cjs` sin los guards/opt-ins de integración.

Evidencia en `docs/217/evidence/`: `full-backend-tests.txt`, `token-check.txt`, `passport-unit.txt`, `passport-integration-baseline.txt` y `npm-audit.json`. Los resultados no contienen cookies/JWT ni credenciales reales. No se ejecutó E2E ni frontend en esta fase y no se modificaron sus archivos ni la suite #214.

## Commits locales y revisión

1. `0dde768`: exp obligatorio; build y 31 pruebas de autenticación PASS.
2. `7f7d3b4`: Passport, identidad vigente y montaje único; type-check y 728 unitarias/HTTP PASS.
3. `48e287b`: fixtures reales, matriz MariaDB y fuente tsx; suite completa 956 PASS.
4. Documentación/evidencia de entrega en un commit local adicional. El SHA final se informa mediante `git rev-parse HEAD` al entregar; no se inserta dentro de su propio contenido.

Revisión final: las rutas usan Passport; se conserva authenticate como wrapper público para no cambiar contratos de callers; authorizeRoles sigue separado. No hay caché entre peticiones, consultas duplicadas de usuario, fallback a un token sin validación ni lecturas de hash en la consulta de sesión. La revisión es del mismo autor, no una aprobación independiente de PR.

## Pendientes de fase 2B

- Rate limiting y política 429: umbrales/store y relación con proxy.
- Política de CSRF/origen y CORS según dominios reales; conservar mitigación Strict hasta definir el despliegue.
- Configuración final HTTPS/reverse proxy/trust proxy.
- Validación más estricta de modo/gestión de clave JWT conforme a la auditoría; sin rotar credenciales ni modificar cookies en 2A.
- Revocación persistente si se decide exigirla tras logout; hoy se conserva borrado de cookie stateless.
- Revalidar #214 después de integrar los cambios, coordinar #216/CI y #218/documentación de despliegue.
- Resolver la HIGH heredada de body-parser con #212.

No hay bloqueo identificado para revisar los resultados de 2A. La publicación de rama/PR y cualquier merge quedan pendientes de autorización posterior.
