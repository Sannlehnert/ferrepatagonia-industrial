const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const ts = require('typescript')

const renderer = vue.createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert() {},
  remove() {},
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
})

const settle = async () => {
  for (let index = 0; index < 6; index++) {
    await new Promise(resolve => setImmediate(resolve))
    await vue.nextTick()
  }
}

function load(file, mocks = {}, inlineTemplate = false) {
  const filename = path.resolve(__dirname, '../src', file)
  let source = fs.readFileSync(filename, 'utf8')

  if (file.endsWith('.vue')) {
    source = compileScript(parse(source, { filename }).descriptor, {
      id: 'category-test',
      inlineTemplate,
    }).content
  }

  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }

  new Function('require', 'module', 'exports', code)(
    specifier => specifier in mocks ? mocks[specifier] : require(specifier),
    module,
    module.exports,
  )

  return module.exports
}

async function mountForm(t, props = {}) {
  const component = load('components/AdminCategoryForm.vue').default
  component.render = () => null
  const events = []
  const app = renderer.createApp(component, {
    busy: false,
    error: '',
    uncertain: false,
    category: null,
    ...props,
    onSave: fields => events.push(['save', fields]),
    onCancel: () => events.push(['cancel']),
    onReload: () => events.push(['reload']),
  })

  app.mount({})
  t.after(() => app.unmount())
  await settle()

  return { state: app._instance.setupState, events }
}

describe('AdminCategoryForm contextual', () => {
  test('precarga la categoría y detecta cambios sin guardar', async t => {
    const category = { id_categoria: 4, nombre: 'Herramientas', descripcion: 'Línea industrial', activo: 1 }
    const { state } = await mountForm(t, { category })

    assert.equal(state.name, 'Herramientas')
    assert.equal(state.description, 'Línea industrial')
    assert.equal(state.isDirty(), false)

    state.name = 'Herramientas manuales'
    assert.equal(state.isDirty(), true)
  })

  test('valida nombre vacío y longitud por code points sin emitir guardado', async t => {
    const { state, events } = await mountForm(t)
    state.name = '   '
    state.submit()
    assert.equal(events.length, 0)
    assert.equal(state.fieldErrors.nombre, 'Ingresá un nombre de entre 1 y 150 caracteres.')

    state.name = 'a'.repeat(151)
    state.submit()
    assert.equal(events.length, 0)
    assert.ok(state.fieldErrors.nombre)

    state.name = '🛠'.repeat(150)
    state.submit()
    assert.equal(state.fieldErrors.nombre, undefined)
    assert.deepEqual(events, [['save', { nombre: '🛠'.repeat(150), descripcion: null }]])
  })

  test('valida el límite de 65.535 bytes de la descripción', async t => {
    const { state, events } = await mountForm(t)
    state.name = 'Válida'
    state.description = 'é'.repeat(32768)
    state.submit()
    assert.equal(events.length, 0)
    assert.equal(state.fieldErrors.descripcion, 'La descripción supera el límite de 65.535 bytes.')

    state.description = 'é'.repeat(32767) + 'a'
    state.submit()
    assert.equal(state.fieldErrors.descripcion, undefined)
    assert.equal(events.length, 1)
  })

  test('envía nombre recortado y descripción nula si está vacía', async t => {
    const { state, events } = await mountForm(t)
    state.name = '  Categoría nueva  '
    state.description = '   '
    state.submit()

    assert.deepEqual(events, [['save', { nombre: 'Categoría nueva', descripcion: null }]])

    state.description = '  Texto con espacios  '
    state.submit()
    assert.deepEqual(events.at(-1), ['save', {
      nombre: 'Categoría nueva',
      descripcion: '  Texto con espacios  ',
    }])
  })

  test('bloquea guardado y cierre mientras hay una solicitud en curso', async t => {
    const { state, events } = await mountForm(t, { busy: true })
    state.name = 'Categoría'
    state.submit()
    state.requestClose()
    assert.equal(events.length, 0)
  })

  test('pide confirmación antes de descartar cambios y respeta la cancelación', async t => {
    const { state, events } = await mountForm(t)
    let confirmation = false
    global.window = { confirm: () => confirmation }
    t.after(() => { delete global.window })

    state.name = 'Borrador'
    state.requestClose()
    assert.equal(events.length, 0)

    confirmation = true
    state.requestClose()
    assert.deepEqual(events, [['cancel']])
  })

  test('mantiene el borrador cuando el padre informa un error de backend', async t => {
    const category = { id_categoria: 8, nombre: 'Original', descripcion: null, activo: 1 }
    const { state } = await mountForm(t, {
      category,
      error: 'El nombre ya existe.',
    })
    state.name = 'Borrador conservado'
    await settle()

    assert.equal(state.name, 'Borrador conservado')
    assert.deepEqual(state.fieldErrors, {})
  })

  test('en modo incierto bloquea el formulario y ofrece recargar', async t => {
    const { state, events } = await mountForm(t, {
      uncertain: true,
      error: 'No se pudo confirmar el resultado.',
    })
    state.name = 'No se debe enviar'
    state.submit()
    state.requestClose()
    assert.equal(events.length, 0)

    state.reload()
    assert.deepEqual(events, [['reload']])
  })
})

