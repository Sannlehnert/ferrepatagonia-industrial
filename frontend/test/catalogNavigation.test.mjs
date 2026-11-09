import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

function readSource(path) {
  return readFile(
    fileURLToPath(new URL(path, import.meta.url)),
    'utf8',
  )
}

test('el catálogo está disponible en el menú público sin permisos', async () => {
  const menu = await readSource('../src/config/menu.ts')

  assert.match(
    menu,
    /id: 'public-catalog',\s+label: 'Catálogo',\s+routeName: 'catalogo',\s+permission: null,/,
  )
})

test('el layout público incluye el encabezado y el contenido de la ruta', async () => {
  const layout = await readSource('../src/layouts/PublicLayout.vue')

  assert.match(layout, /<PublicHeader\s*\/>/)
  assert.match(layout, /<RouterView\s*\/>/)
})

test('el encabezado utiliza el menú público con permisos', async () => {
  const header = await readSource('../src/components/PublicHeader.vue')

  assert.match(header, /getNavigableMenu\(publicMenu, getPermissionsForRole\(auth\.rol\)\)/)
})

test('el detalle público tiene una ruta estable bajo el layout público', async () => {
  const router = await readSource('../src/router/index.ts')
  assert.match(router, /path: 'producto\/:id',\s+name: 'producto-detalle',\s+component: \(\) => import\('@\/views\/ProductDetailView\.vue'\)/)
})
