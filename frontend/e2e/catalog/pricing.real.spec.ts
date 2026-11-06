import { test, expect } from '@playwright/test'

// No route interception: real Express + Passport + TypeORM + disposable MariaDB.
// Existing legacy fixture prices have NO USD evidence. They must never be published as accredited USD.
test('backend real: catálogo y Home bloquean bases sin evidencia USD', async ({ page }) => {
  const pricing = page.waitForResponse(r => r.url().endsWith('/api/precios') && r.request().method() === 'POST')
  await page.goto('/catalogo')
  const response = await pricing
  expect(response.status()).toBe(200)
  const result = (await response.json()).data
  expect(result.regla).toBe('FER17-v1')
  expect(result.productos).toHaveLength(12)
  for (const product of result.productos) {
    expect(product.estadoPrecio).toBe('BASE_NO_VERIFICADA')
    expect(product.precioUnitarioUSD).toBeNull()
    expect(product.precioComprable).toBe(false)
  }
  await expect(page.getByText('Precio pendiente de verificación',{exact:true})).toHaveCount(12)
  await expect(page.getByText(/USD \d/)).toHaveCount(0)
  for(const button of await page.getByRole('button',{name:'Agregar',exact:true}).all()) await expect(button).toBeDisabled()
  await page.goto('/')
  await expect(page.getByText('Precio pendiente de verificación',{exact:true})).toHaveCount(5)
})
for (const account of [
  {email:'cliente@e2e.test',endpoint:'/api/precios/mios'},
  {email:'admin@e2e.test',endpoint:'/api/precios'},
]) test(`backend real: ${account.email} consulta el canal autorizado sin publicar legacy`,async({page})=>{
  await page.goto('/login')
  await page.getByLabel('Email',{exact:true}).fill(account.email)
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button',{name:'Ingresar',exact:true}).click()
  await expect(page).toHaveURL(/\/(?:mi-cuenta\/datos|admin\/dashboard)$/)
  const pending = page.waitForResponse(r=>new URL(r.url()).pathname===account.endpoint && r.request().method()==='POST')
  await page.goto('/catalogo')
  const response = await pending
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toContain('no-store')
  const result=(await response.json()).data
  expect(result.productos.every((p:any)=>p.estadoPrecio==='BASE_NO_VERIFICADA' && p.precioUnitarioUSD===null)).toBe(true)
  await expect(page.getByText('Precio pendiente de verificación',{exact:true})).toHaveCount(12)
})