describe('AdminCategoriesView con formulario contextual', () => {
  const baseCategories = [
    { id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 },
    { id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 },
  ]

  function httpError(status, message) {
    return Object.assign(new Error(message), {
      isAxiosError: true,
      response: { status, data: { message } },
    })
  }

  async function mountView(t, overrides = {}) {
    let listCalls = 0
    const service = {
      listAdminCategories: async () => {
        listCalls++
        return baseCategories.map(category => ({ ...category }))
      },
      createAdminCategory: async () => ({ id_categoria: 9, nombre: 'Nueva', descripcion: null, activo: 1 }),
      updateAdminCategory: async () => ({ ...baseCategories[0] }),
      deactivateAdminCategory: async () => ({ ...baseCategories[0], activo: 0 }),
      activateAdminCategory: async () => ({ ...baseCategories[0], activo: 1 }),
      ...overrides,
    }

    const read = () => {
      const data = vue.shallowRef(null)
      const loading = vue.ref(false)
      const error = vue.shallowRef(null)
      let sequence = 0

      return {
        data,
        loading,
        error,
        load: async readData => {
          const current = ++sequence
          loading.value = true
          error.value = null
          try {
            const result = await readData()
            if (current === sequence) data.value = result
          } catch (cause) {
            if (current === sequence) {
              data.value = null
              error.value = cause
            }
          } finally {
            if (current === sequence) loading.value = false
          }
        },
      }
    }

    const auth = {
      user: { id: 1 },
      rol: 'ADMIN',
      sessionVersion: 1,
      isAuthenticated: true,
    }

    const component = load('views/admin/AdminCategoriesView.vue', {
      '@/composables/usePrivateAccountRead': { usePrivateAccountRead: read },
      '@/services/adminCategoryService': service,
      '@/services/adminMutationError': {
        isMutationResultUncertain: cause => {
          const status = cause?.response?.status
          return !status || ![400, 401, 403, 404, 409, 422].includes(status)
        },
      },
      '@/stores/auth': { useAuthStore: () => auth },
      '@/components/AdminCategoryForm.vue': { default: {} },
      '@/components/AdminCategoryDeactivationDialog.vue': { default: {} },
    }).default
    component.render = () => null

    const app = renderer.createApp(component)
    app.mount({})
    t.after(() => app.unmount())
    await settle()

    return {
      state: app._instance.setupState,
      listCalls: () => listCalls,
      service,
      auth,
      unmount: () => app.unmount(),
    }
  }

  function createDomEnvironment(t) {
    const focused = []
    let scrollCalls = []
    let scrollY = 0
    class FakeHTMLElement {
      constructor(tag, text = '') {
        this.tag = tag
        this.text = text
        this.props = {}
        this.children = []
        this.parent = null
        this.selected = false
      }
      get options() {
        return this.children.filter(child => child.tag === 'option')
      }
      get isConnected() {
        let current = this
        while (current.parent) current = current.parent
        return current === rootNode
      }
      addEventListener() {}
      removeEventListener() {}
      focus(options) {
        focused.push({ node: this, options })
      }
    }
    const rootNode = new FakeHTMLElement('root')
    const makeNode = (tag, text = '') => new FakeHTMLElement(tag, text)

    const domRenderer = vue.createRenderer({
      createElement: tag => makeNode(tag),
      createText: text => makeNode('#text', text),
      createComment: text => makeNode('#comment', text),
      insert(el, parent, anchor) {
        el.parent = parent
        const idx = anchor ? parent.children.indexOf(anchor) : -1
        if (idx >= 0) parent.children.splice(idx, 0, el)
        else parent.children.push(el)
      },
      remove(el) {
        if (!el.parent) return
        const idx = el.parent.children.indexOf(el)
        if (idx >= 0) el.parent.children.splice(idx, 1)
        el.parent = null
      },
      setText(el, text) {
        el.text = text
      },
      setElementText(el, text) {
        el.text = text
        el.children = []
      },
      patchProp(el, key, _prev, next) {
        el.props[key] = next
      },
      parentNode: el => el.parent,
      nextSibling: el => {
        if (!el.parent) return null
        const idx = el.parent.children.indexOf(el)
        return el.parent.children[idx + 1] || null
      },
    })

    const walk = (node, predicate, out = []) => {
      if (predicate(node)) out.push(node)
      for (const child of node.children) walk(child, predicate, out)
      return out
    }

    const textOf = node => (node.text || '') + node.children.map(textOf).join('')

    const prevWindow = global.window
    const prevDocument = global.document
    const prevHTMLElement = global.HTMLElement

    global.HTMLElement = FakeHTMLElement
    global.window = {
      get scrollY() { return scrollY },
      set scrollY(v) { scrollY = v },
      scrollTo(x, y) {
        scrollCalls.push([x, y])
        scrollY = y
      },
    }
    global.document = {
      activeElement: null,
      querySelector(selector) {
        const statusMatch = /^\[data-category-status-id="(\d+)"\]$/.exec(selector)
        if (statusMatch) {
          return walk(rootNode, n => String(n.props['data-category-status-id']) === statusMatch[1])[0] ?? null
        }
        const editMatch = /^\[data-category-edit-id="(\d+)"\]$/.exec(selector)
        if (editMatch) {
          return walk(rootNode, n => String(n.props['data-category-edit-id']) === editMatch[1])[0] ?? null
        }
        return null
      },
    }

    t.after(() => {
      if (prevWindow === undefined) delete global.window
      else global.window = prevWindow
      if (prevDocument === undefined) delete global.document
      else global.document = prevDocument
      if (prevHTMLElement === undefined) delete global.HTMLElement
      else global.HTMLElement = prevHTMLElement
    })

    return {
      rootNode,
      domRenderer,
      findAll: predicate => walk(rootNode, predicate),
      textOf,
      focused,
      scrollCalls,
      setScrollY: value => { scrollY = value },
    }
  }

  async function mountRenderedView(t, overrides = {}) {
    const dom = createDomEnvironment(t)
    let listCalls = 0
    const service = {
      listAdminCategories: async () => {
        listCalls++
        return [
          { id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 },
          { id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 0 },
        ]
      },
      createAdminCategory: async () => ({ id_categoria: 9, nombre: 'Nueva', descripcion: null, activo: 1 }),
      updateAdminCategory: async () => ({ ...baseCategories[0] }),
      deactivateAdminCategory: async () => ({ ...baseCategories[0], activo: 0 }),
      activateAdminCategory: async () => ({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 }),
      ...overrides,
    }

    const read = () => {
      const data = vue.shallowRef(null)
      const loading = vue.ref(false)
      const error = vue.shallowRef(null)
      let sequence = 0
      return {
        data,
        loading,
        error,
        load: async readData => {
          const current = ++sequence
          loading.value = true
          error.value = null
          try {
            const result = await readData()
            if (current === sequence) data.value = result
          } catch (cause) {
            if (current === sequence) {
              data.value = null
              error.value = cause
            }
          } finally {
            if (current === sequence) loading.value = false
          }
        },
      }
    }

    const auth = vue.reactive({
      user: { id: 1 },
      rol: 'ADMIN',
      sessionVersion: 1,
      isAuthenticated: true,
    })

    const component = load('views/admin/AdminCategoriesView.vue', {
      '@/composables/usePrivateAccountRead': { usePrivateAccountRead: read },
      '@/services/adminCategoryService': service,
      '@/services/adminMutationError': {
        isMutationResultUncertain: cause => {
          const status = cause?.response?.status
          return !status || ![400, 401, 403, 404, 409, 422].includes(status)
        },
      },
      '@/stores/auth': { useAuthStore: () => auth },
      '@/components/AdminCategoryForm.vue': { default: {} },
      '@/components/AdminCategoryDeactivationDialog.vue': { default: {} },
    }, true).default

    const app = dom.domRenderer.createApp(component)
    app.mount(dom.rootNode)
    t.after(() => app.unmount())
    await settle()

    return {
      ...dom,
      auth,
      listCalls: () => listCalls,
      unmount: () => app.unmount(),
    }
  }

  test('crear actualiza el listado en su lugar y cierra el modal sin recargar', async t => {
    const created = { id_categoria: 3, nombre: 'Zeta', descripcion: null, activo: 1 }
    const { state, listCalls } = await mountView(t, {
      createAdminCategory: async () => created,
    })

    state.openCreate()
    assert.equal(state.formOpen, true)

    await state.save({ nombre: 'Zeta', descripcion: null })

    assert.equal(state.formOpen, false)
    assert.deepEqual(state.categories.map(category => category.nombre), ['Alfa', 'Beta', 'Zeta'])
    assert.equal(state.notice, 'Categoría creada.')
    assert.equal(listCalls(), 1)
  })

  test('editar conserva la lista y la ordena con los datos devueltos por el backend', async t => {
    const edited = { id_categoria: 1, nombre: 'Zulu', descripcion: 'Actualizada', activo: 1 }
    const { state, listCalls } = await mountView(t, {
      updateAdminCategory: async () => edited,
    })

    state.openEdit({ ...baseCategories[0] })
    await state.save({ nombre: 'Zulu', descripcion: 'Actualizada' })

    assert.equal(state.formOpen, false)
    assert.deepEqual(state.categories.map(category => category.nombre), ['Beta', 'Zulu'])
    assert.equal(state.categories.find(category => category.id_categoria === 1).descripcion, 'Actualizada')
    assert.equal(state.notice, 'Categoría actualizada.')
    assert.equal(listCalls(), 1)
  })

  test('un rechazo de validación conserva el modal, el error y los datos del listado', async t => {
    const { state, listCalls } = await mountView(t, {
      updateAdminCategory: async () => { throw httpError(400, 'El nombre ya existe.') },
    })

    state.openEdit({ ...baseCategories[1] })
    await state.save({ nombre: 'Beta duplicada', descripcion: null })

    assert.equal(state.formOpen, true)
    assert.equal(state.editingCategory.id_categoria, 2)
    assert.equal(state.formError, 'El nombre ya existe.')
    assert.equal(state.formUncertain, false)
    assert.deepEqual(state.categories, baseCategories)
    assert.equal(listCalls(), 1)
  })

  test('un error incierto bloquea el formulario y recarga el listado antes de cerrar', async t => {
    let failReload = true
    const { state } = await mountView(t, {
      listAdminCategories: async () => {
        if (failReload) throw new Error('sin conexión')
        return baseCategories
      },
      createAdminCategory: async () => {
        throw httpError(undefined, 'sin respuesta')
      },
    })

    state.openCreate()
    await state.save({ nombre: 'En duda', descripcion: null })

    assert.equal(state.formOpen, true)
    assert.equal(state.formUncertain, true)
    assert.match(state.formError, /bloqueado/)

    await state.reloadAfterUncertain()
    assert.equal(state.formOpen, true)
    assert.equal(state.formUncertain, true)
    assert.equal(state.formError, 'No se pudo recargar el listado. Reintentá antes de continuar.')

    failReload = false
    await state.reloadAfterUncertain()
    assert.equal(state.formOpen, false)
    assert.equal(state.formUncertain, false)
    assert.equal(state.notice, 'Listado actualizado.')
  })

  test('cancelar no modifica el listado y restaura el foco de origen', async t => {
    const { state } = await mountView(t)
    const trigger = { isConnected: true, focus() {} }
    state.openEdit({ ...baseCategories[0] }, { currentTarget: trigger })

    await state.closeForm()
    await settle()

    assert.equal(state.formOpen, false)
    assert.deepEqual(state.categories, baseCategories)
    assert.equal(state.notice, '')
  })

  test('desactivar actualiza el listado en su lugar y cierra el diálogo sin recargar', async t => {
    const { state, listCalls } = await mountView(t)
    state.openDeactivation({ ...baseCategories[0] })

    assert.equal(state.pendingDeactivation.id_categoria, 1)

    await state.confirmDeactivation()

    assert.equal(state.pendingDeactivation, null)
    assert.equal(state.categories.find(category => category.id_categoria === 1).activo, 0)
    assert.equal(state.categories.length, 2)
    assert.equal(state.notice, 'Categoría desactivada.')
    assert.equal(state.deactivationError, '')
    assert.equal(state.deactivationUncertain, false)
    assert.equal(listCalls(), 1)
  })

  test('cancelar la desactivación cierra sin mutar ni recargar el listado', async t => {
    let deactivations = 0
    const { state, listCalls } = await mountView(t, {
      deactivateAdminCategory: async () => {
        deactivations++
        return { ...baseCategories[0], activo: 0 }
      },
    })

    state.openDeactivation({ ...baseCategories[0] })
    state.closeDeactivation()
    await settle()

    assert.equal(state.pendingDeactivation, null)
    assert.equal(deactivations, 0)
    assert.deepEqual(state.categories, baseCategories)
    assert.equal(state.notice, '')
    assert.equal(listCalls(), 1)
  })

  test('impide enviar dos desactivaciones mientras la primera está en vuelo', async t => {
    let deactivations = 0
    let release
    const { state } = await mountView(t, {
      deactivateAdminCategory: () => {
        deactivations++
        return new Promise(resolve => { release = resolve })
      },
    })

    state.openDeactivation({ ...baseCategories[0] })
    const first = state.confirmDeactivation()
    const second = state.confirmDeactivation()

    assert.equal(deactivations, 1)

    release({ ...baseCategories[0], activo: 0 })
    await first
    await second

    assert.equal(deactivations, 1)
    assert.equal(state.pendingDeactivation, null)
  })

  test('un rechazo conserva el diálogo, la categoría y permite reintentar', async t => {
    let attempts = 0
    const { state, listCalls } = await mountView(t, {
      deactivateAdminCategory: async () => {
        attempts++
        if (attempts === 1) throw httpError(400, 'La categoría tiene productos asociados.')
        return { ...baseCategories[1], activo: 0 }
      },
    })

    state.openDeactivation({ ...baseCategories[1] })
    await state.confirmDeactivation()

    assert.equal(state.pendingDeactivation.id_categoria, 2)
    assert.equal(state.deactivationError, 'La categoría tiene productos asociados.')
    assert.equal(state.deactivationUncertain, false)
    assert.deepEqual(state.categories, baseCategories)

    await state.confirmDeactivation()

    assert.equal(attempts, 2)
    assert.equal(state.pendingDeactivation, null)
    assert.equal(state.categories.find(category => category.id_categoria === 2).activo, 0)
    assert.equal(listCalls(), 1)
  })

  test('un resultado incierto bloquea el diálogo y exige recargar antes de cerrar', async t => {
    let failReload = true
    let deactivations = 0
    const { state } = await mountView(t, {
      listAdminCategories: async () => {
        if (failReload) throw new Error('sin conexión')
        return baseCategories
      },
      deactivateAdminCategory: async () => {
        deactivations++
        throw httpError(undefined, 'sin respuesta')
      },
    })

    state.openDeactivation({ ...baseCategories[0] })
    await state.confirmDeactivation()

    assert.equal(state.pendingDeactivation.id_categoria, 1)
    assert.equal(state.deactivationUncertain, true)
    assert.match(state.deactivationError, /quedó bloqueado/)
    assert.equal(deactivations, 1)

    await state.confirmDeactivation()
    state.closeDeactivation()
    await settle()

    assert.equal(deactivations, 1)
    assert.equal(state.pendingDeactivation.id_categoria, 1)

    await state.reloadAfterDeactivationUncertain()

    assert.equal(state.pendingDeactivation.id_categoria, 1)
    assert.equal(state.deactivationUncertain, true)
    assert.equal(state.deactivationError, 'No se pudo recargar el listado. Reintentá antes de continuar.')

    failReload = false
    await state.reloadAfterDeactivationUncertain()

    assert.equal(state.pendingDeactivation, null)
    assert.equal(state.deactivationUncertain, false)
    assert.equal(state.notice, 'Listado actualizado.')
  })

  test('renderiza Activar solo en categorías inactivas y bloquea doble clic TOCTOU', async t => {
    let activateCalls = 0
    let release
    const view = await mountRenderedView(t, {
      activateAdminCategory: () => {
        activateCalls++
        return new Promise(resolve => { release = resolve })
      },
    })

    const buttons = () => view.findAll(n => n.tag === 'button')
    const findByText = label => buttons().find(b => view.textOf(b).trim() === label)
    const statusButton = id => buttons().find(b => b.props['data-category-status-id'] === id)

    assert.equal(view.textOf(statusButton(1)).trim(), 'Desactivar')
    assert.equal(statusButton(1).props['aria-label'], 'Desactivar Alfa')

    const activateBtn = statusButton(2)
    assert.equal(view.textOf(activateBtn).trim(), 'Activar')
    assert.equal(activateBtn.props['aria-label'], 'Activar Beta')

    const firstClick = activateBtn.props.onClick({ currentTarget: activateBtn })
    await vue.nextTick()
    assert.equal(activateCalls, 1)
    assert.equal(findByText('Nueva categoría').props.disabled, true)
    assert.equal(statusButton(2).props.disabled, true)

    await activateBtn.props.onClick({ currentTarget: activateBtn })
    assert.equal(activateCalls, 1)

    release({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 })
    await firstClick
    await settle()

    assert.equal(activateCalls, 1)
    assert.equal(view.textOf(statusButton(2)).trim(), 'Desactivar')
    assert.equal(view.textOf(view.findAll(n => n.props.role === 'status')[0]).trim(), 'Categoría activada.')
  })

  test('activar conserva window.scrollY y devuelve el foco a Desactivar o a #categories-title según filtro', async t => {
    const view = await mountRenderedView(t)
    view.setScrollY(420)

    const activateBtn = view.findAll(n => n.props['data-category-status-id'] === 2)[0]
    await activateBtn.props.onClick({ currentTarget: activateBtn })
    await settle()

    assert.deepEqual(view.scrollCalls.at(-1), [0, 420])
    const focused = view.focused.at(-1)
    assert.equal(focused.node.props['data-category-status-id'], 2)
    assert.equal(view.textOf(focused.node).trim(), 'Desactivar')
    assert.deepEqual(focused.options, { preventScroll: true })
  })

  test('en filtro inactive, activar mueve el foco a #categories-title y conserva scroll', async t => {
    const { state } = await mountView(t, {
      listAdminCategories: async () => [
        { id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 },
        { id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 0 },
      ],
      activateAdminCategory: async () => ({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 }),
    })

    const focused = []
    let scrollY = 315
    const scrollCalls = []
    const prevWindow = global.window
    const prevDocument = global.document
    global.window = {
      get scrollY() { return scrollY },
      scrollTo(x, y) { scrollCalls.push([x, y]); scrollY = y },
    }
    global.document = { querySelector: () => null }
    t.after(() => {
      if (prevWindow === undefined) delete global.window
      else global.window = prevWindow
      if (prevDocument === undefined) delete global.document
      else global.document = prevDocument
    })

    state.titleHeading = { focus: opts => focused.push(['title', opts]) }
    state.filter = 'inactive'
    await vue.nextTick()
    assert.deepEqual(state.visibleCategories.map(c => c.id_categoria), [2])

    await state.activateCategory({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 0 })
    await settle()

    assert.deepEqual(state.visibleCategories, [])
    assert.deepEqual(focused, [['title', { preventScroll: true }]])
    assert.deepEqual(scrollCalls.at(-1), [0, 315])
  })

  test('activar ignora respuesta tardía si cambia la sesión en vuelo', async t => {
    let release
    const view = await mountRenderedView(t, {
      activateAdminCategory: () => new Promise(resolve => { release = resolve }),
    })

    const activateBtn = view.findAll(n => n.props['data-category-status-id'] === 2)[0]
    const pending = activateBtn.props.onClick({ currentTarget: activateBtn })
    await vue.nextTick()

    view.auth.sessionVersion++
    await settle()

    release({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 })
    await pending
    await settle()

    const notices = view.findAll(n => n.tag === 'p' && n.props.role === 'status')
    assert.equal(notices.length, 0)
    assert.equal(view.listCalls(), 2)
  })

  test('error 4xx al activar muestra alerta sin perder listado y error incierto exige Recargar listado', async t => {
    let failActivate = '4xx'
    let failReload = true
    const view = await mountRenderedView(t, {
      listAdminCategories: async () => {
        if (failReload) throw new Error('sin conexión')
        return [
          { id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 },
          { id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 },
        ]
      },
      activateAdminCategory: async () => {
        if (failActivate === '4xx') throw httpError(400, 'No se pudo activar la categoría.')
        throw httpError(502, 'Bad Gateway')
      },
    })

    // Primero cargamos normalmente antes de simular errores
    view.unmount()

    let initialLoad = true
    const view2 = await mountRenderedView(t, {
      listAdminCategories: async () => {
        if (initialLoad) {
          initialLoad = false
          return [
            { id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 },
            { id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 0 },
          ]
        }
        if (failReload) throw new Error('sin conexión')
        return [
          { id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 },
          { id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 },
        ]
      },
      activateAdminCategory: async () => {
        if (failActivate === '4xx') throw httpError(400, 'No se pudo activar la categoría.')
        throw httpError(502, 'Bad Gateway')
      },
    })

    view2.setScrollY(180)
    const activateBtn = view2.findAll(n => n.props['data-category-status-id'] === 2)[0]
    await activateBtn.props.onClick({ currentTarget: activateBtn })
    await settle()

    const alert4xx = view2.findAll(n => n.props.role === 'alert')[0]
    assert.ok(alert4xx)
    assert.match(view2.textOf(alert4xx), /No se pudo activar la categoría\./)
    assert.equal(view2.findAll(n => n.props['data-category-status-id'] === 2).length, 1)
    assert.deepEqual(view2.scrollCalls.at(-1), [0, 180])

    failActivate = '502'
    await activateBtn.props.onClick({ currentTarget: activateBtn })
    await settle()

    const reloadBtn = view2.findAll(n => n.tag === 'button' && view2.textOf(n).trim() === 'Recargar listado')[0]
    assert.ok(reloadBtn)
    assert.equal(view2.findAll(n => n.tag === 'button' && view2.textOf(n).trim() === 'Nueva categoría')[0].props.disabled, true)
    assert.equal(view2.findAll(n => n.props['data-category-status-id'] === 2)[0].props.disabled, true)

    await reloadBtn.props.onClick()
    await settle()
    assert.match(view2.textOf(view2.findAll(n => n.props.role === 'alert')[0]), /No se pudo recargar el listado/)

    failReload = false
    const retryReloadBtn = view2.findAll(n => n.tag === 'button' && view2.textOf(n).trim() === 'Recargar listado')[0]
    await retryReloadBtn.props.onClick()
    await settle()

    assert.equal(view2.findAll(n => n.props.role === 'alert').length, 0)
    assert.equal(view2.textOf(view2.findAll(n => n.props['data-category-status-id'] === 2)[0]).trim(), 'Desactivar')
    assert.equal(view2.textOf(view2.findAll(n => n.tag === 'p' && n.props.role === 'status')[0]).trim(), 'Listado actualizado.')
  })

  test('aviso verde desaparece automáticamente a los 4000 ms para crear, editar, desactivar y activar', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { state } = await mountView(t, {
      listAdminCategories: async () => [
        { id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 },
        { id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 0 },
      ],
      createAdminCategory: async () => ({ id_categoria: 3, nombre: 'Gamma', descripcion: null, activo: 1 }),
      updateAdminCategory: async () => ({ id_categoria: 1, nombre: 'Alfa 2', descripcion: 'Primera', activo: 1 }),
      deactivateAdminCategory: async () => ({ id_categoria: 1, nombre: 'Alfa 2', descripcion: 'Primera', activo: 0 }),
      activateAdminCategory: async () => ({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 }),
    })

    const assertAutoClose = expected => {
      assert.equal(state.notice, expected)
      t.mock.timers.tick(3999)
      assert.equal(state.notice, expected)
      t.mock.timers.tick(1)
      assert.equal(state.notice, '')
    }

    state.openCreate()
    await state.save({ nombre: 'Gamma', descripcion: null })
    assertAutoClose('Categoría creada.')

    state.openEdit({ id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 })
    await state.save({ nombre: 'Alfa 2', descripcion: 'Primera' })
    assertAutoClose('Categoría actualizada.')

    state.openDeactivation({ id_categoria: 1, nombre: 'Alfa 2', descripcion: 'Primera', activo: 1 })
    await state.confirmDeactivation()
    assertAutoClose('Categoría desactivada.')

    await state.activateCategory({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 0 })
    assertAutoClose('Categoría activada.')
  })

  test('un nuevo aviso reinicia la ventana de 4000 ms y desmontar limpia el timer activo', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { state, unmount } = await mountView(t, {
      listAdminCategories: async () => [
        { id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 },
        { id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 0 },
      ],
      activateAdminCategory: async () => ({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 }),
    })

    state.openDeactivation({ id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 })
    await state.confirmDeactivation()
    assert.equal(state.notice, 'Categoría desactivada.')

    t.mock.timers.tick(2500)
    assert.equal(state.notice, 'Categoría desactivada.')

    await state.activateCategory({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 0 })
    assert.equal(state.notice, 'Categoría activada.')

    t.mock.timers.tick(3999)
    assert.equal(state.notice, 'Categoría activada.')
    t.mock.timers.tick(1)
    assert.equal(state.notice, '')

    // Desmontar con timer activo llama a clearTimeout y no deja timers pendientes.
    let cleared = 0
    const origClearTimeout = globalThis.clearTimeout
    t.mock.method(globalThis, 'clearTimeout', id => {
      cleared++
      return origClearTimeout(id)
    })

    await state.activateCategory({ id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 0 })
    assert.equal(state.notice, 'Categoría activada.')
    const clearedBeforeUnmount = cleared
    unmount()
    assert.ok(cleared > clearedBeforeUnmount)
    t.mock.timers.tick(5000)
  })
})
