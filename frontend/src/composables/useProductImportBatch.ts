import axios from 'axios'
import { computed, onScopeDispose, ref, watch } from 'vue'
import {
  confirmProductImport,
  getProductImportStatus,
  previewProductImport,
  type ImportPreview,
  type ImportReport,
} from '@/services/adminProductImportApi'
import { useAuthStore } from '@/stores/auth'

type Operation = 'preview' | 'confirm' | 'status'

const maxFileSize = 5 * 1024 * 1024

function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    const message = error.response?.data?.message
    if (typeof message === 'string' && message.trim()) return message
  }

  return fallback
}

export function useProductImportBatch() {
  const auth = useAuthStore()
  const preview = ref<ImportPreview | null>(null)
  const report = ref<ImportReport | null>(null)
  const selectedFileName = ref('')
  const recoveryToken = ref('')
  const reportUnavailable = ref(false)
  const error = ref('')
  const operation = ref<Operation | null>(null)

  let activeRequest: AbortController | undefined

  const storageKey = computed(() => {
    if (auth.rol !== 'ADMIN' || auth.user?.id == null) return null
    return `admin-product-import:v2:${auth.user.id}`
  })

  const busy = computed(() => operation.value !== null)
  const canSelectFile = computed(() => Boolean(storageKey.value) && !busy.value && !recoveryToken.value)
  const canConfirm = computed(() => {
    if (!storageKey.value || busy.value) return false
    if (recoveryToken.value) return report.value?.estado === 'pendiente'
    return (preview.value?.validRowsCount ?? 0) > 0
  })

  function run(
    kind: Operation,
    work: (signal: AbortSignal) => Promise<void>,
    onError: (cause: unknown) => void,
  ) {
    const request = new AbortController()
    activeRequest = request
    operation.value = kind
    error.value = ''

    return work(request.signal)
      .catch((cause: unknown) => {
        if (!request.signal.aborted) onError(cause)
      })
      .finally(() => {
        if (activeRequest === request) {
          activeRequest = undefined
          operation.value = null
        }
      })
  }

  function receiveReport(value: ImportReport, key: string) {
    report.value = value
    if (value.estado !== 'completado') return

    try {
      sessionStorage.removeItem(key)
    } catch {
      // Si no se puede borrar, una recarga volverá a consultar el mismo lote.
    }
    recoveryToken.value = ''
    preview.value = null
  }

  async function selectFile(file: File) {
    if (!canSelectFile.value) return

    preview.value = null
    report.value = null
    selectedFileName.value = file.name
    error.value = ''

    if (!/\.(csv|xlsx)$/i.test(file.name) || file.size === 0 || file.size > maxFileSize) {
      error.value = 'Elegí un archivo CSV o XLSX de hasta 5 MiB y con contenido.'
      return
    }

    await run('preview', async (signal) => {
      const result = await previewProductImport(file, signal)
      if (!signal.aborted) preview.value = result
    }, (cause) => {
      error.value = errorMessage(cause, 'No se pudo previsualizar la planilla.')
    })
  }

  async function confirm() {
    const key = storageKey.value
    const token = recoveryToken.value || preview.value?.previewToken
    if (!canConfirm.value || !key || !token) return

    try {
      sessionStorage.setItem(key, token)
    } catch {
      error.value = 'No se pudo guardar el identificador del lote. La confirmación no se envió.'
      return
    }

    recoveryToken.value = token
    report.value = null

    await run('confirm', async (signal) => {
      const result = await confirmProductImport(token, signal)
      if (!signal.aborted) receiveReport(result, key)
    }, (cause) => {
      const message = errorMessage(cause, 'No se pudo confirmar el resultado de la importación.')
      error.value = `${message} Consultá el estado del mismo lote antes de reintentar.`
    })
  }

  async function refreshStatus() {
    const key = storageKey.value
    const token = recoveryToken.value
    if (!key || !token || busy.value) return

    reportUnavailable.value = false

    await run('status', async (signal) => {
      const result = await getProductImportStatus(token, signal)
      if (!signal.aborted) receiveReport(result, key)
    }, (cause) => {
      if (axios.isAxiosError(cause) && cause.response?.status === 410) {
        try {
          sessionStorage.removeItem(key)
        } catch {
          // El servidor ya confirmó que la previsualización venció sin iniciar.
        }
        recoveryToken.value = ''
        preview.value = null
        report.value = null
        error.value = 'La previsualización venció. Volvé a seleccionar el archivo.'
        return
      }

      if (axios.isAxiosError(cause) && cause.response?.status === 404) {
        report.value = null
        reportUnavailable.value = true
        error.value = 'El servidor ya no encuentra el reporte. Revisá el catálogo antes de volver a importar.'
        return
      }

      error.value = errorMessage(cause, 'No se pudo consultar el estado del lote.')
    })
  }

  function stopTrackingBatch() {
    const key = storageKey.value
    if (!key || busy.value || !reportUnavailable.value) return

    try {
      sessionStorage.removeItem(key)
    } catch {
      error.value = 'No se pudo quitar el lote guardado de esta pestaña.'
      return
    }

    reportUnavailable.value = false
    recoveryToken.value = ''
    preview.value = null
    report.value = null
    selectedFileName.value = ''
    error.value = ''
  }

  watch(() => auth.sessionVersion, () => {
    activeRequest?.abort()
    activeRequest = undefined
    operation.value = null
    preview.value = null
    report.value = null
    selectedFileName.value = ''
    recoveryToken.value = ''
    reportUnavailable.value = false
    error.value = ''

    const key = storageKey.value
    if (!key) return

    try {
      recoveryToken.value = sessionStorage.getItem(key) ?? ''
    } catch {
      error.value = 'No se pudo leer el estado guardado de la importación.'
      return
    }

    if (recoveryToken.value) void refreshStatus()
  }, { immediate: true, flush: 'sync' })

  onScopeDispose(() => activeRequest?.abort())

  return {
    preview,
    report,
    selectedFileName,
    recoveryToken,
    error,
    operation,
    busy,
    canSelectFile,
    canConfirm,
    selectFile,
    confirm,
    refreshStatus,
    reportUnavailable,
    stopTrackingBatch,
  }
}