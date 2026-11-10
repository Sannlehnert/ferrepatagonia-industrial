import api from '@/services/api'

const importPath = '/admin/productos/importar'

export interface ImportIssue {
  field: string
  code: string
  message: string
}

export interface ImportPreviewRow {
  row: number
  producto: {
    codigo: string
    nombre: string
    id_categoria: number
    precio_base_usd: string | null
    stock: number
    descripcion: string | null
    imagen: string | null
    activo: boolean
    descuento_especial_pct: number | null
  }
}

export interface ImportPreview {
  version: 'FER16-v2'
  previewToken: string
  expiresAt: string
  totalRows: number
  validRowsCount: number
  invalidRowsCount: number
  duplicateInFileCount: number
  existingInDbCount: number
  valid: boolean
  errors: Array<ImportIssue & { row: number }>
  validRows: ImportPreviewRow[]
}

export interface ImportReport {
  version: 'FER16-v2'
  previewToken: string
  estado: 'pendiente' | 'procesando' | 'por_verificar' | 'completado'
  totalProcesados: number
  importados: number
  omitidos: number
  rechazados: number
  pendientes: number
  detalles: Array<{
    row: number
    codigo: string
    estado: 'importado' | 'omitido' | 'rechazado' | 'pendiente'
    motivos: ImportIssue[]
    id_producto?: number
  }>
}

export async function previewProductImport(file: File, signal?: AbortSignal) {
  const form = new FormData()
  form.append('file', file)

  const { data } = await api.post<ImportPreview>(`${importPath}/previsualizar`, form, {
    signal,
  })
  return data
}

export async function confirmProductImport(previewToken: string, signal?: AbortSignal) {
  const { data } = await api.post<ImportReport>(
    `${importPath}/confirmar`,
    { previewToken },
    { signal },
  )
  return data
}

export async function getProductImportStatus(previewToken: string, signal?: AbortSignal) {
  const { data } = await api.get<ImportReport>(
    `${importPath}/confirmaciones/${encodeURIComponent(previewToken)}`,
    { signal },
  )
  return data
}