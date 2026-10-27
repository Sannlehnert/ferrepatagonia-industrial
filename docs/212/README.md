# #212 — Auditoría y remediación de `body-parser` y dependencias backend

## 1. Contexto y entorno registrado

- **Sprint:** 4.5 — Estabilización previo al merge `develop` -> `main` (4.5-01 / #212).
- **Commit base inspeccionado (`develop`):** `8080f210be80162048fb73420bc825369c9bc855` (incluye #221 / 4.5-03 TypeORM y #222 / 4.5-05 DTOs `class-validator` ya integrados).
- **Rama de trabajo (Gitflow):** `fix/212-audit-body-parser` (destino: `develop`).
- **Entorno de ejecución:** Windows (PowerShell), Node `v24.14.0`, npm `11.9.0`, Docker `mariadb:11.4` (`11.4.13-MariaDB-ubu2404`). Sin uso de `.env` ni credenciales reales.
- **Restricciones operativas respetadas:** No se cierran ni mueven tarjetas del Sprint 4 ni `#207`, `#208` o `#211`.

---

## 2. Informe Antes / Después

| Aspecto | Antes (`8080f210be80162048fb73420bc825369c9bc855`) | Después (`fix/212-audit-body-parser`) |
|---|---|---|
| **Paquete auditado** | `body-parser@2.3.0` | `body-parser@2.4.0` |
| **Tipo y cadena de dependencia** | Transitiva: `ferrepatagonia-backend@0.1.0` -> `express@5.3.0` -> `body-parser@2.3.0` | Transitiva: `ferrepatagonia-backend@0.1.0` -> `express@5.3.0` -> `body-parser@2.4.0` |
| **Alcance** | Producción (`dependencies`) | Producción (`dependencies`) |
| **Resultado `npm audit` (backend)** | `1 high severity vulnerability` (`GHSA-27r3-jxmh-p828`, rango afectado `2.0.0 - 2.3.0`: *Denial of Service via trailing bytes after a compressed request body*) | `found 0 vulnerabilities` (0 críticas, 0 altas, 0 moderadas, 0 bajas) |
| **Cambios en `backend/package.json`** | Sin cambios | Sin cambios (`express` conserva `^5.1.0`, resuelto en `5.3.0`) |
| **Cambios en `backend/package-lock.json`** | `node_modules/body-parser` en `2.3.0` | Actualización exclusiva de `node_modules/body-parser` a `2.4.0` |

### Evaluación de actualización mínima y justificación del lockfile

- `body-parser` no es dependencia directa en `backend/package.json`; ingresa de forma transitiva a través de `express@5.3.0` en alcance de producción (`dependencies`).
- Se aplicó `npm update body-parser` sin `--force` ni `overrides`, actualizando únicamente la entrada `node_modules/body-parser` de `2.3.0` a `2.4.0` en `backend/package-lock.json`.
- Los rangos declarados por `body-parser@2.4.0` (`content-type: ^2.1.0`, `iconv-lite: ^0.7.3`, `qs: ^6.16.1`) ya estaban satisfechos por las versiones instaladas en el lockfile de `develop`, por lo que ningún otro paquete del árbol cambió de versión.

### Riesgos u observaciones remanentes

- **Vulnerabilidades en `npm audit`:** `0` vulnerabilidades reportadas en el árbol de `backend/`. No quedan riesgos altos ni críticos abiertos.
- **Aviso de deprecación en instalación (`glob@10.5.0`):** Durante `npm ci` npm emite un warning de deprecación sobre `glob@10.5.0` (`typeorm@0.3.31` -> `glob@10.5.0`). No registra vulnerabilidades en `npm audit` y pertenece al árbol interno de `typeorm@0.3.31` validado en `#221` (4.5-03). Siguiendo el criterio de no aplicar actualizaciones forzadas indiscriminadas ni `overrides` mayores que alteren el ORM, se mantiene intacto.

---

## 3. Verificación reproducible y coordinación de regresión (4.5-03 y 4.5-05)

La verificación se ejecutó sobre el commit que ya integra `#221` (4.5-03 TypeORM + MariaDB) y `#222` (4.5-05 validación con DTOs `class-validator`), confirmando compatibilidad completa con el parser de Express 5 y el manejo de errores de body JSON:

| Comprobación | Comando | Resultado |
|---|---|---|
| Instalación limpia y reproducible | `npm ci` | PASS (209 paquetes añadidos, 210 auditados, `found 0 vulnerabilities`) |
| Auditoría de seguridad | `npm audit` | PASS (`found 0 vulnerabilities`) |
| Build y chequeo de tipos TypeScript | `npm run build` (`tsc`) | PASS |
| Pruebas unitarias y contratos HTTP | `npm run test:unit` | PASS (`502 PASS, 0 FAIL, 0 SKIP`) |
| Pruebas de DTOs sobre fuentes (`tsx`) | `npm run test:dto-source` | PASS (`1 PASS, 0 FAIL, 0 SKIP`) |
| Integración MariaDB (admin, auth, catálogo, clientes, ORM, transacciones) | `node test/helpers/run-admin-products-mariadb.cjs` | PASS (`47 PASS, 0 FAIL, 0 SKIP`, schema hash `7a9e0906...` `unchanged: true`) |
| Integración MariaDB (categorías) | `node test/helpers/run-category-mariadb.cjs` | PASS (`8 PASS, 0 FAIL, 0 SKIP`, schema hash `7a9e0906...` `unchanged: true`) |
| Higiene de git | `git diff --check` | PASS |

### Higiene de datos y credenciales

- Las pruebas de integración utilizaron contenedores efímeros `mariadb:11.4` con bases y puertos aleatorios en loopback generados por los helpers existentes (`run-admin-products-mariadb.cjs` y `run-category-mariadb.cjs`).
- Las evidencias en `docs/212/evidence/` contienen únicamente salidas de versión, árbol de paquetes, auditoría npm y el diff del lockfile, sin credenciales, tokens ni datos reales.
