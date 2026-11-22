const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const source = relativePath => readFileSync(resolve(__dirname, '..', relativePath), 'utf8')

const resetControlFiles = {
  dashboard: 'src/views/cuenta/MiCuentaDashboardView.vue',
  layout: 'src/views/cuenta/MiCuentaLayout.vue',
  history: 'src/views/cuenta/HistorialPedidos.vue',
  detail: 'src/components/ClientOrderDetail.vue',
  actions: 'src/components/OrderReceiptActions.vue',
  dialog: 'src/components/OrderReceiptDialog.vue',
  company: 'src/components/CompanyStatus.vue',
}

function openingButtonTags(markup) {
  return [...markup.matchAll(/<button\b[\s\S]*?>/g)].map(match => match[0])
}

test('todos los botones de las vistas de cuenta declaran reset, foco y cursor explícitos', () => {
  for (const [name, file] of Object.entries(resetControlFiles)) {
    const markup = source(file)
    const buttons = openingButtonTags(markup)
    assert.ok(buttons.length > 0, `${name} debe declarar al menos un botón`)
    for (const button of buttons) {
      const classMatch = button.match(/class="([^"]+)"/)
      assert.ok(classMatch, `${name}: todo botón debe declarar clases explícitas`)
      const classes = classMatch[1]
      for (const token of [
        'box-border',
        'font-[inherit]',
        'cursor-pointer',
        'focus-visible:outline-2',
        'focus-visible:outline-solid',
        'focus-visible:outline-offset-2',
      ]) {
        assert.ok(classes.includes(token), `${name}: falta ${token} en ${button}`)
      }
    }
  }
})

test('los botones textuales son transparentes y sin borde nativo', () => {
  const cases = [
    ['dashboard', 'Reintentar comprobantes', 'src/views/cuenta/MiCuentaDashboardView.vue'],
    ['history', 'Limpiar filtros', 'src/views/cuenta/HistorialPedidos.vue'],
    ['history', 'Reintentar estados de comprobantes', 'src/views/cuenta/HistorialPedidos.vue'],
    ['actions', 'Reintentar', 'src/components/OrderReceiptActions.vue'],
  ]
  for (const [name, label, file] of cases) {
    const markup = source(file)
    const index = markup.indexOf(label)
    assert.ok(index > 0, `${name}: no se encontró ${label}`)
    const start = markup.lastIndexOf('<button', index)
    const tag = markup.slice(start, markup.indexOf('>', index) + 1)
    assert.match(tag, /bg-transparent/, `${name}: ${label} debe tener fondo transparente`)
    assert.match(tag, /border-0/, `${name}: ${label} debe anular el borde nativo`)
  }
})

test('los botones con borde conservan fondo blanco, borde sólido y tipografía heredada', () => {
  const cases = [
    ['dashboard', '@click="loadOrders()"', 'src/views/cuenta/MiCuentaDashboardView.vue'],
    ['history', '@click="loadOrders()"', 'src/views/cuenta/HistorialPedidos.vue'],
    ['detail', '@click="loadDetail()"', 'src/components/ClientOrderDetail.vue'],
    ['actions', 'Ver / adjuntar', 'src/components/OrderReceiptActions.vue'],
    ['dialog', 'Cerrar comprobantes', 'src/components/OrderReceiptDialog.vue'],
  ]
  for (const [name, label, file] of cases) {
    const markup = source(file)
    const index = markup.indexOf(label)
    assert.ok(index > 0, `${name}: no se encontró ${label}`)
    const start = markup.lastIndexOf('<button', index)
    const tag = markup.slice(start, markup.indexOf('>', index) + 1)
    assert.match(tag, /bg-white/, `${name}: ${label} debe tener fondo blanco explícito`)
    assert.match(tag, /border border-solid/, `${name}: ${label} debe conservar borde visible`)
  }
})

