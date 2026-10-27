# #217 — Fase 2B: hardening HTTP y configuración

Fecha: 27/10/2026. Rama local: `feature/217-passport-jwt-security`.

**SHA inicial: 8cd051cc78663ddd2bba6ca7ec5cf4c6e314d551**, entrega de 2A. Se conservaron sus cuatro commits. Develop fue consultado al inicio y al cierre: **8080f210be80162048fb73420bc825369c9bc855**, sin cambios. Solo se observó la rama externa de #214/PR #47; no apareció trabajo publicado nuevo de #212. Esto no descarta trabajo local de Lucci.

**Dictamen: LISTO PARA AUDITORÍA FINAL.** No equivale a autorización de despliegue. Producción requiere parámetros de infraestructura aún pendientes; una configuración incompleta falla al iniciar. No se hizo push, PR, merge ni cambios en Taiga.

## Arquitectura objetivo confirmada

El usuario confirmó frontend y API bajo el mismo origen público, API en `/api`, una instancia/proceso Node.js inicialmente, HTTPS obligatorio y reverse proxy por definir según hosting. No se asumió Nginx, dominio, IP de proxy, cantidad de saltos ni proveedor. Se conservan cookies HttpOnly, Secure en producción y SameSite Strict. CORS externo no es necesario en este objetivo y permanece cerrado.

## Correcciones implementadas

### Entorno y cookie

- NODE_ENV es obligatorio y exacto: development, test o production. Ausente, abreviado, con mayúsculas o espacios inesperados falla antes de escuchar. No existe fallback silencioso a development.
- JWT_SECRET sigue siendo obligatorio y no tiene valor por defecto. En production exige al menos 32 bytes UTF-8, sin espacios periféricos ni repetición de un único carácter. Nunca se recorta, genera, imprime o rota automáticamente. La longitud no demuestra entropía: la clave productiva debe generarse aleatoriamente fuera del código, como ya indicaba .env.example.
- `auth-cookie.config.ts` centraliza nombre y opciones de emisión/limpieza. El modo se toma de la configuración validada al arrancar y las opciones se congelan; cambiar process.env posteriormente no desactiva Secure.
- Se mantienen jwt_token, HttpOnly, SameSite=Strict, Path=/, host-only y 7.200.000 ms al emitir. La limpieza comparte atributos y no incorpora maxAge.

### Origen y CSRF

Antes de parsers, Passport o servicios, `/api` aplica la política HTTP. Para POST/PUT/PATCH/DELETE y otros métodos mutantes:

| Contexto recibido | Decisión |
|---|---|
| Origin exacto del origen público configurado | Admitir si las demás señales no contradicen el contexto. |
| Sin Origin, Referer válido del mismo origen | Admitir. Se permite la ruta del Referer; no credenciales ni protocolos no HTTP. |
| Sin Origin/Referer, Sec-Fetch-Site=same-origin | Admitir únicamente si Host y protocolo también coinciden con el origen público configurado. X-Forwarded-Host no define el origen permitido. |
| Todas esas cabeceras ausentes | 403 controlado. No existe una excepción general para clientes sin Origin ni un bypass por NODE_ENV=test. |
| Origin null, vacío, externo, múltiple, malformado o con path | 403, aunque haya un Referer válido. |
| Referer externo o contradictorio | 403. |
| Sec-Fetch-Site cross-site, same-site u otro valor inesperado | 403 en mutaciones/preflight; no se confía en subdominios hermanos. |

Respuesta nueva: `403 {message:'Origen de solicitud no permitido.'}`. No se emite o elimina cookie ni se invocan servicios para una petición rechazada. Login, registro, logout y administración quedan cubiertos.

GET/HEAD de lectura conservan sus contratos y autorización. OPTIONS externo se rechaza; un OPTIONS de mismo origen o sin contexto puede continuar por las rutas existentes (incluidas las guardas administrativas). No se refleja Origin ni se emiten Access-Control-Allow-Origin/Access-Control-Allow-Credentials. Un preflight público que devuelve 200 no habilita CORS externo: carece de las cabeceras de autorización de CORS. Para mismo origen el navegador no necesita CORS.

