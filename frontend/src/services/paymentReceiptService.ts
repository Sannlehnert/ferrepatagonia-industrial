import api from './api'

export type ReceiptReviewStatus = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'

export type ReceiptReviewDecision =
  | { estado: 'APROBADO' }
  | { estado: 'RECHAZADO'; motivo: string }

export interface PaymentReceipt {
  id: string
  clienteId?: number
  cliente?: string
  pedidoId: number | null
  cuentaCorrienteId: number | null
  tipoMime: 'application/pdf' | 'image/jpeg' | 'image/png'
  bytes: number
  fecha: string
  estadoRevision: ReceiptReviewStatus
  revisadoEn: string | null
  motivoRechazo?: string | null
}

export interface ReceiptPage {
  items: PaymentReceipt[]
  paginaSiguiente: number | null
}

export const accountReceiptsPath = '/cuenta-corriente/comprobantes'
export const adminReceiptsPath = '/admin/comprobantes'
export const orderReceiptsPath = (orderId: number) =>
  '/pedidos/' + orderId + '/comprobantes'

export type ReceiptMime = 'application/pdf' | 'image/jpeg' | 'image/png'

const receiptMimes: Record<ReceiptMime, true> = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true,
}

// Los navegadores móviles a veces informan MIME vacío, `image/jpg` o
// `application/octet-stream` para archivos válidos descargados por la app del
// banco. La extensión solo se usa para declarar el tipo: el backend siempre
// valida la firma binaria y la estructura real.
export function receiptMime(file: Pick<File, 'name' | 'type'>): ReceiptMime | null {
  const declared = file.type.trim().toLowerCase()
  if (declared === 'image/jpg') return 'image/jpeg'
  if (Object.hasOwn(receiptMimes, declared)) return declared as ReceiptMime
  if (declared && declared !== 'application/octet-stream') return null
  const extension = /\.([^.]+)$/.exec(file.name.trim().toLowerCase())?.[1]
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  return null
}

export function supportsOrderReceipts(
  clientType: string | null | undefined,
  paymentMethod: string,
  companyApproval: string | null | undefined = null,
  companyAccountEnabled?: boolean | null,
) {
  return (
    paymentMethod === 'TRANSFERENCIA'
    && (
      clientType === 'PARTICULAR'
      || (
        clientType === 'EMPRESA'
        && companyApproval === 'APROBADA'
      )
    )
  ) || (
    clientType === 'EMPRESA'
    && paymentMethod === 'CUENTA_CORRIENTE'
    && companyAccountEnabled !== null
  )
}

export async function listPaymentReceipts(
  path: string,
  pagina: number,
  signal: AbortSignal,
) {
  return (
    await api.get<{ data: ReceiptPage }>(path, {
      params: { pagina },
      signal,
    })
  ).data.data
}

export async function uploadPaymentReceipt(
  path: string,
  file: File,
  signal: AbortSignal,
  mime?: ReceiptMime,
) {
  const resolved = mime ?? receiptMime(file)
  if (!resolved) throw new Error('TIPO_NO_PERMITIDO')
  const response = await api.post(path, file, {
    headers: { 'Content-Type': resolved },
    signal,
  })

  return response.status === 201
}

export async function markPaymentReceiptReviewed(
  path: string,
  id: string,
  signal: AbortSignal,
  decision: ReceiptReviewDecision = { estado: 'APROBADO' },
  idempotencyKey: string = crypto.randomUUID(),
) {
  await api.patch(path + '/' + id + '/revision', decision, {
    headers: { 'Idempotency-Key': idempotencyKey },
    signal,
  })
}