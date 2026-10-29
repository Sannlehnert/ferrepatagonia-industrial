// Inventory shared by unit and real-DB security tests. Unknown methods/paths must
// still cross the administrative guard before reaching the 404 handler.
exports.protectedRoutes = (id = 1, category = 1) => [
  { method: 'GET', path: '/api/auth/me', status: 200, publicToClient: true },
  { method: 'GET', path: '/api/admin/clientes', status: 200 },
  { method: 'GET', path: '/api/admin/productos', status: 200 },
  { method: 'GET', path: `/api/admin/productos/${id}`, status: 200 },
  { method: 'POST', path: '/api/admin/productos', status: 201,
    body: { id_categoria: category, codigo: 'SECURITY-217', nombre: 'Security fixture', precio: 1.239, stock: 0 } },
  { method: 'PUT', path: `/api/admin/productos/${id}`, status: 200, body: { nombre: 'Updated security fixture' } },
  { method: 'PATCH', path: `/api/admin/productos/${id}/desactivar`, status: 200 },
  { method: 'PATCH', path: `/api/admin/productos/${id}/stock`, status: 200, body: { stock: 3 } },
  { method: 'GET', path: '/api/admin/unknown', status: 404 },
  { method: 'POST', path: '/api/admin/productos/unknown/path', status: 404, body: {} },
  { method: 'DELETE', path: `/api/admin/productos/${id}`, status: 404 },
];