Este control de servidor y SameSite son defensas complementarias. No se presenta CORS como autenticación o como sustituto de CSRF. Los clientes no navegador que usen cookies para mutaciones deben declarar el origen configurado o un Referer válido; eso no los autentica, y siguen necesitando JWT/permisos. No hay evidencia de integraciones externas que requieran una excepción. El navegador actual normalmente aporta estas señales sin cambios del frontend.

Si el objetivo cambia a orígenes distintos, habrá que diseñar una allowlist exacta y revisar transporte de cookies/preflight según dominios y TLS reales. No se agregó una apertura preventiva ni SameSite=None.

### HTTPS y proxy

- Development/test usan trust proxy=false salvo CIDR explícitos de pruebas/configuración.
- Solo se aceptan direcciones IP/CIDR explícitas, no true, comodines, nombres de proveedores ni un número de saltos. Se rechazan /0, entradas inválidas y máscaras fuera de rango.
- Production requiere origen público HTTPS, CIDR de proxy explícitos y HTTPS_TERMINATION=trusted-proxy. El servidor actual es HTTP detrás de un terminador TLS; un perfil diferente no se simula como soportado.
- Toda petición `/api` productiva que Express no identifique como HTTPS devuelve `426 {message:'Se requiere HTTPS.'}`. No se construyen redirecciones a partir de Host del cliente.
- req.ip/protocol se derivan mediante el trust proxy restringido de Express. Cabeceras X-Forwarded-* desde peers no confiables no cambian IP/protocolo. Una identidad de red inválida devuelve `400 {message:'Información de red inválida.'}` sin reproducir su valor ni llegar al limitador.
- El proxy real debe sobrescribir cabeceras reenviadas, filtrar acceso directo al backend y cumplir TLS. Un 426 después de recibir HTTP no cifra retroactivamente lo recibido: la protección de transporte real se debe garantizar en el ingreso. Las pruebas locales no certifican ese límite de infraestructura.

### Rate limiting

Login y registro tienen limitadores separados, antes del DTO/servicio y de bcrypt. Se aplican después de su parser JSON; los errores de JSON conservan su envelope anterior. El control de origen ocurre antes del parser y no consume operaciones de autenticación.

Se cuentan éxitos y fallos por IP verificada, con agregación IPv6 /56 y normalización de IPv4-mapped IPv6. No se usa email, contraseña, token o identificador de cuenta como clave; no hay bloqueo global por cuenta. Un cliente verificado distinto conserva su cuota aunque use el mismo email.

Al superar la cuota: `429 {message:'Demasiadas solicitudes. Intente nuevamente más tarde.'}` y Retry-After en segundos. También se emiten RateLimit de draft-7; no cabeceras legacy X-RateLimit. Se verifica que el controlador no se ejecute después del límite. Un error del store no permite continuar (passOnStoreError:false); se trata como fallo controlado.

El store implementado es MemoryStore de express-rate-limit, compatible con **un único proceso**, como confirmó el usuario. AUTH_RATE_STORE=memory y API_PROCESS_COUNT=1 son obligatorios en production; una cantidad mayor o store no implementado falla al iniciar. No se afirma que el código pueda detectar instancias externas cuyo operador declare incorrectamente ese conteo. Escalar requiere store compartido y revisión operativa.

Limitaciones: las cuotas se reinician con el proceso; no se comparten entre procesos y varias personas tras NAT comparten IP/cuota. Los umbrales productivos deben considerar tráfico real. No es defensa completa frente a ataques distribuidos o denegación de servicio de red.

## Configuración y migración local

| Variable | Desarrollo/test | Producción |
|---|---|---|
| NODE_ENV | Obligatoria, modo conocido | Obligatoria, production |
| JWT_SECRET | No vacía; fixtures cortas solo en pruebas históricas | Obligatoria, mínimo indicado y generación aleatoria del operador |
| APP_PUBLIC_ORIGIN | Default local http://localhost:5173; configurable al origen real del navegador | Obligatoria, URL HTTPS canónica, sin path, slash final, credenciales, query o fragmento |
| TRUSTED_PROXY_CIDRS | Default none | Lista explícita de proxies reales; none no sirve para el perfil TLS actual |
| HTTPS_TERMINATION | No necesaria localmente | Obligatoria, trusted-proxy |
| AUTH_RATE_STORE | Default memory | Obligatoria, memory |
| API_PROCESS_COUNT | Default 1 | Obligatoria, 1 |
| AUTH_LOGIN_LIMIT | Default local 20 | Obligatoria, sin default productivo |
| AUTH_LOGIN_WINDOW_MS | Default local 900000 | Obligatoria, sin default productivo |
| AUTH_REGISTER_LIMIT | Default local 10 | Obligatoria, sin default productivo |
| AUTH_REGISTER_WINDOW_MS | Default local 3600000 | Obligatoria, sin default productivo |

