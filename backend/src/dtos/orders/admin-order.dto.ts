import { AdminOrderError } from '../../services/orders/admin-order.errors';

export const ADMIN_ORDER_OPERATIONAL_STATES = [
  'CONFIRMADO',
  'EN_PREPARACION',
  'ENVIADO',
  'ENTREGADO',
] as const;

export const ADMIN_ORDER_FILTERABLE_STATES = [
  ...ADMIN_ORDER_OPERATIONAL_STATES,
  'DEMO_REGISTRADO',
] as const;

export type AdminOrderOperationalStatus = (typeof ADMIN_ORDER_OPERATIONAL_STATES)[number];
export type AdminOrderFilterStatus = (typeof ADMIN_ORDER_FILTERABLE_STATES)[number];

export const ADMIN_ORDER_TRANSITIONS: Record<
  string,
  readonly AdminOrderOperationalStatus[]
> = {
  CONFIRMADO: ['EN_PREPARACION'] as const,
  EN_PREPARACION: ['ENVIADO', 'ENTREGADO'] as const,
  ENVIADO: ['ENTREGADO'] as const,
  ENTREGADO: [] as const,
};

export interface AdminOrderListFilters {
  page: number;
  limit: number;
  estado?: AdminOrderFilterStatus;
  modalidadPago?: string;
  clienteId?: number;
  fecha?: string; // YYYY-MM-DD (P1)
  q?: string;
}

const MAX_INT_32 = 2147483647;
const ALLOWED_QUERY_KEYS = new Set([
  'page',
  'limit',
  'estado',
  'modalidadPago',
  'clienteId',
  'fecha',
  'q',
]);

function parsePositiveInt(value: unknown, fieldLabel: string, max = MAX_INT_32): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw new AdminOrderError(
        'PARAMETRO_INVALIDO',
        400,
        `El parámetro ${fieldLabel} debe ser un entero entre 1 y ${max}.`,
      );
    }
    return value;
  }

  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new AdminOrderError(
      'PARAMETRO_INVALIDO',
      400,
      `El parámetro ${fieldLabel} debe ser un entero positivo válido.`,
    );
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new AdminOrderError(
      'PARAMETRO_INVALIDO',
      400,
      `El parámetro ${fieldLabel} supera el rango permitido.`,
    );
  }

  return parsed;
}

export function parseAdminOrderIdParam(rawId: unknown): number {
  return parsePositiveInt(rawId, 'id');
}

export function parseAdminOrderListQuery(
  query: Record<string, unknown>,
): AdminOrderListFilters {
  for (const key of Object.keys(query)) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new AdminOrderError(
        'PARAMETRO_NO_PERMITIDO',
        400,
        `El parámetro de consulta '${key}' no está permitido.`,
      );
    }
  }

  const page = query.page === undefined || query.page === ''
    ? 1
    : parsePositiveInt(query.page, 'page', 10000);

  const limit = query.limit === undefined || query.limit === ''
    ? 20
    : parsePositiveInt(query.limit, 'limit', 50);

  let estado: AdminOrderFilterStatus | undefined;
  if (query.estado !== undefined && query.estado !== '') {
    if (
      typeof query.estado !== 'string' ||
      !(ADMIN_ORDER_FILTERABLE_STATES as readonly string[]).includes(query.estado)
    ) {
      throw new AdminOrderError(
        'ESTADO_FILTRO_INVALIDO',
        400,
        'El estado indicado para filtrar no es válido.',
      );
    }
    estado = query.estado as AdminOrderFilterStatus;
  }

  let modalidadPago: string | undefined;
  if (query.modalidadPago !== undefined && query.modalidadPago !== '') {
    if (
      typeof query.modalidadPago !== 'string' ||
      !/^[A-Z0-9_]{2,50}$/.test(query.modalidadPago)
    ) {
      throw new AdminOrderError(
        'MODALIDAD_FILTRO_INVALIDA',
        400,
        'La modalidad de pago indicada no es válida.',
      );
    }
    modalidadPago = query.modalidadPago;
  }

  let clienteId: number | undefined;
  if (query.clienteId !== undefined && query.clienteId !== '') {
    clienteId = parsePositiveInt(query.clienteId, 'clienteId');
  }

  let q: string | undefined;
  if (query.q !== undefined && query.q !== '') {
    if (typeof query.q !== 'string') {
      throw new AdminOrderError(
        'BUSQUEDA_INVALIDA',
        400,
        'El texto de búsqueda no es válido.',
      );
    }
    const trimmed = query.q.trim();
    if (trimmed.length > 100) {
      throw new AdminOrderError(
        'BUSQUEDA_INVALIDA',
        400,
        'El texto de búsqueda no puede superar los 100 caracteres.',
      );
    }
    if (trimmed.length > 0) {
      q = trimmed;
    }
  }

  let fecha: string | undefined;
  if (query.fecha !== undefined && query.fecha !== '') {
    if (typeof query.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(query.fecha)) {
      throw new AdminOrderError(
        'PARAMETRO_INVALIDO',
        400,
        'La fecha debe tener el formato YYYY-MM-DD.',
      );
    }
    fecha = query.fecha;
  }

  return {
    page,
    limit,
    ...(estado !== undefined ? { estado } : {}),
    ...(modalidadPago !== undefined ? { modalidadPago } : {}),
    ...(clienteId !== undefined ? { clienteId } : {}),
    ...(fecha !== undefined ? { fecha } : {}),
    ...(q !== undefined ? { q } : {}),
  };
}

export function parseAdminOrderStatusBody(
  body: unknown,
): { estado: AdminOrderOperationalStatus } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AdminOrderError(
      'CUERPO_INVALIDO',
      400,
      'El cuerpo de la solicitud debe ser un objeto JSON válido.',
    );
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);

  if (keys.length !== 1 || keys[0] !== 'estado') {
    throw new AdminOrderError(
      'CAMPOS_NO_PERMITIDOS',
      400,
      'Solo se permite especificar el campo "estado". No se admiten escrituras financieras ni campos adicionales.',
    );
  }

  const rawEstado = record.estado;
  if (
    typeof rawEstado !== 'string' ||
    !(ADMIN_ORDER_OPERATIONAL_STATES as readonly string[]).includes(rawEstado)
  ) {
    throw new AdminOrderError(
      'ESTADO_PEDIDO_NO_AUTORIZADO',
      400,
      'El estado solicitado no está autorizado o definido en el contrato.',
    );
  }

  return { estado: rawEstado as AdminOrderOperationalStatus };
}

export function getAllowedNextStates(
  currentState: string,
  modalidadPago: string,
): readonly AdminOrderOperationalStatus[] {
  if (currentState.startsWith('DEMO_') || modalidadPago.startsWith('DEMO_')) {
    return [];
  }
  return ADMIN_ORDER_TRANSITIONS[currentState] ?? [];
}