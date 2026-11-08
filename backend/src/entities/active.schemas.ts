import { EntitySchema, EntitySchemaColumnOptions } from 'typeorm';

// schema.sql and migrations are authoritative. These metadata never generate or migrate DDL.
const id: EntitySchemaColumnOptions = { type: 'int', primary: true, generated: 'increment' };
const flag: EntitySchemaColumnOptions = { type: 'tinyint', width: 1 };
const created: EntitySchemaColumnOptions = { type: 'datetime', default: () => 'CURRENT_TIMESTAMP' };
const text = (length: number, nullable = false): EntitySchemaColumnOptions => ({ type: 'varchar', length, nullable });
const binary = (nullable = false): EntitySchemaColumnOptions => ({ ...text(20, nullable), collation: 'utf8mb4_bin' });
const percentage: EntitySchemaColumnOptions = { type: 'decimal', precision: 5, scale: 2 };

export interface ListaPrecio { id_lista_precio: number; nombre: string; porcentaje_descuento: string; activa: number; clientes?: Cliente[]; }
export interface Cotizacion { id_cotizacion: number; tasa: string; fecha_referencia: Date; fecha_carga: Date; actor: string; valida: number; }
export interface Categoria { id_categoria: number; nombre: string; descripcion: string | null; activo: number; productos?: Producto[]; }
export interface Producto {
    id_producto: number; id_categoria: number; codigo: string; nombre: string;
    descripcion: string | null; precio: string | null; descuento_especial_pct: string | null;
    stock: number; imagen: string | null; activo: number; fecha_actualizacion: Date; categoria?: Categoria;
}
export interface Cliente {
    id_cliente: number; id_lista_precio: number | null; tipo_cliente: 'PARTICULAR' | 'EMPRESA';
    nombre_razon_social: string; doc_cliente: string | null; cuit: string | null; email: string | null;
    telefono: string | null; direccion: string | null; estado_aprobacion_empresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null;
    es_fiel: number; activo: number; fecha_alta: Date; usuario?: Usuario; lista_precio?: ListaPrecio | null;
    cuenta_corriente?: CuentaCorriente;
}
export interface Usuario {
    id_usuario: number; id_cliente: number | null; email: string; password_hash: string;
    rol: 'CLIENTE' | 'ADMIN'; activo: number; fecha_creacion: Date; ultimo_acceso: Date | null; cliente?: Cliente | null;
}
export interface Carrito {
    id_carrito: number;
    id_cliente: number;
    fecha_creacion: Date;
    fecha_actualizacion: Date;
    cliente?: Cliente;
    items?: ItemCarrito[];
}

export interface ItemCarrito {
    id_item_carrito: number;
    id_carrito: number;
    id_producto: number;
    cantidad: number;
    fecha_agregado: Date;
    fecha_actualizacion: Date;
    carrito?: Carrito;
    producto?: Producto;
}

export interface CuentaCorriente {
    id_cuenta_corriente: number;
    id_cliente: number;
    limite_credito: string;
    habilitada: number;
    fecha_alta: Date;
    observaciones: string | null;
    cliente?: Cliente;
}

export const ListaPrecioSchema = new EntitySchema<ListaPrecio>({
    name: 'ListaPrecio',
    tableName: 'LISTA_PRECIO',
    columns: {
        id_lista_precio: id,
        nombre: text(150),
        porcentaje_descuento: percentage,
        activa: flag
    },
    checks: [
        { name: 'chk_lista_precio_porcentaje', expression: 'porcentaje_descuento >= 0 AND porcentaje_descuento <= 99.99' },
        { name: 'chk_lista_precio_activa', expression: 'activa IN (0, 1)' }
    ],
    relations: {
        clientes: {
            type: 'one-to-many',
            target: 'Cliente',
            inverseSide: 'lista_precio'
        }
    }
});

