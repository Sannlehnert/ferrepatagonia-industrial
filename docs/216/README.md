# #216 — Incorporar CI de build, tipos y pruebas frontend/backend

## 1. Contexto y entorno registrado
- **Sprint:** 4.5 — Estabilización previo al merge `develop` -> `main` (#216).
- **Rama de trabajo:** `feature/216-ci-verification` (destino: `develop`).
- **Entorno de validación local:** Windows, Node `v24.14.0`, npm `11.9.0`, Docker (`mariadb:11.4`).
- **Restricciones respetadas:** No se cierran ni mueven tarjetas del Sprint 4 ni `#207`, `#208` o `#211`. Se reutilizan evidencias existentes y comandos reproducibles.

---

## 2. Configuración del Pipeline (`.github/workflows/ci.yml`)
Se implementó un pipeline en GitHub Actions estructurado en dos jobs paralelos independientes (`backend-ci` y `frontend-ci`) que garantizan:
1. **Instalación reproducible:** Uso de `npm ci` con Node `24` respetando los lockfiles intactos[cite: 2].
2. **Chequeo de tipos y Build:** Ejecución estricta de `tsc --noEmit` / `tsc` para backend y `vue-tsc --build` / `vite build` para frontend[cite: 2, 5].
3. **Aislamiento con MariaDB 11.4:** Servicio efímero en contenedor con healthcheck automático (`healthcheck.sh --connect --innodb_initialized`), migraciones, verificación de huella SHA-256 del esquema y limpieza garantizada[cite: 1, 2, 3].
4. **Permisos mínimos:** `permissions: contents: read` sin filtración de secretos de producción[cite: 2].

---

## 3. Resumen de Pruebas y Evidencias Exitosas
- **Backend Unitarias e Integración:** 502 tests unitarios/HTTP y 227 tests de integración sobre MariaDB ejecutados sin errores[cite: 8].
- **Frontend Pruebas y Build:** 55 tests nativos de Node (`node --test`) y compilación de Vite completados en verde[cite: 2, 5, 8].
- **Fallo Visible (Fail-Fast):** Comprobado que ante un error en aserciones o en el compilador TypeScript, el proceso finaliza con código de salida `!= 0` haciendo fallar el job de manera controlada[cite: 2].