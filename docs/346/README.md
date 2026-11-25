# T-S7-15.2 / #346 — Filtros, paginación y formularios de clientes

Responsable: Santiago Agustín Lehnert. Revisión técnica y UX/UI: Lucci.

## Alcance implementado

- Búsqueda administrativa por nombre/razón social, email, CUIT, documento e ID (`#123`).
- Filtros por tipo (`PARTICULAR`/`EMPRESA`) y estado de empresa (`PENDIENTE`/`APROBADA`/`RECHAZADA`).
- Paginación real desde MariaDB con tamaño de página 20 y orden estable por fecha de alta e ID.
- Persistencia de búsqueda, filtros y página en la URL.
- Cancelación de respuestas obsoletas, restablecimiento de página al filtrar y recuperación de páginas fuera de rango.
- Aprobación/rechazo de empresas y asignación de listas conservando búsqueda, filtros y página.
- Reconciliación con el servidor ante resultados inciertos en aprobación y asignación de listas.
- Diálogo accesible para crear/editar listas de precios, con foco inicial, trampa de foco, Escape, confirmación de borrador y retorno de foco.
- Estados diferenciados de carga, error, sin clientes y sin resultados para los filtros.
- Tabla con desplazamiento interno accesible por teclado y sin desborde horizontal del documento.

## Contrato API

`GET /api/admin/clientes` sin parámetros conserva exactamente el contrato histórico:

```json
{ "message": "Clientes obtenidos correctamente", "data": { "clientes": [] } }
```

Con parámetros (`page`, `limit`, `busqueda`, `tipo`, `estadoEmpresa`) responde de forma aditiva:

```json
{
  "message": "Clientes obtenidos correctamente",
  "data": {
    "clientes": [],
    "paginacion": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
  }
}
```

Validaciones: `page` 1–1.000.000, `limit` 1–100, búsqueda de hasta 200 caracteres sin controles, sin parámetros desconocidos/repetidos. `tipo=PARTICULAR` con `estadoEmpresa` se rechaza con 400. La búsqueda usa parámetros ligados y `ESCAPE`, sin concatenación SQL.

## Limitación real del CRUD de clientes

No existen contratos administrativos autorizados para crear o editar los datos personales/comerciales de un cliente. No se reutilizó el registro público ni se inventaron escrituras de identidad, credenciales, tipo o estado. Se completaron las operaciones administrativas existentes (aprobación/rechazo y listas de precios). El CRUD general de clientes queda pendiente de un contrato específico.

## Evidencia visual

- `clientes-360.png`: listado, filtros y paginación en móvil.
- `clientes-1280.png`: listado, filtros y paginación en escritorio.
- `clientes-formulario-360.png`: diálogo de listas de precios en móvil.
- `clientes-formulario-1280.png`: diálogo de listas de precios en escritorio.
