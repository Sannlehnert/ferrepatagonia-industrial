# #253 · Seed y pruebas de cuenta corriente

Entrega parcial: no acredita la aceptación completa de FER-19. Contrato: [#250](contratos/fer-19-cuenta-corriente.md). Taiga denomina esta tarea **S5-19.5** (el pedido inicial decía S5-19.4).

## Base y dependencias verificadas el 7 de noviembre de 2026

| Dependencia | Estado inspeccionado |
| --- | --- |
| `develop` | `2b178eea65ffbd964c6ab9ba4a0214d17c7fcd15`; #250 integrado por PR #70 |
| #260 / PR #73 | Abierto, Draft, `a85a01746ea4e3557bba06d31a625737dba9de04`; modelo/repositorio base, sin cobertura ni FIFO persistidos |
| #251 | Rama `feature/FER-19-251-client-account-api`, `406f5ad5005d1900f50818428fbcbf58fa0abeb9`; sin PR encontrado, Taiga En curso. Rutas reales con detalles todavía vacíos |
| #258 | Taiga Nueva; sin rama/PR/implementación encontrados |
| #261 | Taiga Nueva; sin rama/PR/implementación encontrados |
| #252 / pantallas | Sin rutas/vistas de cuenta corriente CLIENTE/ADMIN. `frontend/src/config/menu.ts` las declara pendientes |

## Ejecutar sin tocar una base del equipo

Requiere Docker local, Node >=22 y `npm ci` en `backend`. No utiliza Docker Compose, credenciales operativas ni `database/seed.sql`.

```sh
cd backend
npm run build
npm run test:account:safety    # sin Docker ni conexión a BD
npm run test:account:cleanup   # dos contenedores simultáneos; uno falla deliberadamente
npm run test:account:isolated  # seed + persistencia disponible; requiere #260
npm run test:account:contract  # expectativas #250; hoy termina en error por diferencias de #260
npm run test:account:client    # HTTP/Passport reales; requiere además #251; hoy termina en error
```

Cada comando con BD crea su propio MariaDB **11.4**, con base `account_test_<UUID>`, credencial aleatoria, puerto dinámico publicado exclusivamente en `127.0.0.1`, etiqueta de propiedad y datos en tmpfs. Antes de conectar y antes de cada seed/limpieza se comprueban ID, nombre, etiqueta, imagen, base, puerto, loopback, estado y ausencia de montajes persistentes. El seed solo acepta una sesión creada por ese helper, comprueba `DATABASE()` y exige tablas vacías. No se exporta una entrada CLI que acepte un host/base elegidos por el operador.

El runner sobrescribe las variables DB/JWT y el path de dotenv del proceso hijo; el fixture no carga `.env`. Ejecuta el esquema real y la migración de #260 dos veces. Ante esquema/módulo faltante falla antes de crear recursos. `finally` elimina únicamente el ID propio con su etiqueta verificada y comprueba su ausencia, también ante error de pruebas; maneja SIGINT/SIGTERM y limita la suite a tres minutos. No hay volúmenes de datos. Una terminación forzada del proceso/host no puede ejecutar `finally`: para recuperación, inspeccionar la etiqueta `ferrepatagonia.account-test` y borrar únicamente el contenedor de esa corrida.

El comando de seed es `test:account:isolated`: siembra, comprueba y descarta. No deja una BD ni usuarios DEMO accesibles al equipo.

## Escenarios sintéticos

`database/fixtures/fer19-demo.cjs` inserta 11 clientes, sus usuarios CLIENTE y un ADMIN. Usa emails `@example.test`, bcrypt de prueba, fechas fijas y montos USD exactos en cadenas. Obtiene IDs de los INSERT; nunca supone autoincrementales fijos. Los usuarios sirven para login real exclusivamente dentro de la BD descartable.

| Clave | Intención del escenario | Datos conocidos |
| --- | --- | --- |
| particular | Sin cuenta | Sin movimientos |
| empresa30 | Empresa aprobada, límite 1000.00, plazo previsto 30 | Cargos 350.00; abonos 125.00; neto 225.00; disponible 775.00 |
| empresa60 | Otra cuenta, límite 2000.00, plazo previsto 60 | Cargo 600.10; abono 100.10; neto 500.00 |
| inhabilitada | Historial consultable, crédito bloqueado | Deuda 70.00; disponible operativo 0.00 |
| vacia | Alta sintética sin operaciones previas | Neto del fixture 0.00; límite 300.00 |
| incompleta | Sin apertura conciliada | Un cargo conocido de 40.00; saldo contractual desconocido |
| favor | Abono sin deuda previa | Saldo contractual -150.00; límite 100.00 |
| cero | Límite comercial cero | Crédito bloqueado |
| pendiente | Empresa pendiente con cuenta existente | Historial conservado; compra no autorizada |
| usuario-inactivo / cliente-inactivo | Seguridad | Identidades y relaciones reales |

Incluye cargos anulados, abono anulado, pagos pendientes/rechazados sin movimiento, fechas límite vencidas, del día y futuras. Corte previsto: `2026-03-03T03:00:00Z` (3 de marzo civil argentino). Bajo FIFO, los 125.00 cancelarían el cargo de 100.00 y abonarían 25.00 al de 200.00: **no se persisten imputaciones ficticias**, porque la dependencia no ofrece ese modelo.

**Límite del esquema actual:** cobertura, origen DEMO de cuenta, plazo comercial y conciliación son intenciones del manifest; no existen columnas para acreditarlos en #260. Observaciones DEMO no son evidencia productiva ni habilitan crédito. Tampoco se convierte el seed histórico general en deuda. El fixture deberá adaptarse al modelo definitivo antes de certificar resumen, vencimientos/FIFO o E2E.

## Pruebas y diferencias reproducidas

`account.seed.mariadb.test.cjs` ejerce el repositorio real: repetición con IDs diferentes, rechazo de doble carga, rollback del seed provocado por trigger, esquema ausente, FK/UNIQUE/CHECK, importes DECIMAL, sumas de centavos, anulados excluidos, pagos no acreditados excluidos, cuentas separadas, sobregiro, dos cargos concurrentes y rollback externo. Cada caso reconstruye el fixture; no depende del orden anterior. Los esperados son literales independientes del algoritmo productivo.

`account.contract.mariadb.test.cjs` mantiene expectativas contractuales reales y **no omite ni invierte fallas**. En `a85a017` se reproducen:

| Área pendiente | Resultado real frente al contrato | Código dependiente |
| --- | --- | --- |
| Saldo a favor | Devuelve 0.00 en lugar de -150.00; tras cargo 25.00 devuelve 0.00 en lugar de -125.00 | `calcularEstadoCuenta`, #260 |
| Cobertura | Devuelve 40.00 pese a apertura no acreditada, donde corresponde null | Modelo y repositorio, #260 |
| Moneda | Un cargo ARS de 100.00 entra en total USD: 350.00 en lugar de 250.00 | Agregación, #260 |
| Idempotencia | El reintento idéntico arroja duplicado en vez de devolver el resultado previo | Registro, #260/#261 |
| Propiedad | Acepta pedido del cliente B en cuenta A; ABONO sin pago también permitido | Registro/DDL, #260/#261 |
| Entrada monetaria | Acepta `1e1` y `0x10` como importes; `0.001` se rechaza por CHECK tras redondeo a cero | DTO/registro, #260/#261 |
| Plazo | Acepta cargo sin plazo y plazos 1, 31 y 90 | Registro/configuración comercial, #260/#261 |
| Calendario | `2026-02-01T02:59:59Z` +30 produce 03/03 en lugar de 02/03; `2026-01-01T02:59:59Z` +60 produce 02/03 en lugar de 01/03 | Fecha del servidor, #260/#261 |

Los demás vectores fijos incluyen fin de mes, cambio de año, febrero común/bisiesto y la medianoche exacta BA. Se controla Date y se fuerza TZ UTC para detectar dependencia del servidor. La implementación usa `Number` para dinero: los casos básicos y límites ejercitados no certifican exactitud arbitraria de acumulados grandes.

`account.client.mariadb.test.cjs` usa el app Express, Passport JWT y MariaDB reales: visitante, ADMIN en ruta propia, usuario inactivo, token expirado, particular, dos titulares, cuenta inhabilitada, anti-IDOR por parámetros, límites, cursor alterado, headers privados, login/logout/login A→B y error SQL real. En `406f5ad` fallan tres expectativas: cliente inactivo recibe 200/SIN_CUENTA, movimientos sembrados devuelven `[]` en vez de página, y cursor repetido recibe 200 en lugar de 400. Esto **no** prueba pantallas, caché frontend ni respuestas tardías.

## Matriz de integración restante

| Casos preparados para ejecución posterior | Dependencia necesaria |
| --- | --- |
| Saldo/limite null vs cero acreditado, origen DEMO, bloqueo por elegibilidad | Evidencia/conciliación/plazo en #260; resumen #251/#258; confirmación #261 |
| FIFO parcial/total, saldo a favor consumido, anulaciones y redistribución auditada | Escrituras, imputaciones y revisión #260/#261 |
| Vencido al día siguiente; vence hoy; cancelado/anulado excluido; cambio de plazo conserva fecha original | Fechas civiles/plazo histórico/remanentes persistidos #260/#261; consulta #251/#258 |
| Movimientos fecha UTC DESC/ID DESC; páginas inicial/siguiente/final; default 25, límites 1/100; sin duplicados/saltos | Lectura real por clave #251; 105 cargos de centavo reutilizables del caso de volumen |
| Cursores ajenos/alterados/caducados; mutación entre páginas; revisión/corte consistentes y 409 | Revisión persistente y cursor por clave #260/#251; #251 actual declara offset y revisión de id/habilitada |
| Vencimientos fecha civil ASC/ID ASC, corte común, cursor inválido/caducado | #260/#251/#258 |
| ADMIN: filtros clienteId/habilitada combinados, orden por cliente, paginación, visitante 401 y CLIENTE 403 | Endpoints y consulta #258 |
| E2E CLIENTE: login, Mi cuenta, resumen, movimientos, vencimientos, SIN_CUENTA/vacíos/carga/error, logout A→B, respuesta tardía de A y caché privada | Pantalla #252 + API #251 conectada a #260; usar `frontend/playwright.config.ts` y runner E2E existente con este seed |
| E2E ADMIN: login, módulo/lista/filtros/selección, resumen/detalles/paginación, vacío/error, CLIENTE bloqueado | Pantalla administrativa + #258 + #260; mismo runner Playwright real, sin interceptar API |

No se añaden `skip`, vistas, endpoints ni E2E ficticios. Los casos de la tabla son pendientes, no tests aprobados. No se corrigen módulos ajenos en #253.

## Integración temporal y CI

La rama propia nace de develop y no contiene commits de Lucci. Para reproducir, crear un worktree **detached** desde el commit de #253 y combinar allí #260, nunca publicar esa combinación:

```sh
git worktree add --detach ../fer19-253-check <sha-de-253>
cd ../fer19-253-check
git merge --no-ff a85a01746ea4e3557bba06d31a625737dba9de04 -m "temporary validation of 260"
cd backend
npm ci
npm run build
npm run test:account:isolated
npm run test:account:contract
```

Para HTTP combinar además `406f5ad5005d1900f50818428fbcbf58fa0abeb9` en ese worktree. Hay conflicto de schemas compartidos: en la comprobación temporal se conservó `active.schemas.ts` de #260 (incluye ambos schemas), dejando el resto de #251 intacto. Rebuild y `test:account:client`. Esta resolución temporal no es una propuesta de merge para Lucci.

CI reutiliza el job backend Node 22 existente: agrega seguridad/limpieza y el runner de persistencia, sin duplicar npm ci ni suites globales. La integración **falla explícitamente mientras falte #260 en develop**; no se obtiene una aprobación ficticia por saltear la suite. Los probes `contract` y `client` son comandos explícitos de diagnóstico, aún no requisitos automáticos verdes; al corregir las dependencias deben incorporarse a CI. Ningún CI verde del subconjunto acredita FIFO, consultas completas ni E2E de cuenta.

Mantener PR Draft y Taiga En curso hasta resolver dependencias, ejecutar E2E reales, comprobar CI del HEAD final y obtener revisión independiente de Lucci. Sin merge ni cierre anticipado.