export const CotizacionSchema = new EntitySchema<Cotizacion>({
    name: 'Cotizacion',
    tableName: 'COTIZACION',
    columns: {
        id_cotizacion: id,
        tasa: { type: 'decimal', precision: 20, scale: 8 },
        fecha_referencia: { type: 'date' },
        fecha_carga: created,
        actor: text(200),
        valida: flag
    },
    indices: [
        { name: 'uq_cotizacion_fecha', columns: ['fecha_referencia'], unique: true }
    ],
    checks: [
        { name: 'chk_cotizacion_tasa', expression: 'tasa > 0' },
        { name: 'chk_cotizacion_valida', expression: 'valida IN (0, 1)' }
    ]
});

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
        descripcion: { type: 'text', nullable: true }, precio: { type: 'decimal', precision: 12, scale: 2, nullable: true },
        descuento_especial_pct: { ...percentage, nullable: true },
        stock: { type: 'int' }, imagen: text(2048, true), activo: flag,
        fecha_actualizacion: { ...created, onUpdate: 'CURRENT_TIMESTAMP' },
    },
    indices: [{ name: 'uq_producto_codigo', columns: ['codigo'], unique: true }, { name: 'idx_producto_categoria', columns: ['id_categoria'] }],
    checks: [
        { name: 'chk_producto_precio', expression: 'precio IS NULL OR precio >= 0' },
        { name: 'chk_producto_descuento', expression: 'descuento_especial_pct IS NULL OR (descuento_especial_pct >= 0 AND descuento_especial_pct <= 99.99)' },
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
        id_cliente: id, id_lista_precio: { type: 'int', nullable: true }, tipo_cliente: binary(),
        nombre_razon_social: text(200), doc_cliente: text(30, true), cuit: text(20, true), email: text(254, true),
        telefono: text(50, true), direccion: text(500, true), estado_aprobacion_empresa: binary(true),
        es_fiel: flag, activo: flag, fecha_alta: created,
    },
    checks: [
        { name: 'chk_cliente_tipo', expression: "tipo_cliente IN ('PARTICULAR', 'EMPRESA')" },
        { name: 'chk_cliente_estado_empresa', expression: "estado_aprobacion_empresa IS NULL OR estado_aprobacion_empresa IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')" },
        { name: 'chk_cliente_aprobacion_tipo', expression: "(tipo_cliente = 'PARTICULAR' AND estado_aprobacion_empresa IS NULL) OR (tipo_cliente = 'EMPRESA' AND estado_aprobacion_empresa IS NOT NULL)" },
        { name: 'chk_cliente_fiel', expression: 'es_fiel IN (0, 1)' },
        { name: 'chk_cliente_activo', expression: 'activo IN (0, 1)' },
    ],
    relations: {
        usuario: { type: 'one-to-one', target: 'Usuario', inverseSide: 'cliente' },
        lista_precio: { type: 'many-to-one', target: 'ListaPrecio', inverseSide: 'clientes', nullable: true,
            joinColumn: { name: 'id_lista_precio', referencedColumnName: 'id_lista_precio', foreignKeyConstraintName: 'fk_cliente_lista_precio' },
            onDelete: 'RESTRICT', onUpdate: 'RESTRICT', cascade: false },
        cuenta_corriente: { type: 'one-to-one', target: 'CuentaCorriente', inverseSide: 'cliente' }
    },
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

export const CarritoSchema = new EntitySchema<Carrito>({
    name: 'Carrito',
    tableName: 'CARRITO',
    columns: {
        id_carrito: id,
        id_cliente: { type: 'int' },
        fecha_creacion: created,
        fecha_actualizacion: { ...created, onUpdate: 'CURRENT_TIMESTAMP' }
    },
    indices: [
        { name: 'uq_carrito_cliente', columns: ['id_cliente'], unique: true }
    ],
    relations: {
        cliente: {
            type: 'one-to-one',
            target: 'Cliente',
            joinColumn: {
                name: 'id_cliente',
                referencedColumnName: 'id_cliente',
                foreignKeyConstraintName: 'fk_carrito_cliente'
            },
            onDelete: 'RESTRICT',
            onUpdate: 'RESTRICT'
        },
        items: {
            type: 'one-to-many',
            target: 'ItemCarrito',
            inverseSide: 'carrito'
        }
    }
});

