// Unit-level identity row. HTTP still runs the real Passport strategy and lookup.
// Database integration suites create actual USUARIO records instead.
exports.sessionRow = (id, rol, overrides = {}) => ({
  id_usuario: id, email: 'session@example.test', rol, activo: 1,
  nombre_razon_social: rol === 'ADMIN' ? null : 'Cliente',
  tipo_cliente: rol === 'ADMIN' ? null : 'PARTICULAR', ...overrides,
});
