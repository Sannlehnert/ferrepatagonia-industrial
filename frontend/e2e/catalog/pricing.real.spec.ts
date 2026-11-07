import { test, expect } from '@playwright/test'

type PriceResponse = {
  data: {
    totalUSD: string | null
    datosSinteticos: boolean
    productos: Array<{
      productoId: number
      descuentoAplicado: string
      origenDescuento: string
      precioUnitarioUSD: string | null
      estadoPrecio: string
      evidenciaBaseUSD?: { synthetic: boolean }
    }>
  }
}

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

test('backend real: visitante, cliente nuevo y listas propias al cambiar de sesión',async({page})=>{
  await page.goto('/')

  const quote = async (endpoint:string) => page.evaluate(async path=>{
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({moneda:'USD',productos:[{productoId:25,cantidad:1}]})})
    const body=await response.json() as PriceResponse
    return {status:response.status,cache:response.headers.get('cache-control'),
      vary:response.headers.get('vary'),body}
  },endpoint)
  const publicPrice=await quote('/api/precios')
  expect(publicPrice.status).toBe(200)
  expect(publicPrice.body.data.totalUSD).toBe('125.00')
  expect(publicPrice.body.data.datosSinteticos).toBe(true)
  expect(publicPrice.body.data.productos[0]).toMatchObject({
    productoId: 25,
    descuentoAplicado: '0.00',
    origenDescuento: 'NINGUNO',
    precioUnitarioUSD: '125.00',
    evidenciaBaseUSD: { synthetic: true },
  })

  const signIn=async(email:string)=>{
    await page.goto('/login')
    await page.getByLabel('Email',{exact:true}).fill(email)
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
    await page.getByRole('button',{name:'Ingresar',exact:true}).click()
    await expect(page).toHaveURL(/\/(?:mi-cuenta\/datos|admin\/dashboard)$/)
  }
  const signOut=async()=>{
    const logout=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/logout'&&r.request().method()==='POST')
    await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click()
    await logout
  }

  for(const [email,total,discount,origin] of [
    ['cliente@e2e.test','112.50','10.00','LISTA'],
    ['segundo-cliente@e2e.test','100.00','20.00','LISTA'],
    ['cliente-nuevo@e2e.test','125.00','0.00','NINGUNO'],
    ['cliente@e2e.test','112.50','10.00','LISTA'],
  ]){
    await signIn(email)
    const result=await quote('/api/precios/mios')
    expect(result.status).toBe(200)
    expect(result.body.data.totalUSD).toBe(total)
    expect(result.body.data.productos[0]).toMatchObject({
      descuentoAplicado: discount,
      origenDescuento: origin,
      precioUnitarioUSD: total,
    })
    expect(result.cache).toContain('private, no-store')
    expect(result.vary).toContain('Cookie')
    expect(JSON.stringify(result.body)).not.toMatch(/clienteId|listaId/)

    // The public channel must not inherit the currently authenticated client's list price.
    const publicResult=await quote('/api/precios')
    expect(publicResult.status).toBe(200)
    expect(publicResult.body.data.productos[0]).toMatchObject({
      descuentoAplicado: '0.00',
      origenDescuento: 'NINGUNO',
      precioUnitarioUSD: '125.00',
    })
    await signOut()
  }
})

test('cambio de sesión invalida precios previos y la UI bloquea precios sintéticos privados',async({page})=>{
  const signIn=async(email:string)=>{
    await page.goto('/login')
    await page.getByLabel('Email',{exact:true}).fill(email)
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
    await page.getByRole('button',{name:'Ingresar',exact:true}).click()
    await expect(page).toHaveURL(/\/mi-cuenta\/datos/)
  }
  const openCatalog=async()=>{
    const pricing=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/precios/mios' && r.request().method()==='POST')
    await page.goto('/catalogo?page=3')
    const response=await pricing
    expect(response.status()).toBe(200)
    return (await response.json()).data as PriceResponse['data']
  }
  const card=()=>page.locator('li').filter({hasText:'E2E-25'})

  await signIn('cliente@e2e.test')
  let result=await openCatalog()
  expect(result.datosSinteticos).toBe(true)
  expect(result.productos.find(line=>line.productoId===25)).toMatchObject({
    descuentoAplicado:'10.00',
    origenDescuento:'LISTA',
    precioUnitarioUSD:'112.50',
    estadoPrecio:'DEFINIDO',
    evidenciaBaseUSD:{synthetic:true},
  })
  await expect(card()).toHaveCount(1)
  await expect(card()).toContainText('Precio no disponible')
  await expect(card()).not.toContainText('USD 112.50')
  await expect(card()).not.toContainText('USD 125.00')

  await page.goto('/mi-cuenta/datos')
  const logout=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/logout'&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click()
  await logout
  await expect(page).toHaveURL(/\/login/)

  await signIn('segundo-cliente@e2e.test')
  result=await openCatalog()
  expect(result.productos.find(line=>line.productoId===25)).toMatchObject({
    descuentoAplicado:'20.00',
    origenDescuento:'LISTA',
    precioUnitarioUSD:'100.00',
    estadoPrecio:'DEFINIDO',
    evidenciaBaseUSD:{synthetic:true},
  })
  await expect(card()).toContainText('Precio no disponible')
  await expect(card()).not.toContainText('USD 112.50')
  await expect(card()).not.toContainText('USD 100.00')
})
