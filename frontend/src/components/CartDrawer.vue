<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import CartContents from '@/components/CartContents.vue'
import closeIcon from '@/assets/cart/close.svg'
import { useCartPanelStore } from '@/stores/cartPanel'

const panel = useCartPanelStore()
const dialog = ref<HTMLDialogElement | null>(null)

let previousOverflow = ''
let opener: HTMLElement | null = null

onMounted(() => {
  opener = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null

  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value?.showModal()
})

onBeforeUnmount(() => {
  dialog.value?.close()
  document.body.style.overflow = previousOverflow

  if (opener?.isConnected) {
    opener.focus()
  }
})

function closeOnBackdrop(event: MouseEvent) {
  const element = dialog.value

  if (!element || event.target !== element) return

  const bounds = element.getBoundingClientRect()
  const outside =
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom

  if (outside) panel.close()
}

function handleDialogKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return

  const controls = Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    ),
  ).filter(element =>
    element.tabIndex >= 0 &&
    !element.matches(':disabled') &&
    element.getClientRects().length > 0 &&
    !element.closest('[inert]'),
  )

  const first = controls[0]
  const last = controls[controls.length - 1]

  if (!first || !last) return

  const active = dialog.value.ownerDocument.activeElement

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      aria-labelledby="cart-drawer-title"
      class="fixed inset-y-0 left-auto right-0 m-0 box-border
        h-dvh max-h-dvh w-[420px] max-w-full overflow-y-auto
        border-0 bg-white p-0 text-[#13293a]
        shadow-[-3px_0_2px_rgba(226,232,240,0.25)]
        backdrop:bg-black/20"
      @cancel.prevent="panel.close()"
      @close="panel.close()"
      @click="closeOnBackdrop"
      @keydown="handleDialogKeydown"
    >
      <header
        class="box-border flex min-h-[72px] items-center
          justify-between gap-3 border-0 border-b border-solid
          border-slate-200 py-3.5 pl-4 pr-3.5 sm:pl-5"
      >
        <h2
          id="cart-drawer-title"
          class="m-0 text-xl font-semibold text-[#0B2438] sm:text-[22px]"
        >
          Tu carrito
        </h2>

        <button
          type="button"
          aria-label="Cerrar carrito"
          autofocus
          class="grid min-h-[44px] min-w-[44px] cursor-pointer
            place-items-center rounded border-0 bg-white
            focus-visible:outline-2
            focus-visible:outline-[#145a8d]"
          @click="panel.close()"
        >
          <img
            :src="closeIcon"
            alt=""
            width="24"
            height="24"
          />
        </button>
      </header>

      <div class="px-4 pb-4 sm:px-5 sm:pb-5">
        <CartContents />

        <RouterLink
          :to="{ name: 'carrito' }"
          class="mt-3 box-border flex min-h-12 w-full items-center
            justify-center rounded-lg bg-[#103A5C] p-2 text-center
            font-semibold text-white no-underline hover:bg-[#145a8d]
            focus-visible:outline-2
            focus-visible:outline-[#145a8d] transition-colors"
          @click="panel.close()"
        >
          Ver carrito completo
        </RouterLink>
      </div>
    </dialog>
  </Teleport>
</template>