Límites y ventanas admiten enteros decimales positivos estrictos: sin vacíos, ceros iniciales, fracciones, notación científica, no finitos o valores parciales. Máximo de cuota: 1.000.000; máximo de ventana: 2.147.483.647 ms (límite operativo del temporizador). Son límites de configuración, no reglas de negocio.

Los defaults de desarrollo permiten ejecutar localmente con Vite; no representan una decisión de infraestructura o de umbrales productivos. Si Vite usa otro host/puerto, APP_PUBLIC_ORIGIN debe coincidir. En instalaciones locales anteriores se debe añadir NODE_ENV=development y el origen real al archivo privado correspondiente; no se cambió ningún .env privado ni credencial existente. .env.example conserva JWT_SECRET vacío y documenta los parámetros nuevos.

No debe copiarse el perfil local a production sin resolver el origen HTTPS, proxies, umbrales y gestión de claves. Si una clave existente incumple la validación, el proceso falla: no se sustituye automáticamente; se requiere una decisión operativa de migración/rotación.

## Cambios por archivo

| Archivo | Cambio |
|---|---|
| backend/src/config/http-security.config.ts | Parser puro de modos, origen, proxies, topología, cuotas y fortaleza mínima JWT. |
| backend/src/config/env.config.ts | Validación de seguridad al cargar el entorno, antes del servidor. |
| backend/src/config/auth-cookie.config.ts | Opciones compartidas, congeladas, de set/clear. |
| backend/src/controllers/auth.controller.ts | Emisión/limpieza utilizan esas opciones; JSON y lógica de credenciales preservados. |
| backend/src/middlewares/http-security.middleware.ts | HTTPS, identidad de red, origen/Referer/Fetch Metadata y rechazo de preflight externo. |
| backend/src/app.ts | Trust proxy explícito y middleware HTTP antes de parsers/rutas. |
| backend/src/middlewares/auth-rate-limit.middleware.ts | Factory de limitadores por IP, cuotas separadas, IPv6 y store sin fail-open. |
| backend/src/routes/auth.routes.ts | Login/registro pasan por su limitador; logout/me conservan su funcionamiento y no comparten esa cuota. |
| backend/.env.example | Modo/local origin y opciones nuevas, comentarios de producción sin valores reales. |
| backend/package.json | Dependencia de limitador, suites nuevas y perfil de regresión explícito. |
| backend/package-lock.json | Solo express-rate-limit 8.7.1 y su transitoria ip-address; ninguna entrada anterior modificada respecto de 2A. |
| backend/test/http-config.test.cjs | Configuraciones válidas/inválidas, startup que falla por la variable esperada, cookie inmutable. |
| backend/test/http-origin.test.cjs | Matriz por métodos/rutas; origen ausente/externo/opaco/contradictorio, fallbacks y preflight; usa fetch nativo para no ocultar cabeceras ausentes. |
| backend/test/http-proxy.test.cjs | Peer confiable/no confiable, cadena de IPs, falsificación y HTTPS; redes de documentación/loopback solo como fixtures. |
| backend/test/auth.rate-limit.test.cjs | Cuotas, Retry-After, aislamiento IPv4/IPv6, ventanas, privacidad de keys y fallo de store. |
| backend/test/auth.security.integration.test.cjs | Cookies por entorno en procesos arrancados con configuración real y cuentas reales; cuotas con MariaDB sin filas extra al bloquear. |
| backend/test/helpers/test-env.cjs | Perfil de regresión test, origen declarado y cuotas grandes para volumen; no desactiva middleware, Passport o validación. |
| backend/test/helpers/browser-request.cjs | Cliente HTTP de pruebas que declara el Origin del navegador en mutaciones; no modifica fetch global. |
| backend/test/helpers/start-http-app.cjs, http-app-worker.cjs | Procesos aislados para validar configuración/cookies al arrancar; consultas reales solo bajo guard de base desechable, stubs solo en unitarias. |
| backend/test/helpers/production-http-env.cjs | Fixtures de HTTPS/proxy sintético local; nunca defaults de despliegue. |
| backend/test/helpers/run-admin-products-mariadb.cjs, run-category-mariadb.cjs | Cargan el perfil de prueba explícito antes de sus suites. |

