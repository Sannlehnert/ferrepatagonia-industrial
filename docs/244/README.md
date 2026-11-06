# S5-17.6 (#244) — Pruebas funcionales y seguridad de precios

## Alcance

Se agregan comprobaciones de integración y E2E para cambios de sesión y listas
propias. Los importes de esta cobertura son explícitamente sintéticos y se usan
solo en las bases desechables de pruebas.

## Matriz de aceptación

| Escenario | Cobertura |
| --- | --- |
| Dos clientes, mismo producto, importes distintos | Integración HTTP/MariaDB existente y E2E real con listas del 10% y 20%. |
| Visitante y cliente nuevo según FER-15 | Integración y E2E; ambos conservan el precio general si no tienen lista. |
| Asignar/cambiar lista y cambiar su descuento | Integración HTTP/MariaDB, verificando el importe siguiente y que otro cliente no cambie. La asignación se persiste directamente porque no existe una API administrativa de listas. |
| Cliente sin lista, lista inactiva y producto sin precio | Pruebas unitarias e integración MariaDB existentes. |
| Cotización faltante, precisión y redondeo | Pruebas unitarias e integración MariaDB existentes. |
| Consulta/modificación de listas ajenas | HTTP rechaza IDs/valores de cliente o lista en body y query; no existe ruta para consultar otro cliente. |
| Cambio de sesión y caché | E2E real alterna clientes en el mismo navegador y verifica `private, no-store` y `Vary: Cookie`. |
| Importes ficticios o evidencia ausente | E2E e integración verifican `datosSinteticos`, bloquean importes no verificados y no publican precios inventados. |

La aplicación no ofrece una operación administrativa HTTP/UI para asignar listas.
La integración valida el efecto de la asignación persistida sobre el cálculo, pero
no puede validar autorización de una interfaz administrativa inexistente.

## Revisión de seguridad

- Los precios del cliente se resuelven desde la identidad autenticada y su lista
  persistida; el cliente no puede enviar IDs de listas, importes ni descuentos.
- El canal público no usa la cookie ni expone asignaciones privadas.
- Las respuestas de precios no se almacenan en caché y varían por cookie.
- El E2E usa MariaDB y la aplicación reales, sin interceptar las rutas HTTP de
  precios. La evidencia sembrada indica explícitamente que es sintética.

## Validación local

| Comando | Resultado |
| --- | --- |
| `backend: npm run build` | Aprobado. |
| `backend: npm run test:unit` | 1139/1139 aprobados. |
| `backend: npm run test:dto-source` | 2/2 aprobados. |
| `backend: npm run test:integration` | 283/283 aprobados: 234 admin/ORM, 8 categorías y 41 precios. |
| `node --test backend/test/e2e-cleanup.test.cjs` | 2/2 aprobados. |
| `frontend: npm run type-check` | Aprobado. |
| `frontend: npm test` | 159/159 aprobados. |
| `frontend: npm run build` | Aprobado. |
| E2E `pricing.real.spec.ts` | 4/4 aprobados con Express, Passport y MariaDB reales. |
| E2E completa | 61/61 aprobados; limpieza del contenedor confirmada. |
| `npm audit --audit-level=high` (backend y frontend) | Aprobados; 0 vulnerabilidades reportadas. |

Las suites de integración y E2E se ejecutaron con Docker y finalizaron sin fallos.
