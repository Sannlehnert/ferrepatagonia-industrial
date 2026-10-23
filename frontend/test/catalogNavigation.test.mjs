import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

test('el catálogo está disponible en el menú público sin permisos', async () => {
  const menu = await readFile(
    fileURLToPath(new URL('../src/config/menu.ts', import.meta.url)),
    'utf8',
  )

  assert.match(
    menu,
    /id: 'public-catalog',\s+label: 'Catálogo',\s+routeName: 'catalogo',\s+permission: null,/,
  )
})

test('Inicio ofrece un acceso directo al catálogo', async () => {
  const home = await readFile(
    fileURLToPath(new URL('../src/views/HomeView.vue', import.meta.url)),
    'utf8',
  )

  assert.match(
    home,
    /<RouterLink class="home__catalog-link" :to="\{ name: 'catalogo' \}">/,
  )
})
