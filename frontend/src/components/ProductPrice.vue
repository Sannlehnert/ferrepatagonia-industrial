<script setup lang="ts">
import { computed } from 'vue'
import { precioComprable } from '@/services/pricingService'
import type { PriceLine, PriceState } from '@/types/pricing'
const props = defineProps<{ line?: PriceLine; loading: boolean; error: string; personalized: boolean }>()
const hasDiscount = computed(() => Number(props.line?.descuentoAplicado) > 0
  && props.line?.precioBaseUSD != null)
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
    <p v-else-if="error" class="m-0 text-slate-600">No se pudo consultar el precio</p>
    <template v-else-if="precioComprable(line)">
      <p v-if="hasDiscount" class="m-0 flex flex-wrap items-baseline gap-x-2 text-xs">
        <s class="whitespace-nowrap text-slate-500" aria-label="Precio base">USD {{ line!.precioBaseUSD }}</s>
        <span class="whitespace-nowrap text-green-700">Descuento {{ line!.descuentoAplicado }}%</span>
      </p>
      <p class="m-0 text-base font-semibold">USD {{ line!.precioUnitarioUSD }}</p>
      <p class="m-0 text-xs text-slate-500">{{ line?.compraAcademica ? 'Precio simulado académico' : personalized ? 'Tu precio' : 'Precio público' }} · IVA incluido</p>
      <p v-if="hasDiscount && ['ESPECIAL_PUBLICO', 'AMBOS'].includes(line!.origenDescuento)" class="m-0 text-xs text-green-700">Promoción especial</p>
    </template>
    <p v-else class="m-0 text-slate-600">{{ line?.estadoPrecio === 'DEFINIDO' && line.evidenciaBaseUSD?.synthetic ? 'Precio sintético no disponible' : line ? labels[line.estadoPrecio] : 'Precio a confirmar' }}</p>
  </div>
</template>
