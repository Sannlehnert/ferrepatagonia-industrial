import { EntitySchema, EntitySchemaColumnOptions } from 'typeorm';

// schema.sql is authoritative. These metadata never generate or migrate DDL.
const id: EntitySchemaColumnOptions = { type: 'int', primary: true, generated: 'increment' };
const flag: EntitySchemaColumnOptions = { type: 'tinyint', width: 1 };
const created: EntitySchemaColumnOptions = { type: 'datetime', default: () => 'CURRENT_TIMESTAMP' };
const text = (length: number, nullable = false): EntitySchemaColumnOptions => ({ type: 'varchar', length, nullable });
const binary = (nullable = false): EntitySchemaColumnOptions => ({ ...text(20, nullable), collation: 'utf8mb4_bin' });

export interface Categoria { id_categoria: number; nombre: string; descripcion: string | null; activo: number; productos?: Producto[] }
export interface Producto {
  id_producto: number; id_categoria: number; codigo: string; nombre: string;
  descripcion: string | null; precio: string; stock: number; imagen: string | null;
  activo: number; fecha_actualizacion: Date; categoria?: Categoria;
}
export interface Cliente {
  id_cliente: number; tipo_cliente: 'PARTICULAR' | 'EMPRESA'; nombre_razon_social: string;
  doc_cliente: string | null; cuit: string | null; email: string | null;
  telefono: string | null; direccion: string | null;
  estado_aprobacion_empresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null;
  es_fiel: number; activo: number; fecha_alta: Date; usuario?: Usuario;
}
export interface Usuario {
  id_usuario: number; id_cliente: number | null; email: string; password_hash: string;
  rol: 'CLIENTE' | 'ADMIN'; activo: number; fecha_creacion: Date; ultimo_acceso: Date | null; cliente?: Cliente | null;
}

export const CategoriaSchema = new EntitySchema<Categoria>({
  name: 'Categoria', tableName: 'CATEGORIA',
  columns: { id_categoria: id, nombre: text(150), descripcion: { type: 'text', nullable: true }, activo: flag },
  checks: [{ name: 'chk_categoria_activo', expression: 'activo IN (0, 1)' }],
  relations: { productos: { type: 'one-to-many', target: 'Producto', inverseSide: 'categoria' } },
});
export const ProductoSchema = new EntitySchema<Producto>({
  name: 'Producto', tableName: 'PRODUCTO',
  columns: {
    id_producto: id, id_categoria: { type: 'int' }, codigo: text(100), nombre: text(200),
    descripcion: { type: 'text', nullable: true }, precio: { type: 'decimal', precision: 12, scale: 2 },
    stock: { type: 'int' }, imagen: text(2048, true), activo: flag,
    fecha_actualizacion: { ...created, onUpdate: 'CURRENT_TIMESTAMP' },
  },
  indices: [{ name: 'uq_producto_codigo', columns: ['codigo'], unique: true }, { name: 'idx_producto_categoria', columns: ['id_categoria'] }],
  checks: [
    { name: 'chk_producto_precio', expression: 'precio >= 0' },
    { name: 'chk_producto_stock', expression: 'stock >= 0' },
    { name: 'chk_producto_activo', expression: 'activo IN (0, 1)' },
  ],
  relations: { categoria: { type: 'many-to-one', target: 'Categoria', inverseSide: 'productos', nullable: false,
    joinColumn: { name: 'id_categoria', referencedColumnName: 'id_categoria', foreignKeyConstraintName: 'fk_producto_categoria' },
    onDelete: 'RESTRICT', onUpdate: 'RESTRICT', cascade: false } },
});
export const ClienteSchema = new EntitySchema<Cliente>({
  name: 'Cliente', tableName: 'CLIENTE',
  columns: {
    id_cliente: id, tipo_cliente: binary(), nombre_razon_social: text(200), doc_cliente: text(30, true),
    cuit: text(20, true), email: text(254, true), telefono: text(50, true), direccion: text(500, true),
    estado_aprobacion_empresa: binary(true), es_fiel: flag, activo: flag, fecha_alta: created,
  },
  checks: [
    { name: 'chk_cliente_tipo', expression: "tipo_cliente IN ('PARTICULAR', 'EMPRESA')" },
    { name: 'chk_cliente_estado_empresa', expression: "estado_aprobacion_empresa IS NULL OR estado_aprobacion_empresa IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')" },
    { name: 'chk_cliente_aprobacion_tipo', expression: "(tipo_cliente = 'PARTICULAR' AND estado_aprobacion_empresa IS NULL) OR (tipo_cliente = 'EMPRESA' AND estado_aprobacion_empresa IS NOT NULL)" },
    { name: 'chk_cliente_fiel', expression: 'es_fiel IN (0, 1)' },
    { name: 'chk_cliente_activo', expression: 'activo IN (0, 1)' },
  ],
  relations: { usuario: { type: 'one-to-one', target: 'Usuario', inverseSide: 'cliente' } },
});
export const UsuarioSchema = new EntitySchema<Usuario>({
  name: 'Usuario', tableName: 'USUARIO',
  columns: {
    id_usuario: id, id_cliente: { type: 'int', nullable: true }, email: text(254),
    password_hash: { ...text(255), select: false }, rol: binary(), activo: flag,
    fecha_creacion: created, ultimo_acceso: { type: 'datetime', nullable: true },
  },
  indices: [{ name: 'uq_usuario_email', columns: ['email'], unique: true }],
  checks: [
    { name: 'chk_usuario_rol', expression: "rol IN ('CLIENTE', 'ADMIN')" },
    { name: 'chk_usuario_rol_cliente', expression: "(rol = 'ADMIN' AND id_cliente IS NULL) OR (rol = 'CLIENTE' AND id_cliente IS NOT NULL)" },
    { name: 'chk_usuario_activo', expression: 'activo IN (0, 1)' },
  ],
  relations: { cliente: { type: 'one-to-one', target: 'Cliente', inverseSide: 'usuario', nullable: true,
    joinColumn: { name: 'id_cliente', referencedColumnName: 'id_cliente', foreignKeyConstraintName: 'fk_usuario_cliente' },
    onDelete: 'RESTRICT', onUpdate: 'RESTRICT', cascade: false } },
});
export const activeSchemas = [CategoriaSchema, ProductoSchema, ClienteSchema, UsuarioSchema];
