# Operación y liberación

Esta guía reúne los pasos operativos vigentes y enlaza los contratos canónicos;
no reemplaza las [instrucciones de backend](../backend/README.md), la
[guía de base de datos](../database/README.md) ni los
[contratos REST](README.md#guías-canónicas).

## Instalación limpia local

Requisitos: Git, Node.js 22 o superior, npm, Docker iniciado y Docker Compose.
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
503; consultar el runbook de [arranque y errores](#arranque-y-errores). Detener
la base sin borrar datos con `docker compose stop mariadb`; `docker compose down`
conserva el volumen. `docker compose down -v` elimina permanentemente los datos
locales del volumen.

## Validación antes de liberar

Desde `backend/`, `npm test` realiza build, pruebas unitarias, comprobación de
fuentes DTO e integración en MariaDB desechable. Para frontend, desde `frontend/`:

```powershell
npm ci
npm test
npm run build
```

La suite backend de integración requiere Docker y crea su propio contenedor sin
volumen; no sustituirla por la base compartida. La evidencia registrada para
#221 está en [docs/221/README.md](221/README.md) y
[docs/221/FIXES-PR44.md](221/FIXES-PR44.md). Los archivos
[full-validation.txt](221/evidence/full-validation.txt) y
[adverse-final.txt](221/evidence/fixes/adverse-final.txt) conservan resultados
de una corrida anterior, no de esta rama ni de CI.

**Estado de CI:** la tarea 4.5-05 sigue *In progress* según el estado recibido.
En `develop` no hay workflow de GitHub Actions u otra definición CI versionada.
Por lo tanto, no afirmar que CI ejecutó o aprobó estos cambios; registrar sus
enlaces/resultados cuando exista una corrida.

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
3. **401** indica que falta sesión válida; **403** que la sesión no tiene el rol
   requerido. Ver contratos en [backend/README.md](../backend/README.md#login-y-logout)
   y [productos administrativos](api/admin-productos.md#autenticación-y-errores).
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
- **401 / 403**: renovar el inicio de sesión o usar una cuenta con el permiso
  correcto; no debilitar middleware.
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
- [ ] CI de build, tipos y pruebas: `<workflow y corrida>`; **pendiente** mientras 4.5-05 siga *In progress*.
- [ ] Resultado 4.5-06: `<estado y evidencia aún no informados>`.
- [ ] Alineación entre contratos canónicos #155–#159 y runtime auth: login success, logout message, `/me` success/error y envoltura común; `<responsable/decisión/validación>`.
- [ ] Actualización del mock #160 tras resolver la alineación: `<enlace/evidencia>`.
- [ ] Revisión humana de diff, contratos, migración y riesgos: `<revisor, fecha, enlace>`; no marcar sin aprobación registrada.
- [ ] Migración necesaria: `<sí/no, versión y orden>`; ensayo solo en base aislada, `<evidencia>`.
- [ ] Respaldo: `<ubicación protegida, fecha, responsable>` y prueba de restauración en instancia aislada: `<resultado>`.
- [ ] Ventana, responsables y verificación post-release: `<pendiente de asignar>`.
- [ ] Rollback: `<procedimiento y responsable>`; para la migración SKU, backup restaurable validado y escritores detenidos, no `ROLLBACK` SQL.
- [ ] Riesgos aceptados y pendientes: `<lista y responsable>`.

### Referencias de decisiones y estado

- [#207](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/207):
  [spike FER-15](spikes/fer-15-modelo-listas-precios.md) es la propuesta vigente;
  la política de precios sigue pendiente de validación del cliente.
- [#208](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/208):
  la aprobación indicada es interna; no equivale a aprobación del cliente.
  No cambiar el comportamiento documentado en el [contrato del catálogo](api/catalogo.md)
  hasta que se registre la validación correspondiente.
- [#211](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/211):
  el endpoint `GET /api/categorias` y su contrato están presentes en
  `develop` ([documentación](api/categorias.md)). La verificación del tablero
  Taiga y su estado administrativo no está incluida en esta evidencia.
- 4.5-01/02/03: se informan como cerradas; 4.5-05 sigue *In progress*. El
  estado de 4.5-04 y 4.5-06 no fue informado y no se presume. Esta guía no
  mueve Sprint 4 ni cierra #207, #208 o #211.

## Entrega documentada a 4.5-08

Quedan registrados para la siguiente tarea, sin afirmar asignación ni
resolución:

- Contratos de autenticación #155–#159 frente al runtime: formato de éxito de
  login, texto de logout, forma de `/me`, texto de sesión inválida y consistencia
  global de errores.
- Mock #160: actualizar solo después de acordar y probar el contrato compatible.
- Contrato admin: el archivo de esta tarea refleja rutas y validaciones del
  código de `develop`; contrastarlo con cualquier contrato canónico del equipo
  antes de tratarlo como decisión aprobada.
- Completar la evidencia release: SHA candidato, corrida CI cuando exista,
  revisión humana, respaldo restaurable y responsables de despliegue/rollback.