Los siguientes tests anteriores solo importan el cliente explícito de navegador, sin eliminar ni reducir assertions: adminProduct.test.cjs, auth.me.integration.test.cjs, auth.me.test.cjs, auth.middleware.test.cjs, auth.passport-source.test.cjs, auth.passport.test.cjs, catalog.integration.test.cjs, catalog.test.cjs, category.integration.test.cjs, category.test.cjs, clientes.integration.test.cjs, clientes.test.cjs, database-outcome.test.cjs, database-policy.integration.test.cjs, dto-source.test.cjs, dto.test.cjs, register.integration.test.cjs y register.test.cjs. La suite auth.security se adapta además como se indicó arriba.

Inventario completo de entrega en `evidence-2b/files-changed.txt`. No se modificaron frontend, suite #214, esquema, migraciones, entidades, DTOs ni la estrategia/revalidación de usuarios de 2A.

## Pruebas y evidencia

Baseline 2A: **956 PASS**. Resultado completo final:

| Suite | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unitarias/HTTP | 984 | 0 | 0 |
| Fuentes con tsx: DTO y Passport real | 2 | 0 | 0 |
| MariaDB general y seguridad | 219 | 0 | 0 |
| MariaDB categorías | 8 | 0 | 0 |
| **Total** | **1213** | **0** | **0** |

**Build, type-check y git diff --check: PASS.** Sin cancelaciones finales. Se ejecutaron los tests anteriores, incluidos JWT sin exp, usuario inexistente/inactivo/rol cambiado, guardas anidadas, 401/403, no bypass de Passport, DTO, SKU, stock, rollback y conflictos. Los casos parametrizados aumentan el conteo; no se afirma cobertura porcentual.

Las unitarias nuevas prueban servicios con stubs para contar exactamente cuántas veces se invocan antes de 429; las integraciones adicionales prueban login/registro reales con cuotas de 1, primera cuenta persistida y segunda cuenta bloqueada sin CLIENTE/USUARIO extra. El modo productivo se prueba en un proceso nuevo con configuración sintética completa y MariaDB desechable; no se simula cambiando NODE_ENV después del arranque. Los asserts de cookies no imprimen el valor JWT.

Toda MariaDB usada fue nueva, sin volúmenes, UUID y puerto aleatorio loopback. Las cuentas y claves se generaron para pruebas. Los runners mantienen el guard contra BD compartidas y limpian al finalizar. Al cierre no quedaron contenedores con los prefijos de esos runners. SHOW CREATE TABLE antes/después idéntico en ambos runners, excluyendo solo AUTO_INCREMENT: **`7a9e0906eba41a1c02e61a1a386df565cb3324b5249f9938229a9bdf51905886`**.

Reproducción desde backend, con Node >=22 y Docker:

```text
npm ci
npm run type-check
npm test
```

Las suites se ejecutan con `test-env.cjs`, que configura un origen de test y cuotas de regresión grandes pero activas. Los tests de seguridad nuevos utilizan fetch nativo y cuotas pequeñas; no pasan por el adaptador que añade Origin. Para ejecutar una suite individual se debe cargar el perfil con `node --require ./test/helpers/test-env.cjs --test test/NOMBRE.test.cjs`. No ejecutar integraciones directamente contra bases compartidas.

En esta fase se instaló únicamente express-rate-limit con npm install sobre el lock; no se afirma haber realizado una reinstalación limpia npm ci. No se ejecutó E2E ni frontend, que no cambiaron.

