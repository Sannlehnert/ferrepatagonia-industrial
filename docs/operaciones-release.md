# Operación y liberación

Esta guía reúne los pasos operativos vigentes y enlaza los contratos canónicos;
no reemplaza las [instrucciones de backend](../backend/README.md), la
[guía de base de datos](../database/README.md) ni los
[contratos REST](README.md#guías-canónicas).

## Instalación limpia local

Requisitos: Git, **Node.js 22.22.2 + npm 10.9.7** (referencia reproducida por CI),
Docker iniciado y Docker Compose. Comprobar `node --version` y `npm --version`.
Los rangos declarados y las restricciones de frontend están en
[backend/README.md](../backend/README.md#requisitos); no asumir compatibilidad de
cualquier versión superior. Los bloques siguientes son para PowerShell; las
variantes Bash de configuración y SQL están en las guías enlazadas.
Desde una consola en una carpeta de trabajo:

```powershell
git clone https://github.com/Sannlehnert/ferrepatagonia-industrial.git
Set-Location ferrepatagonia-industrial
git switch develop
git pull --ff-only origin develop
docker compose config
docker compose up -d --wait --wait-timeout 180 mariadb
Set-Location backend
npm ci
Copy-Item .env.example .env
```

Editar `backend/.env` con valores locales. `.env.example` contiene parámetros
de desarrollo; no copiarlo a producción. Para los secretos, generar un valor
aleatorio privado y guardarlo únicamente en `.env` o en el gestor de secretos
del entorno. Por ejemplo, se puede generar un candidato local con:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

No compartir ni registrar la salida. En particular `JWT_SECRET` no puede quedar
vacío. Configurar `DB_*` para que coincida con MariaDB; para el Compose local,
el host accesible desde el backend es `127.0.0.1:3307`. Las demás variables y
condiciones están documentadas en [backend/README.md](../backend/README.md#configuración).

Para crear un esquema local nuevo, seguir una sola vez el orden
`schema.sql`, `seed.sql`, `verify-seed.sql` de [database/README.md](../database/README.md#3-ejecutar-los-scripts-en-orden).
No repetir esos scripts sobre una base cargada. Arrancar y verificar:

```powershell
npm run build
npm run dev
```

En otra terminal, `curl.exe -i http://localhost:3000/api/health` debe devolver
HTTP 200 y `{"api":"ok","database":"ok"}`. Si la base falla, el API responde
503; consultar el runbook de [arranque y errores](#arranque-fallido-o-health-503). Detener
la base sin borrar datos con `docker compose stop mariadb`; `docker compose down`
conserva el volumen. `docker compose down -v` elimina permanentemente los datos
locales del volumen.

Para usar la interfaz, abrir otra terminal desde la raíz y ejecutar
`cd frontend`, `npm ci`, `npm run dev`. Abrir `http://localhost:5173` y mantener
`APP_PUBLIC_ORIGIN=http://localhost:5173`. Vite reenvía `/api` al backend local
en `http://localhost:3000`; usar las rutas relativas del frontend. Si Vite elige
otro puerto, actualizar el origen y reiniciar el backend antes de escribir.
La política de mismo origen y los ejemplos CLI con Origin están en
[seguridad HTTP común](../backend/README.md#seguridad-http-común).

## Validación antes de liberar

Desde `backend/`, `npm test` realiza build, pruebas unitarias, comprobación de
fuentes DTO e integración en MariaDB desechable. Para frontend, desde `frontend/`:

```powershell
npm ci
npm test
npm run build
```

La suite backend de integración requiere Docker y crea contenedores exclusivos;
la imagen puede crear volúmenes anónimos, que sus helpers retiran con `rm -v`.
No sustituirlos por la base compartida. La evidencia registrada para
#221 está en [docs/221/README.md](221/README.md) y
[docs/221/FIXES-PR44.md](221/FIXES-PR44.md). Los archivos
[full-validation.txt](221/evidence/full-validation.txt) y
[adverse-final.txt](221/evidence/fixes/adverse-final.txt) conservan resultados
de una corrida anterior, no de esta rama ni de CI.

### Corte de integración — 28/10/2026, 17:47 ART

Referencias remotas verificadas antes de estas correcciones: `develop`
`ee5c1ff07bb6451cba7541551cbefae2ab68c558`, `main`
`8187801c4f92154b5f3463ffb684302d41c524ce` y HEAD previo de
[PR #51](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/51)
`79669f47bdfb1e93f89d7d70901a80945ac45099`, abierto sin merge. Es un corte
fechado, no una afirmación de que esas referencias seguirán siendo las últimas.

| Tarea / PR integrado en develop | Merge verificado |
| --- | --- |
| #212 / [#49](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/49) | `16c2b6f1331e58b6bef067ccc027c6375e17fed2` |
| #217 / [#48](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/48) | `b49568f1345ef406df7a365d762211c7f139e75a` |
| #214 / [#47](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/47) | `134f109d49082bf67361b74c143b0d9a1dad559a` |
| #220 / [#52](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/52) | `4ab2b20037669cb67421ecc10b1de432c17b8ad3` |
| #216 / [#50](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/50) | `ee5c1ff07bb6451cba7541551cbefae2ab68c558` |

El workflow versionado es [ci.yml](../.github/workflows/ci.yml). La ejecución
[40761746686](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/40761746686),
evento **push/develop** sobre `ee5c1ff07bb6451cba7541551cbefae2ab68c558`,
terminó SUCCESS: **1.213 backend, 56 frontend, 25 E2E Chromium y 2 cleanup**,
cero FAIL/SKIP. Build, tipos y auditorías npm pasaron; los diagnósticos Docker
de ambos jobs indicaron cero recursos remanentes. Referencia de runtime:
Node 22.22.2/npm 10.9.7. Son resultados de esa ejecución existente, no pruebas
que se atribuyan automáticamente al HEAD final de #51.

El run [40760917528](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/40760917528)
es **pull_request** de #50 sobre `56617774898f709779c0e1f8e114c8139f88b1ed`,
también SUCCESS; es distinto del push/develop anterior. La evidencia de
[#216](216/README.md) y [#217](217/FASE-2B.md) conserva historia y limitaciones
de sus fases. Las notas antiguas “PR abierto” o dependencias pendientes no son
el estado de integración de este corte.

#216, #217 y #220 figuran CERRADA en Taiga al consultar. Esto no certifica el
SHA que se propondrá para main. Para release, obtener el HEAD candidato real,
su CI y revisión humana, y completar el checklist de destino. CI verde no
acredita TLS/proxy productivo, respaldo operativo ni aprobación comercial.

### Ensayo local de las correcciones documentales #218

El 28/10/2026 se verificaron con Node 22.22.2/npm 10.9.7 las instalaciones
`npm ci` de backend/frontend y el build backend. Se ejecutaron **256 pruebas
focalizadas** de configuración, origen, proxy/HTTPS y rate limit: 256 PASS,
0 FAIL/SKIP. No se repitió localmente la suite completa de 1.213 ni los E2E.

Las tres recetas PowerShell de las guías de backend/admin se extrajeron del
Markdown y ejecutaron contra API y MariaDB descartables: registro
201/201/400/400/400, health 200, login/me/logout 200 y creación/PUT/PATCH de
stock/desactivación 201/200/200/200. Los ensayos negativos distinguieron 401,
403 de origen, 403 de rol, fallback Referer y 429 con Retry-After. Se usaron
emails ficticios y claves aleatorias efímeras; no sesiones reales. Se sustituyó
solo el puerto local por uno efímero y el prompt por entrada segura de fixture.

El respaldo con el cliente Docker MariaDB 11.4.13 se copió y restauró en **otro
contenedor** y una base nueva: SHA-256 idéntico en las dos copias y huella de
tablas/DDL/filas igual al origen. Se utilizó la variante automatizada con archivo
de opciones privado, eliminado al terminar; el prompt interactivo y la variante
con cliente instalado en el host quedan **NO VERIFICADOS** en este ensayo.
Se retiraron contenedores, volúmenes anónimos y archivos privados propios.
Esta evidencia local no equivale a validar el entorno de destino ni una
ejecución CI del HEAD final, que debe registrarse en el PR por su SHA exacto.

## Runbooks

### Arranque fallido o health 503

1. Verificar que Docker está iniciado y que `docker compose ps` muestra MariaDB
   `healthy`; si no, revisar `docker compose logs --tail=100 mariadb`.
2. Confirmar `backend/.env` presente, `NODE_ENV` válido, `JWT_SECRET` definido,
   puertos válidos y valores `DB_*` coincidentes con la instancia elegida. No
   copiar valores de un entorno a otro.
3. Si la BD está disponible, probar la consulta con el usuario local:

   ```powershell
   docker compose exec mariadb mariadb -uferrepatagonia -p ferrepatagonia_dev -e "SELECT 1"
   ```

   Completar la contraseña de desarrollo al prompt; no pegar credenciales en
   tickets o logs.
4. Revisar la terminal del servidor. Health 503 significa que no pudo completar
   `SELECT 1`; no confirma que tablas o datos estén cargados.
5. Corregir configuración o disponibilidad y reiniciar de forma normal. No
   eliminar volumen ni recrear datos como primera medida.

### Migración SKU fallida

El procedimiento completo y canónico, sus consultas de pre/post-verificación,
orden, permisos y fixtures aislados están en
[database/README.md, sección “Migrar SKU”](../database/README.md#migrar-sku-en-una-base-existente-197).

Detener escritores y no usar `--force`. La migración contiene `UPDATE` y DDL con
commits implícitos: `ROLLBACK` no revierte la operación. Ante error, conservar
los logs, comprobar la base y el estado del índice, y no reanudar escritores
hasta verificar consistencia. Si hace falta recuperar, restaurar el backup
verificado en una instancia/base aislada primero; solo reemplazar el destino
tras confirmar identidad de host/base, detener escritores y obtener aprobación
operativa. No ensayar restauración ni migración sobre producción como
diagnóstico.

La evidencia disponible corresponde a pruebas de SKU ejecutadas por el helper
de productos administrativos en una MariaDB desechable, documentadas en
[#221](221/README.md#reproducción-segura) y
[evidence/fixes/adverse-final.txt](221/evidence/fixes/adverse-final.txt).
No acredita una migración manual en una base compartida o productiva ni una
aprobación para aplicarla allí.

### Auth, cookies y proxy

1. Confirmar el origen real del frontend y que `APP_PUBLIC_ORIGIN` coincida
   exactamente, sin ruta ni slash final.
2. Comprobar `NODE_ENV`, la cookie `jwt_token` y que el cliente envíe cookies.
   Login válido establece HttpOnly, SameSite Strict; producción agrega Secure.
   No copiar ni inspeccionar el valor JWT en logs.
3. Distinguir **401** de sesión/credenciales, **403** de origen y **403** de rol
   por su mensaje. El control de origen corre antes de autenticar, incluso en
   login y logout. Comprobar Origin, Referer y Fetch Metadata según
   [seguridad HTTP común](../backend/README.md#seguridad-http-común),
   [login](../backend/README.md#login) y
   [productos administrativos](api/admin-productos.md#autenticación-y-errores).
4. En producción, configurar `HTTPS_TERMINATION=trusted-proxy` y los CIDR
   exactos de los proxies confiables en `TRUSTED_PROXY_CIDRS`, confirmados por
   infraestructura. El API exige origen HTTPS, un único proceso y store de
   rate limit `memory`. No confiar en `X-Forwarded-*` ni en rangos supuestos.
5. Consultar logs de infraestructura y `database.query.failed` /
   `database.query.slow`; el logger backend no debe publicar SQL, parámetros ni
   secretos. Reiniciar solo después de corregir la causa, sin desactivar las
   comprobaciones de proxy o seguridad.

### Errores HTTP e incertidumbre de guardado

- **400**: corregir el body/query de acuerdo con su contrato. No reintentar sin
  cambiar la entrada.
- **401**: revisar sesión o credenciales según la ruta; iniciar sesión de nuevo
  cuando corresponda.
- **403** “Origen de solicitud no permitido.”: corregir el contexto HTTP,
  `APP_PUBLIC_ORIGIN` y el proxy de mismo origen. Puede ocurrir sin sesión;
  cambiar roles o repetir login no lo resuelve.
- **403** “El rol autenticado no tiene permiso.”: usar una cuenta autorizada;
  no debilitar middleware ni otorgar permisos para resolver otro tipo de 403.
- **426** “Se requiere HTTPS.”: en producción, verificar TLS en destino y el
  protocolo que recibe Express del proxy realmente confiable. No desactivar
  HTTPS ni ampliar CIDR para forzar el acceso.
- **429** “Demasiadas solicitudes. Intente nuevamente más tarde.”: cuota de
  login/registro agotada; respetar `Retry-After` (segundos). No reenviar en bucle
  ni desactivar el limitador para continuar una prueba.
- **404**: verificar ruta e ID; en rutas admin también confirmar la sesión.
- **409**: resolver la colisión de email o SKU; no asignar IDs ni duplicados.
- **500** genérico: usar logs sanitizados y evidencia de base; no exponer errores
  del driver al cliente.
- **500** “No se pudo confirmar el resultado de la operación…”: resultado
  incierto de escritura/COMMIT. No reenviar automáticamente. Consultar estado
  por ID/SKU/email usando una lectura autorizada; si no se puede determinar,
  escalar para reconciliación con operador antes de repetir. No se promete
  exactly-once ni reversión confirmada ante pérdida de conexión.

## Checklist de release — pendiente de completar

Esta lista es una plantilla, **no una aprobación**. Completarla con evidencia
de la candidata exacta y revisión humana antes de etiquetar o desplegar.

- [ ] Rama y SHA candidato: `<rama>` / `<sha-completo>` (`git rev-parse HEAD`).
- [ ] SHA base actualizado de `develop`: `<sha-completo>`.
- [ ] Build/type-check backend: `<comando, resultado y enlace>`.
- [ ] Pruebas backend unitarias/integración aislada: `<comando, resultado y enlace>`.
- [ ] Pruebas/build frontend: `<comando, resultado y enlace>`.
- [ ] CI de build, tipos y pruebas del **SHA candidato definitivo**: `<workflow, evento, SHA y corrida>`; comparar con el corte de develop, sin reutilizar su aprobación.
- [ ] Revisar resultados de #217 y sus límites de entorno para la candidata; `<evidencia de regresión y riesgos>`.
- [ ] Alineación entre contratos canónicos #155–#159 y runtime auth: login success, logout message, `/me` success/error y envoltura común; `<responsable/decisión/validación>`.
- [ ] Actualización del mock #160 tras resolver la alineación: `<enlace/evidencia>`.
- [ ] Revisión humana de diff, contratos, migración y riesgos: `<revisor, fecha, enlace>`; no marcar sin aprobación registrada.
- [ ] Migración necesaria: `<sí/no, versión y orden>`; ensayo solo en base aislada, `<evidencia>`.
- [ ] Respaldo: `<ubicación protegida, fecha, responsable>` y prueba de restauración en instancia aislada: `<resultado>`.
- [ ] Ventana, responsables y verificación post-release: `<pendiente de asignar>`.
- [ ] TLS/proxy, CIDR, ACL del backend y origen/cookies en el destino real: `<NO VERIFICADO hasta ensayo en destino>`.
- [ ] Smoke tests en destino sobre el SHA desplegado: `<responsable, resultado y enlace>`.
- [ ] Validación comercial de precios por el cliente: `<confirmación pendiente>`; el cierre administrativo de #207/#208 no la sustituye.
- [ ] Rollback: `<procedimiento y responsable>`; para la migración SKU, backup restaurable validado y escritores detenidos, no `ROLLBACK` SQL.
- [ ] Riesgos aceptados y pendientes: `<lista y responsable>`.

### Referencias de decisiones y estado

- [#207](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/207):
  [spike FER-15](spikes/fer-15-modelo-listas-precios.md) es la propuesta vigente;
  la política de precios sigue pendiente de validación del cliente. Taiga figura
  CERRADA administrativamente en el corte anterior; no implica validación comercial.
- [#208](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/208):
  Taiga figura CERRADA, pero sus comentarios distinguen aprobación interna de
  validación del cliente pendiente; no equivale a aprobación comercial final.
  No cambiar el comportamiento documentado en el [contrato del catálogo](api/catalogo.md)
  hasta que se registre la validación correspondiente.
- [#211](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/211):
  el endpoint `GET /api/categorias` y su contrato están presentes en
  `develop` ([documentación](api/categorias.md)); Taiga figura CERRADA al consultar.
  No se redefine su respuesta ni se cambia su estado.
- Las integraciones #212/#214/#217/#216/#220 se verifican por sus merges y CI
  en el corte fechado. Esta guía no mueve Sprint 4 ni cierra tareas. Reconfirmar
  las referencias si el tablero o las ramas cambian.

## Entrega documentada y coordinación con #219

La descripción original de #218 menciona entrega a “4.5-08”. El tablero actual
usa ese número para #220 (Home), ya integrada; la auditoría develop→main es
[#219 / 4.5-09](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/219).
Coordinar por referencia explícita sin renumerar ni mover las tareas.

Quedan registrados para la siguiente tarea, sin afirmar asignación ni
resolución:

- Contratos de autenticación #155–#159 frente al runtime: formato de éxito de
  login, texto de logout, forma de `/me`, texto de sesión inválida y consistencia
  global de errores.
- Mock #160: actualizar solo después de acordar y probar el contrato compatible.
- Contrato admin: el archivo de esta tarea refleja rutas y validaciones del
  código de `develop`; contrastarlo con cualquier contrato canónico del equipo
  antes de tratarlo como decisión aprobada.
- Completar la evidencia release: SHA candidato definitivo y su corrida CI,
  revisión humana, respaldo restaurable y responsables de despliegue/rollback.