test('los selectores de historial conservan borde sólido y reemplazan focus:outline-none', () => {
  const markup = source('src/views/cuenta/HistorialPedidos.vue')
  assert.doesNotMatch(markup, /focus:outline-none/)
  for (const id of ['filtro-fecha', 'filtro-comprobante', 'filtro-estado']) {
    const index = markup.indexOf(`id="${id}"`)
    assert.ok(index > 0, `Falta el control ${id}`)
    const tag = markup.slice(markup.lastIndexOf('<', index), markup.indexOf('>', index) + 1)
    assert.match(tag, /border border-solid/)
    assert.match(tag, /font-\[inherit\]/)
    assert.match(tag, /focus-visible:outline-2/)
    assert.match(tag, /focus-visible:outline-offset-2/)
  }
})

test('el layout móvil y de escritorio conserva reset completo en sus controles', () => {
  const markup = source('src/views/cuenta/MiCuentaLayout.vue')
  assert.equal(openingButtonTags(markup).length, 5)
  assert.match(markup, /border border-solid border-\[#7595AD\]/)
  assert.match(markup, /focus-visible:outline-white/)
})

test('CompanyStatus usa badges con contraste AA y no depende solo del color', () => {
  const markup = source('src/components/CompanyStatus.vue')
  assert.doesNotMatch(markup, /text-\[#16A34A\]|text-\[#D97706\]|text-\[#DC2626\]|text-\[#64748B\]/)
  for (const color of ['text-green-800', 'text-amber-900', 'text-red-800', 'text-slate-700']) {
    assert.ok(markup.includes(color), `Falta ${color}`)
  }
  for (const label of ['Aprobada', 'Pendiente', 'Rechazada', 'Sin cuenta']) {
    assert.ok(markup.includes(label), `Falta el texto de estado ${label}`)
  }
  assert.match(markup, /role="alert"/)
})

test('PaymentReceipts usa tonos AA para estados, avisos y errores', () => {
  const markup = source('src/components/PaymentReceipts.vue')
  const paymentUtils = source('src/utils/payment.ts')
  assert.doesNotMatch(markup, /text-\[#16A34A\]|text-\[#D97706\]|text-\[#DC2626\]/)
  for (const color of ['text-green-800', 'text-red-800']) {
    assert.ok(markup.includes(color), `Falta ${color}`)
  }
  assert.match(markup, /receiptBadge\(receipt\.estadoRevision\)/)
  assert.match(paymentUtils, /export const STATE_BADGE_TONES = \{[\s\S]*?#166534[\s\S]*?#92400E[\s\S]*?#B91C1C[\s\S]*?#475569/)
  assert.match(markup, /role="status"/)
  assert.match(markup, /role="alert"/)
})

test('las combinaciones de badge y alerta alcanzan 4.5:1 según WCAG 2.1 AA', () => {
  function luminance(hex) {
    const channels = hex.replace('#', '').match(/../g).map(value => Number.parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  function contrast(foreground, background) {
    const first = luminance(foreground)
    const second = luminance(background)
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  }
  const pairs = [
    ['#166534', '#DCFCE7', 'Aprobada'],
    ['#78350F', '#FEF3C7', 'Pendiente'],
    ['#991B1B', '#FEE2E2', 'Rechazada'],
    ['#334155', '#F1F5F9', 'Sin cuenta'],
    ['#991B1B', '#FEF1F1', 'Alerta de error'],
    ['#166534', '#FFFFFF', 'Aviso exitoso'],
    ['#78350F', '#FFFBEB', 'Comprobante pendiente'],
    ['#065F46', '#ECFDF5', 'Comprobante revisado'],
    ['#166534', '#DCFCE7', 'Badge centralizado positive'],
    ['#92400E', '#FEF3C7', 'Badge centralizado warning'],
    ['#B91C1C', '#FEE2E2', 'Badge centralizado danger'],
    ['#475569', '#F1F5F9', 'Badge centralizado neutral'],
  ]
  for (const [foreground, background, label] of pairs) {
    const ratio = contrast(foreground, background)
    assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1 no alcanza 4.5:1`)
  }
})
