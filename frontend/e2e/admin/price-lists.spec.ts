import { test, expect } from '@playwright/test'

test('ADMIN crea, edita y reactiva una lista manteniendo su asignación', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', {
    name: 'Ingresar',
    exact: true,
  }).click()

  await expect(page).toHaveURL(/\/admin\/dashboard$/)
  await page.goto('/admin/clientes')

  const panel = page.getByRole('region', {
    name: 'Listas de precios',
  })
  const client = page.getByRole('row', { name: /Cliente E2E/ })
  const select = client.getByRole('combobox')
  const save = panel.getByRole('button', {
    name: 'Guardar cambios',
  })

  await expect(select).toBeEnabled()
  const originalList = await select.inputValue()

  try {
    await panel.getByRole('button', { name: 'Nueva lista' }).click()
    await panel.getByLabel('Nombre de la lista').fill('Mayorista')
    await panel.getByLabel('Descuento (%)').fill('12,5')
    await save.click()

    await expect(panel.getByRole('status')).toHaveText('Lista creada.')
    await select.selectOption({ label: 'Mayorista (12.50 %)' })
    await client.getByRole('button', { name: 'Guardar lista' }).click()
    await expect(client.getByRole('status')).toHaveText('Lista asignada.')

    await panel.getByRole('button', {
      name: 'Editar lista Mayorista',
    }).click()
    await panel.getByLabel('Nombre de la lista').fill('Mayorista regional')
    await panel.getByLabel('Descuento (%)').fill('20')
    await panel.getByRole('checkbox', {
      name: 'Activa',
      exact: true,
    }).uncheck()
    await save.click()

    await expect(panel.getByRole('status')).toHaveText('Lista actualizada.')
    await expect(client.getByText('(inactiva)')).toBeVisible()
    await expect(select.getByRole('option', {
      name: 'Mayorista regional (no disponible)',
    })).toBeDisabled()

    await page.reload()
    await expect(panel.getByText(
      'Mayorista regional · 20.00 % · Inactiva',
    )).toBeVisible()
    await expect(client.getByText('(inactiva)')).toBeVisible()

    await panel.getByRole('button', {
      name: 'Editar lista Mayorista regional',
    }).click()
    await panel.getByRole('checkbox', {
      name: 'Activa',
      exact: true,
    }).check()
    await save.click()

    await expect(select.locator('option:checked')).toHaveText(
      'Mayorista regional (20.00 %)',
    )
  } finally {
    // Restaurar la asignación incluso si falla una comprobación.
    // Las siguientes pruebas deben recibir el cliente original.
    await page.goto('/admin/clientes')
    await expect(select).toBeEnabled()

    if (await select.inputValue() !== originalList) {
      await select.selectOption(originalList)
      await client.getByRole('button', { name: 'Guardar lista' }).click()
      await expect(client.getByRole('status')).toHaveText('Lista asignada.')
    }

    await page.reload()
    await expect(select).toHaveValue(originalList)
  }
})