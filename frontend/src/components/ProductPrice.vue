<script setup lang="ts">
import { precioComprable } from '@/services/pricingService'
import type { PriceLine, PriceState } from '@/types/pricing'
defineProps<{ line?: PriceLine; loading: boolean; error: string; personalized: boolean }>()
const labels: Record<PriceState, string> = {
  DEFINIDO: 'Precio a confirmar',
  PRECIO_AUSENTE: 'Precio a confirmar',
  BASE_CERO: 'Precio base cero · No comprable',
  BASE_NO_VERIFICADA: 'Precio pendiente de verificación',
  FINAL_CERO: 'Precio final cero · No comprable',
  ARS_CERO: 'Precio en ARS no habilitado',
}
</script>

<template>
  <div class="my-2 min-w-0 break-words text-sm" aria-live="polite">
    <p v-if="loading" class="m-0 text-slate-500">Consultando precios…</p>
    <p v-else-if="error" class="m-0 text-slate-600">Precio no disponible</p>
    <template v-else-if="precioComprable(line)">
      <p class="m-0 text-base font-semibold">USD {{ line!.precioUnitarioUSD }}</p>
      <p class="m-0 text-xs text-slate-500">{{ line?.compraAcademica ? 'Precio simulado académico' : personalized ? 'Tu precio' : 'Precio público' }} · IVA incluido</p>
      <p v-if="line!.descuentoAplicado !== '0.00'" class="m-0 text-xs text-green-700">
        Descuento {{ line!.descuentoAplicado }}%
        <span v-if="['ESPECIAL_PUBLICO', 'AMBOS'].includes(line!.origenDescuento)"> · Promoción especial</span>
      </p>
    </template>
    <p v-else class="m-0 text-slate-600">{{ line ? labels[line.estadoPrecio] : 'Precio a confirmar' }}</p>
  </div>
</template>