export const ItemCarritoSchema = new EntitySchema<ItemCarrito>({
    name: 'ItemCarrito',
    tableName: 'ITEM_CARRITO',
    columns: {
        id_item_carrito: id,
        id_carrito: { type: 'int' },
        id_producto: { type: 'int' },
        cantidad: { type: 'int' },
        fecha_agregado: created,
        fecha_actualizacion: { ...created, onUpdate: 'CURRENT_TIMESTAMP' }
    },
    indices: [
        { name: 'uq_item_carrito_producto', columns: ['id_carrito', 'id_producto'], unique: true },
        { name: 'idx_item_carrito_carrito', columns: ['id_carrito'] },
        { name: 'idx_item_carrito_producto', columns: ['id_producto'] }
    ],
    checks: [
        { name: 'chk_item_carrito_cantidad', expression: 'cantidad > 0' }
    ],
    relations: {
        carrito: {
            type: 'many-to-one',
            target: 'Carrito',
            inverseSide: 'items',
            joinColumn: {
                name: 'id_carrito',
                referencedColumnName: 'id_carrito',
                foreignKeyConstraintName: 'fk_item_carrito_carrito'
            },
            onDelete: 'CASCADE',
            onUpdate: 'RESTRICT'
        },
        producto: {
            type: 'many-to-one',
            target: 'Producto',
            joinColumn: {
                name: 'id_producto',
                referencedColumnName: 'id_producto',
                foreignKeyConstraintName: 'fk_item_carrito_producto'
            },
            onDelete: 'RESTRICT',
            onUpdate: 'RESTRICT'
        }
    }
});

// backend/src/entities/active.schemas.ts

export interface CuentaCorriente {
    id_cuenta_corriente: number;
    id_cliente: number;
    limite_credito: string;
    habilitada: number;
    cobertura: 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA';
    plazo_dias: 30 | 60 | null;
    fecha_alta: Date;
    observaciones: string | null;
    cliente?: Cliente;
    movimientos?: MovimientoCuentaCorriente[];
    moneda_limite: string | null;
    evidencia_limite: string | null;
    evidencia_plazo: string | null;
    evidencia_cobertura: string | null;
    cobertura_desde_utc: Date | null;
    origen_datos: 'REAL' | 'DEMO';
    revision: string;
}

export interface MovimientoCuentaCorriente {
    id_movimiento_cuenta: number;
    id_cuenta_corriente: number;
    tipo_movimiento: 'CARGO' | 'ABONO';
    origen: string;
    id_pedido: number | null;
    id_pago: number | null;
    monto: string;
    moneda: 'USD';
    fecha_efectiva: Date;
    fecha_incorporacion: Date;
    fecha_vencimiento: Date | null;
    estado: 'ACREDITADO' | 'ANULADO';
    motivo_invalidacion: string | null;
    autorizado_por: string | null;
    observaciones: string | null;
    cuenta_corriente?: CuentaCorriente;
    fecha_base_civil: string | null;
    plazo_aplicado: 30 | 60 | null;
    vence_el: string | null;
    huella_registro: string | null;
    evidencia_origen: string | null;
    monto_original: string | null;
    moneda_original: string | null;
    id_cotizacion: number | null;
    tasa_historica: string | null;
    evento_invalidacion: string | null;
    invalidado_utc: Date | null;
}

export interface ImputacionMovimientoCuenta {
    id_imputacion: number;
    id_cuenta_corriente: number;
    id_cargo: number;
    id_abono: number;
    monto_imputado: string;
    fecha_imputacion: Date;
    estado: 'VIGENTE' | 'ANULADA';
    revision: string | null;
    evento: string | null;
    evento_sustitucion: string | null;
    invalidada_utc: Date | null;
}