Evidencia en `evidence-2b/`: suite completa final, auditoría npm, verificación de dependencias y archivos cambiados. Dos incidencias durante el desarrollo se resolvieron sin debilitar assertions: un test de cookie carecía de su fixture JWT/BD y un test de Host usaba fetch, que no transmitía el Host sintético como se pretendía; se sustituyó ese transporte puntual por HTTP nativo, manteniendo la expectativa 200. No hubo fallos finales ignorados.

## Contratos preservados y rechazos deliberados

Se preservan los JSON/mensajes de login, registro, /me, logout, 401/403 de Passport y 400/404/409/500 de negocio para peticiones que cumplen el contexto HTTP. JWT continúa a dos horas; cookies conservan alcance/atributos; no hay nuevos roles ni cambios de persistencia. La revalidación TypeORM de 2A permanece por petición, sin caché ni consulta duplicada.

Cambios deliberados de seguridad: mutaciones sin contexto admitido → 403 de origen; exceso → 429/Retry-After; transporte productivo no HTTPS → 426; IP reenviada inválida → 400. Son rechazos anteriores al negocio y no deben describirse como comportamiento idéntico de entradas inseguras. Un cliente que antes enviaba mutaciones sin Origin/Referer/Fetch Metadata debe adoptar el contexto requerido; no se agregó una excepción general que anule el control.

## Coordinación y pendientes

- **#212:** no se alteró ninguna versión previa del lock ni se ejecutó audit fix. Auditoría npm sigue con 1 HIGH heredada en body-parser, sin alertas nuevas de los dos paquetes añadidos. Resolverla coordinadamente y revalidar después.
- **#214:** la rama publicada sigue en cc4fa9e. Su runner arranca la API antes de conocer el puerto dinámico del navegador y no configura APP_PUBLIC_ORIGIN. Ahora necesita proporcionar el origen exacto del frontend al arrancar la API (planificar/asignar el puerto antes) y cuotas explícitas acordes a su volumen, conservando el middleware activo. No se modificó el trabajo de Bruno ni se afirma que sus E2E ya pasen sobre 2B.
- **#216:** CI debe ejecutar el perfil de test, los runners desechables y los procesos aislados; las pruebas de producción no requieren secretos reales. Coordinar la regresión E2E después del ajuste de #214.
- **#218:** documentar el dominio público, CIDR de proxies y sus garantías de sobrescritura de X-Forwarded-*, TLS real, ACL de backend privado, umbrales, gestión de claves y single-process. Aquí solo se implementó validación de esos parámetros, no infraestructura contratada.
- Si se escala horizontalmente o se usa cluster/varios workers, implementar un store compartido; MemoryStore no proporciona cuotas globales. Verificar que API_PROCESS_COUNT represente el total real, no una declaración incorrecta por cada réplica.
- No se incorporó revocación persistente: logout borra cookie, una copia capturada de JWT vigente sigue siendo válida. La sesión sí deja de pasar cuando usuario/rol/activo no coinciden. Cualquier requisito de revocación adicional necesita diseño explícito.
- No se hizo pentest, prueba de carga ni validación real de TLS/navegadores/hosting. Las comprobaciones locales de cabeceras no certifican el comportamiento del proxy futuro.

## Commits locales y entrega

1. `4cd9167`: entorno obligatorio/validado, opciones de cookie y fixtures por entorno.
2. `1b4d973`: contexto de origen, HTTPS y proxy explícito.
3. `9f977ef`: limitación por IP y pruebas de cuotas.
4. `1c16a83`: regresiones de orígenes opacos/contradictorios y causa de fallo al arrancar.
5. Commit de documentación/evidencia de esta entrega. Su SHA final se obtiene con git rev-parse HEAD y se informa al usuario, sin autorreferenciar su propio contenido.

**LISTO PARA AUDITORÍA FINAL**, con producción condicionada a infraestructura y parámetros reales. No se declara que la aplicación sea segura para producción por pasar las pruebas.

Referencias técnicas consultadas: [Express detrás de proxies](https://expressjs.com/en/guide/behind-proxies/), [configuración de express-rate-limit](https://express-rate-limit.mintlify.app/reference/configuration), [normalización IPv4/IPv6 del limitador](https://express-rate-limit.mintlify.app/reference/helpers). Los parámetros reales de hosting no se deducen de esos ejemplos.
