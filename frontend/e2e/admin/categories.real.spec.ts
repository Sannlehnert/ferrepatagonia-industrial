import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('ADMIN crea, edita y desactiva una categoría desde el panel', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })

  const name = `Categoría E2E ${randomUUID().slice(0, 8)}`
  const editedName = `${name} editada`
  const description = 'Descripción original'

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
  await page.goto('/admin/categorias')

  await page.getByRole('button', { name: 'Nueva categoría' }).click()
  await page.getByLabel('Nombre', { exact: true }).fill(name)
  await page.getByLabel('Descripción (opcional)').fill(description)
  await page.getByRole('button', { name: 'Guardar categoría' }).click()

  const edit = page.getByRole('button', { name: `Editar ${name}`, exact: true })
  await expect(edit).toBeVisible()
  await edit.click()
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue(name)
  await expect(page.getByLabel('Descripción (opcional)')).toHaveValue(description)
  await page.getByLabel('Nombre', { exact: true }).fill(editedName)
  await page.getByLabel('Descripción (opcional)').fill('Descripción actualizada')
  await page.getByRole('button', { name: 'Guardar categoría' }).click()

  const heading = page.getByRole('heading', { name: editedName, exact: true })
  const card = page.getByRole('listitem').filter({ has: heading })
  await expect(card.getByText('Descripción actualizada', { exact: true })).toBeVisible()
  await expect(card.getByText('Activa', { exact: true })).toBeVisible()

  const publicNames = async () => {
    const response = await page.request.get('/api/categorias')
    expect(response.ok()).toBe(true)
    const { data } = await response.json()
    return data.categorias.map((category: { nombre: string }) => category.nombre)
  }

  expect(await publicNames()).toContain(editedName)

  const filter = page.getByRole('combobox', { name: 'Estado' })
  await filter.selectOption('active')
  await card.getByRole('button', { name: `Desactivar ${editedName}`, exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar desactivación' }).click()

  await expect(page.getByText('Categoría desactivada.', { exact: true })).toBeVisible()
  await expect(heading).toHaveCount(0)
  await filter.selectOption('inactive')
  await expect(card.getByText('Inactiva', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: /^Desactivar/ })).toHaveCount(0)
  expect(await publicNames()).not.toContain(editedName)
})