export const CuentaCorrienteSchema = new EntitySchema<CuentaCorriente>({
    name: 'CuentaCorriente',
    tableName: 'CUENTA_CORRIENTE',
    columns: {
        moneda_limite: { type: 'varchar', length: 3, nullable: true },
        evidencia_limite: { type: 'varchar', length: 1000, nullable: true },
        evidencia_plazo: { type: 'varchar', length: 1000, nullable: true },
        evidencia_cobertura: { type: 'varchar', length: 1000, nullable: true },
        cobertura_desde_utc: { type: 'datetime', nullable: true, precision: 3 },
        origen_datos: { type: 'varchar', length: 10, collation: 'utf8mb4_bin' },
        revision: { type: 'bigint', unsigned: true },
        id_cuenta_corriente: id,
        id_cliente: { type: 'int' },
        limite_credito: { type: 'decimal', precision: 12, scale: 2 },
        habilitada: flag,
        cobertura: text(20),
        plazo_dias: { type: 'int', nullable: true },
        fecha_alta: created,
        observaciones: { type: 'text', nullable: true }
    },
    checks: [
        { name: 'chk_cuenta_origen', expression: "origen_datos IN ('REAL', 'DEMO')" },
        { name: 'chk_cuenta_moneda_limite', expression: "moneda_limite IS NULL OR moneda_limite = 'USD'" },
        { name: 'chk_cuenta_cobertura', expression: "cobertura IN ('COMPLETA', 'PARCIAL', 'NO_ACREDITADA')" },
        { name: 'chk_cuenta_habilitada', expression: 'habilitada IN (0, 1)' },
        { name: 'chk_cuenta_limite', expression: 'limite_credito >= 0' },
        { name: 'chk_cuenta_plazo', expression: "plazo_dias IS NULL OR plazo_dias IN (30, 60)" }
    ],
    relations: {
        cliente: {
            type: 'one-to-one',
            target: 'Cliente',
            joinColumn: {
                name: 'id_cliente',
                referencedColumnName: 'id_cliente',
                foreignKeyConstraintName: 'fk_cuenta_cliente'
            },
            onDelete: 'RESTRICT',
            onUpdate: 'RESTRICT'
        },
        movimientos: {
            type: 'one-to-many',
            target: 'MovimientoCuentaCorriente',
            inverseSide: 'cuenta_corriente'
        }
    }
});

export const MovimientoCuentaCorrienteSchema = new EntitySchema<MovimientoCuentaCorriente>({
    name: 'MovimientoCuentaCorriente',
    tableName: 'MOVIMIENTO_CUENTA_CORRIENTE',
    columns: {
        fecha_base_civil: { type: 'date', nullable: true },
        plazo_aplicado: { type: 'int', nullable: true },
        vence_el: { type: 'date', nullable: true },
        huella_registro: { type: 'char', length: 64, nullable: true },
        evidencia_origen: { type: 'longtext', nullable: true },
        monto_original: { type: 'decimal', nullable: true, precision: 12, scale: 2 },
        moneda_original: { type: 'varchar', length: 3, nullable: true },
        id_cotizacion: { type: 'int', nullable: true },
        tasa_historica: { type: 'decimal', nullable: true, precision: 20, scale: 8 },
        evento_invalidacion: { type: 'varchar', length: 100, nullable: true, collation: 'utf8mb4_bin' },
        invalidado_utc: { type: 'datetime', nullable: true, precision: 3 },
        id_movimiento_cuenta: id,
        id_cuenta_corriente: { type: 'int' },
        tipo_movimiento: { ...text(20), collation: 'utf8mb4_bin' },
        origen: text(50),
        id_pedido: { type: 'int', nullable: true },
        id_pago: { type: 'int', nullable: true },
        monto: { type: 'decimal', precision: 12, scale: 2 },
        moneda: text(3),
        fecha_efectiva: created,
        fecha_incorporacion: created,
        fecha_vencimiento: { type: 'datetime', nullable: true },
        estado: { ...text(30), collation: 'utf8mb4_bin' },
        motivo_invalidacion: { type: 'text', nullable: true },
        autorizado_por: text(200, true),
        observaciones: { type: 'text', nullable: true }
    },
    indices: [
        { name: 'uq_movimiento_invalidacion', columns: ["evento_invalidacion"], unique: true },
        { name: 'uq_movimiento_pedido', columns: ['id_pedido'], unique: true },
        { name: 'uq_movimiento_pago', columns: ['id_pago'], unique: true },
        { name: 'idx_movimiento_cuenta', columns: ['id_cuenta_corriente'] },
        { name: 'idx_movimiento_cuenta_estado', columns: ['id_cuenta_corriente', 'estado'] }
    ],
    checks: [
        { name: 'chk_movimiento_original', expression: "(monto_original IS NULL AND moneda_original IS NULL AND evidencia_origen IS NULL) OR (monto_original IS NOT NULL AND monto_original > 0 AND moneda_original IS NOT NULL AND moneda_original IN ('USD','ARS') AND evidencia_origen IS NOT NULL AND JSON_VALID(evidencia_origen) AND (moneda_original = 'USD' OR (id_cotizacion IS NOT NULL AND tasa_historica IS NOT NULL AND tasa_historica > 0)))" },
        { name: 'chk_movimiento_fecha', expression: "(fecha_base_civil IS NULL AND plazo_aplicado IS NULL AND vence_el IS NULL) OR (tipo_movimiento = 'CARGO' AND fecha_base_civil IS NOT NULL AND plazo_aplicado IS NOT NULL AND plazo_aplicado IN (30,60) AND vence_el IS NOT NULL AND vence_el = DATE_ADD(fecha_base_civil, INTERVAL plazo_aplicado DAY))" },
        { name: 'chk_movimiento_estado', expression: "estado IN ('ACREDITADO', 'ANULADO')" },
        { name: 'chk_movimiento_moneda', expression: "BINARY moneda = BINARY 'USD'" },
        { name: 'chk_movimiento_monto', expression: 'monto > 0' },
        {
            name: 'chk_movimiento_referencia',
            expression: "(tipo_movimiento = 'CARGO' AND id_pedido IS NOT NULL AND id_pago IS NULL) OR (tipo_movimiento = 'ABONO' AND id_pago IS NOT NULL AND id_pedido IS NULL)"
        },
        { name: 'chk_movimiento_tipo', expression: "tipo_movimiento IN ('CARGO', 'ABONO')" }
    ],
    relations: {
        cuenta_corriente: {
            type: 'many-to-one',
            target: 'CuentaCorriente',
            joinColumn: {
                name: 'id_cuenta_corriente',
                referencedColumnName: 'id_cuenta_corriente',
                foreignKeyConstraintName: 'fk_movimiento_cuenta'
            },
            onDelete: 'RESTRICT',
            onUpdate: 'RESTRICT'
        }
    }
});

