import { dataSource, inTransaction } from '../config/database.config';
import { ProductoSchema, CategoriaSchema } from '../entities/active.schemas';
export interface ProductRecord {
    id_producto: number;
    id_categoria: number;
    codigo: string;
    nombre: string;
    descripcion: string | null;
    precio: string;
    stock: number;
    imagen: string | null;
    activo: number | boolean;
    fecha_actualizacion: Date;
}

export interface CreateProductDTO {
    id_categoria: number;
    codigo: string;
    nombre: string;
    descripcion?: string | null;
    precio: number;
    stock: number;
    imagen?: string | null;
    activo?: boolean;
}

export interface UpdateProductDTO {
    id_categoria?: number;
    codigo?: string;
    nombre?: string;
    descripcion?: string | null;
    precio?: number;
    stock?: number;
    imagen?: string | null;
    activo?: boolean;
}


// Explicit raw projections preserve DECIMAL strings, numeric flags and JSON keys.
const fields = ['id_producto', 'id_categoria', 'codigo', 'nombre', 'descripcion', 'precio', 'stock', 'imagen', 'activo', 'fecha_actualizacion'];
function productQuery() {
  const query = dataSource.getRepository(ProductoSchema).createQueryBuilder('p');
  fields.forEach((field, index) => index === 0 ? query.select('p.' + field, field) : query.addSelect('p.' + field, field));
  return query;
}
export const findAllAdmin = async (): Promise<ProductRecord[]> => productQuery()
  .innerJoin('p.categoria', 'c').addSelect('c.nombre', 'categoria_nombre')
  .orderBy('p.id_producto', 'DESC').getRawMany<ProductRecord>();
export const findById = async (id: number): Promise<ProductRecord | null> =>
  await productQuery().where('p.id_producto = :id', { id }).getRawOne<ProductRecord>() ?? null;
export const findByCodigo = async (codigo: string, excludeId?: number): Promise<ProductRecord | null> => {
  const query = productQuery().where('p.codigo = :codigo', { codigo });
  if (excludeId !== undefined) query.andWhere('p.id_producto <> :excludeId', { excludeId });
  return await query.getRawOne<ProductRecord>() ?? null;
};
export const categoryExists = (id_categoria: number): Promise<boolean> =>
  dataSource.getRepository(CategoriaSchema).existsBy({ id_categoria });
export const create = async (data: CreateProductDTO): Promise<number> => {
  const result = await inTransaction(manager => manager.getRepository(ProductoSchema).insert({
    id_categoria: data.id_categoria, codigo: data.codigo.trim(), nombre: data.nombre.trim(),
    descripcion: data.descripcion ?? null, precio: String(data.precio), stock: data.stock,
    imagen: data.imagen ?? null, activo: data.activo === undefined ? 1 : Number(data.activo),
  }));
  return Number(result.identifiers[0].id_producto);
};
export const update = async (id: number, data: UpdateProductDTO): Promise<boolean> => {
  // Never spread HTTP input into an entity; ignored keys stay ignored.
  const values: Record<string, string | number | null> = {};
  for (const field of ['id_categoria', 'codigo', 'nombre', 'descripcion', 'precio', 'stock', 'imagen', 'activo'] as const) {
    const value = data[field];
    if (value === undefined) continue;
    values[field] = field === 'codigo' || field === 'nombre' ? (value as string).trim()
      : field === 'activo' ? Number(value) : field === 'precio' ? String(value) : value as string | number | null;
  }
  if (!Object.keys(values).length) return false;
  return ((await inTransaction(manager => manager.getRepository(ProductoSchema).update({ id_producto: id }, values))).affected ?? 0) > 0;
};
export const deactivate = async (id: number): Promise<boolean> => update(id, { activo: false });
export const updateStock = async (id: number, stock: number): Promise<boolean> => update(id, { stock });
