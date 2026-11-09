# #254 · Auditoría de identidades Git, ramas y protecciones

**Corte** 9 de noviembre de 2026, 12:28 (Buenos Aires)

**Conclusión** PENDIENTE DE DATOS

| Referencia | SHA |
| --- | --- |
| `develop` | `fbffe57bbfb52cc59d5b52c5babae28fe1349c4d` |
| `main` | `93b00b65f8767685757628b15c69198b0d5ac099` |
| Ancestro común | `08dc74692eef5ad3153b543f4414b483d53a818a` |

El inventario y las comparaciones provienen de la API de GitHub. Las comprobaciones de configuración se limitaron a dos copias de trabajo accesibles. El corte es anterior a la publicación de este informe. [Tarea #254](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/254) · [Ramas del repositorio](https://github.com/Sannlehnert/ferrepatagonia-industrial/branches)

## Identidades Git

Se revisaron autor y committer de 181 commits, los 170 exclusivos de `develop` frente a `main` y los 11 que devuelven los PR abiertos. Las cifras siguientes cuentan roles por separado. La asociación remota se basa en las cuentas que devolvió GitHub.

| Identidad observada | Cuenta en GitHub | Autor / committer | Configuración local |
| --- | --- | ---: | --- |
| Santiago Agustin Lehnert | `Sannlehnert` | 51 / 43 | Verificada en las dos copias auditadas. Ambos valores locales están sin definir y se heredan de la configuración global. El correo efectivo coincide con los commits de #75 y #84. Se confirmó también la identidad efectiva de autor y committer con #84. |
| Lucciano Perticarini | `Luxon743` | 72 / 61 | PENDIENTE DE VERIFICACIÓN. Dos correos observados, ambos asociados a la misma cuenta. |
| Bruno / Bruno Ignacio Vagnola | `brunovagnola` | 30 / 15 | PENDIENTE DE VERIFICACIÓN. Las dos variantes de nombre y correo se vinculan a la misma cuenta. |
| ZazaaZack | `ZazaaZack` | 9 / 0 | PENDIENTE DE VERIFICACIÓN. Hay también 19 commits con este mismo nombre y un correo de ejemplo que GitHub no atribuye a su cuenta. |
| ZazaaZack, correo de ejemplo | `invalid-email-address` | 19 / 19 | Atribución por confirmar con el integrante. Ejemplos [`6c0de87d`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/6c0de87d), [`2681f5c4`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/2681f5c4) y [`9a64db3a`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/9a64db3a). |
| GitHub | `web-flow` | 0 / 43 | Identidad automática de GitHub en merges desde la web. |

Cada integrante pendiente debe ejecutar los dos comandos de configuración local que figuran al final desde su copia del repositorio. Si no devuelven valores, corresponde comprobar la configuración global y la identidad efectiva. Basta informar si el correo está asociado a su cuenta de GitHub.

## Ramas remotas

La tabla usa conteos por ascendencia respecto de cada destino. Los tres PR abiertos tienen commits fuera de ambas ramas permanentes y el SHA de cada PR coincide con la punta de su rama remota. [PR abiertos](https://github.com/Sannlehnert/ferrepatagonia-industrial/pulls?q=is%3Apr+is%3Aopen)

| Rama | Último commit | PR asociado | Frente a `develop` | Frente a `main` | Recomendación |
| --- | --- | --- | --- | --- | --- |
| `develop` | [`fbffe57b`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/fbffe57bbfb52cc59d5b52c5babae28fe1349c4d) | [#81](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/81), fusionado en `develop` | Referencia | No es ancestro de `main` | CONSERVAR · permanente |
| `feature/FER-24-273-client-orders-api` | [`ac456de7`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/ac456de7de4416be75b437be78377f0afc1b3083) | [#82](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/82), abierto hacia `develop` | 4 por delante / 15 por detrás | 159 por delante / 5 por detrás | CONSERVAR |
| `feature/253-account-seed-tests` | [`587bc1e4`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/587bc1e4a7d4b5f28fd1b10b289c28e253b9555e) | [#75](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/75), abierto hacia `develop` | 6 por delante / 0 por detrás | 176 por delante / 5 por detrás | CONSERVAR |
| `main` | [`93b00b65`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/93b00b65f8767685757628b15c69198b0d5ac099) | [#57](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/57), fusionado en `main` | No es ancestro de `develop` | Referencia | CONSERVAR · permanente |
| `test/263-credit-order-integrity` | [`2d9e1128`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/2d9e11281f159df306571ec5dd5f0828298b056c) | [#84](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/84), abierto hacia `develop` | 1 por delante / 0 por detrás | 171 por delante / 5 por detrás | CONSERVAR |

- **Permanentes** 2. **Con PR abierto** 3, todas con trabajo pendiente de integración.
- **Trabajo sin integrar y sin PR abierto** 0. **Fusionadas candidatas a limpieza** 0. **Antiguas sin PR** 0. **Inciertas** 0.
- **Candidatas a limpieza** ninguna. Las ramas de los PR #80, #81 y #83, fusionados en `develop`, ya estaban ausentes del inventario remoto. Para futuras limpiezas, un PR cerrado sin merge requiere comprobar qué trabajo queda fuera de ambas ramas.

## Protecciones de `main` y `develop`

| Control | `main` | `develop` |
| --- | --- | --- |
| Rama protegida y protección habilitada | Sí | Sí |
| Push directo | PR obligatorio. Sin lista adicional de actores autorizados a hacer push | Igual |
| Aprobaciones | 1. Se descartan aprobaciones obsoletas. Sin revisión obligatoria de CODEOWNERS ni aprobación separada del último push | Igual |
| Checks obligatorios | Backend y Frontend | Igual |
| Exigir rama al día antes de fusionar | Sí, checks en modo estricto | Sí, checks en modo estricto |
| Force-push | Bloqueado | Bloqueado |
| Eliminación | Bloqueada | Bloqueada |
| Administradores y bypass | La protección se aplica a administradores. La respuesta no lista actores con bypass del PR obligatorio | Igual |

Los contextos exactos son `Backend CI (Node 22 + MariaDB + E2E & Cleanup)` y `Frontend CI (Node 22 + Vite + Playwright E2E)`. La integración inicial devolvió HTTP 403 para el detalle clásico. La consulta directa autenticada devolvió HTTP 200 y confirmó las protecciones de ambas ramas. La lista de rulesets con herencia y las reglas efectivas por rama devolvieron listas vacías. [Protección de main](https://api.github.com/repos/Sannlehnert/ferrepatagonia-industrial/branches/main/protection) · [Protección de develop](https://api.github.com/repos/Sannlehnert/ferrepatagonia-industrial/branches/develop/protection) · [Rulesets](https://github.com/Sannlehnert/ferrepatagonia-industrial/rules)

Para repetir la revisión visual con una cuenta administradora, abrir [Settings → Branches](https://github.com/Sannlehnert/ferrepatagonia-industrial/settings/branches) y consultar las reglas que coinciden con `main` y `develop`. Los rulesets se consultan en **Settings → Rules → Rulesets**.

## Divergencia e integración

`main...develop` da **5 commits exclusivos de `main` y 170 de `develop`**. Los exclusivos de `main` son:

| Commit | Motivo |
| --- | --- |
| `4613e0af` | Merge de MariaDB Compose, PR [#6](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/6). |
| `e08bc958` | Reversión del merge de #6. |
| `8187801c` | Merge de la reversión, PR [#7](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/7). |
| `17e1696c` | Integración de `develop` en la candidata de release y recuperación de archivos, PR [#57](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/57). |
| `93b00b65` | Merge de la release 4.5, PR [#57](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/57). |

El árbol de `main` y el del ancestro común tienen el mismo SHA (`436e04204a3f96b7020553d03762d1b5d0990dc0`). Los cinco commits representan divergencia de historial sin cambio neto de archivos en `main` desde esa base. GitHub devuelve 237 archivos cambiados en el lado de `develop`. [Comparación main → develop](https://github.com/Sannlehnert/ferrepatagonia-industrial/compare/93b00b65f8767685757628b15c69198b0d5ac099...fbffe57bbfb52cc59d5b52c5babae28fe1349c4d) · [Comparación inversa](https://github.com/Sannlehnert/ferrepatagonia-industrial/compare/fbffe57bbfb52cc59d5b52c5babae28fe1349c4d...93b00b65f8767685757628b15c69198b0d5ac099)

- El alcance acumulado incluye importación, listas de precios, carrito, migraciones de cuenta corriente y confirmación de pedidos. En la tarea de integración conviene comprobar los checks y el orden de despliegue de migraciones sobre el candidato de release.
- #253 y #263 seguían abiertos en [#75](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/75) y [#84](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/84). Una promoción del SHA auditado no incluiría sus commits exclusivos. [#82](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/82) también está abierto y su rama queda 15 commits detrás de `develop`.
- Para cerrar la auditoría de identidades faltan las comprobaciones locales de tres integrantes y la confirmación de atribución de los commits con correo de ejemplo.

### Trazabilidad de PR desde la release #57

Todos los PR de esta tabla tienen como base `develop`. Los SHA de merge identifican los cambios integrados aunque su rama remota ya no exista.

| PR | Tarea o alcance | Estado en el corte |
| --- | --- | --- |
| [#58](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/58) | 239 | Fusionado · [`9799d5b5`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/9799d5b5a714d42f6529aa21d518cb0b44675c5f) |
| [#59](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/59) | Seguridad de dependencias | Fusionado · [`77919e78`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/77919e7887eefae8484cb35afaf11695d9cf52c9) |
| [#60](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/60) | 237 | Fusionado · [`d4a79991`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/d4a799917a7916da7e5620d94139099e87834e38) |
| [#61](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/61) | 235 | Fusionado · [`e651b3e1`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/e651b3e1fd27870db224966f864208500db441d3) |
| [#62](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/62) | 234 | Fusionado · [`d27c1c70`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/d27c1c704ee7821720734f275cfc3d5b0db93c3a) |
| [#63](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/63) | 240 | Fusionado · [`2ea4a33e`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/2ea4a33e0bf6cde264d0fb256e999645ea4f3f86) |
| [#64](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/64) | 241 | Fusionado · [`8c6d1c39`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/8c6d1c39003d5b0ee29ce65ec570f66b440ae053) |
| [#65](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/65) | 236 | Fusionado · [`fcda2247`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/fcda2247b4960dcd2aeeb2a1ed463bed640d0e45) |
| [#66](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/66) | 245 | Fusionado · [`808d54e1`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/808d54e1b5a927e63ee3bd36ed153f3fbdedba55) |
| [#67](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/67) | 242 | Fusionado · [`3af31d71`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/3af31d714279b5df87481465a65368dd316c5c16) |
| [#68](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/68) | 243 | Fusionado · [`48eb3cdc`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/48eb3cdc725026c44bd69c2f04c1b20196f691e6) |
| [#69](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/69) | 247 | Fusionado · [`eecc21ac`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/eecc21acf730b536c9e42b7dc3cd5a5a08ec9cab) |
| [#70](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/70) | 250 | Fusionado · [`a0cc7c6b`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/a0cc7c6b3e7c225ad0920d43eff445e87c34de78) |
| [#71](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/71) | 246 | Fusionado · [`c082edb3`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/c082edb32ca8d2b0400fe138e7093105ddb8ce36) |
| [#72](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/72) | 244 | Fusionado · [`2b178eea`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/2b178eea65ffbd964c6ab9ba4a0214d17c7fcd15) |
| [#73](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/73) | 260 | Fusionado · [`cc29774e`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/cc29774e005edaa6ab392ba412a7890d07fcbcd7) |
| [#74](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/74) | 249 | Fusionado · [`f71f8350`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/f71f835088cd246621ac010c081c59db2f7ad71a) |
| [#75](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/75) | 253 | Abierto |
| [#76](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/76) | 248 | Fusionado · [`56e5e814`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/56e5e8147251f5197ac7a4ccd3b6ced3983e9055) |
| [#77](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/77) | 261 | Fusionado · [`4af931e9`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/4af931e96c8978a65c99ca58ca0eeaac47d243cc) |
| [#78](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/78) | 258 | Fusionado · [`f0f06d17`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/f0f06d1727a0af5ac9bcb1586e9d713afc9c3b83) |
| [#79](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/79) | 251 | Fusionado · [`151339d1`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/151339d1640a9498118c53b3c0106db0f3278f55) |
| [#80](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/80) | 252 | Fusionado · [`d5c7da08`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/d5c7da083505dbba04048dae416190bdbfdbd8c5) |
| [#81](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/81) | 262 | Fusionado · [`fbffe57b`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/fbffe57bbfb52cc59d5b52c5babae28fe1349c4d) |
| [#82](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/82) | 273 | Abierto |
| [#83](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/83) | 252 · H04 | Fusionado · [`34c99bb5`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/34c99bb5c96873f626545a7173e902af1033d05a) |
| [#84](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/84) | 263 | Abierto |

## Cómo repetir las comprobaciones

Ejecutar en una copia de trabajo autorizada. Los comandos de identidad pueden mostrar datos personales. Al compartir el resultado, indicar la fuente de configuración y la asociación con GitHub sin copiar correos.

```bash
git config --local --get user.name
git config --local --get user.email
git config --global --get user.name
git config --global --get user.email
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT

git ls-remote --heads origin
git fetch origin
git rev-list --left-right --count origin/main...origin/develop
git log --left-right --oneline origin/main...origin/develop
git log --format='%h %an | %cn' origin/main..origin/develop
git diff --stat origin/main origin/develop
git merge-base --is-ancestor <sha-rama> origin/develop
git merge-base --is-ancestor <sha-rama> origin/main
```

Con GitHub CLI autenticada en el repositorio, consultar:

```bash
gh pr list --state open --limit 100
gh pr view 75 --json state,mergedAt,headRefName,headRefOid,baseRefName
gh pr view 84 --json state,mergedAt,headRefName,headRefOid,baseRefName
gh api 'repos/{owner}/{repo}/branches?per_page=100' --paginate
gh api 'repos/{owner}/{repo}/compare/main...develop'
gh api 'repos/{owner}/{repo}/branches/main/protection'
gh api 'repos/{owner}/{repo}/branches/develop/protection'
gh api 'repos/{owner}/{repo}/rulesets?includes_parents=true'
gh api 'repos/{owner}/{repo}/rules/branches/main'
gh api 'repos/{owner}/{repo}/rules/branches/develop'
```