export const ImputacionMovimientoCuentaSchema = new EntitySchema<ImputacionMovimientoCuenta>({
    name: 'ImputacionMovimientoCuenta',
    tableName: 'IMPUTACION_MOVIMIENTO_CUENTA',
    columns: {
        revision: { type: 'bigint', nullable: true, unsigned: true },
        evento: { type: 'varchar', length: 100, nullable: true, collation: 'utf8mb4_bin' },
        evento_sustitucion: { type: 'varchar', length: 100, nullable: true, collation: 'utf8mb4_bin' },
        invalidada_utc: { type: 'datetime', nullable: true, precision: 3 },
        id_imputacion: id,
        id_cuenta_corriente: { type: 'int' },
        id_cargo: { type: 'int' },
        id_abono: { type: 'int' },
        monto_imputado: { type: 'decimal', precision: 12, scale: 2 },
        fecha_imputacion: created,
        estado: { ...text(20), collation: 'utf8mb4_bin' }
    },
    indices: [
        { name: 'uq_imputacion_revision', columns: ["id_cargo","id_abono","revision"], unique: true },
        { name: 'idx_imputacion_cargo', columns: ['id_cargo'] },
        { name: 'idx_imputacion_abono', columns: ['id_abono'] }
    ],
    checks: [
        { name: 'chk_imp_monto', expression: 'monto_imputado > 0' },
        { name: 'chk_imp_estado', expression: "estado IN ('VIGENTE', 'ANULADA')" }
    ]
});

export const activeSchemas = [
    CategoriaSchema,
    ProductoSchema,
    ClienteSchema,
    UsuarioSchema,
    ListaPrecioSchema,
    CotizacionSchema,
    CarritoSchema,
    ItemCarritoSchema,
    CuentaCorrienteSchema,
    MovimientoCuentaCorrienteSchema,
    ImputacionMovimientoCuentaSchema
];
