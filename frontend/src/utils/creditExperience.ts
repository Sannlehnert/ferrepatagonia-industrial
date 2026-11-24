import type { CuentaCorrienteConsulta } from '@/types/cuentaCorriente'
import type { CreditRequest } from '@/types/creditRequest'
import type { UsuarioSesion } from '@/types/auth'

export type CreditExperienceTone = 'positive' | 'warning' | 'danger' | 'neutral' | 'info'

export type CreditExperienceAction =
  | 'catalogo'
  | 'solicitar'
  | 'ver-solicitud'
  | 'actualizar'
  | 'vencimientos'
  | 'movimientos'
  | 'comprobantes'
  | null

export interface CreditExperience {
  key: string
  title: string
  description: string
  nextStep: string
  actionLabel: string
  action: CreditExperienceAction
  tone: CreditExperienceTone
  hasOperationalAccount: boolean
}

export interface ClientCreditInput {
  approval: UsuarioSesion['estadoAprobacionEmpresa'] | undefined
  account: CuentaCorrienteConsulta | null
  accountKnown: boolean
  accountFailed?: boolean
  latestRequest: CreditRequest | null
  requestsLoading: boolean
}

const CONSULTANDO: CreditExperience = {
  key: 'CONSULTANDO',
  title: 'Consultando tu situación',
  description: 'Estamos reuniendo el estado de tu empresa, tu solicitud y tu cuenta corriente.',
  nextStep: 'Esperá unos instantes o actualizá la consulta.',
  actionLabel: 'Actualizar consulta',
  action: 'actualizar',
  tone: 'neutral',
  hasOperationalAccount: false,
}

export function clientCreditExperience(input: ClientCreditInput): CreditExperience {
  const { approval, account, accountKnown, latestRequest } = input

  if (approval === 'PENDIENTE') {
    return {
      key: 'EMPRESA_PENDIENTE',
      title: 'Tu empresa está pendiente de aprobación',
      description: 'La aprobación comercial es el primer paso. Todavía no se puede solicitar ni usar crédito.',
      nextStep: 'Cuando el equipo comercial apruebe tu empresa vas a poder enviar una solicitud de crédito.',
      actionLabel: 'Actualizar estado',
      action: 'actualizar',
      tone: 'warning',
      hasOperationalAccount: false,
    }
  }

  if (approval === 'RECHAZADA') {
    return {
      key: 'EMPRESA_RECHAZADA',
      title: 'La aprobación de tu empresa fue rechazada',
      description: 'Con la aprobación rechazada no es posible solicitar crédito ni operar una cuenta corriente.',
      nextStep: 'Contactá al equipo comercial para revisar tu situación antes de volver a intentarlo.',
      actionLabel: 'Actualizar estado',
      action: 'actualizar',
      tone: 'danger',
      hasOperationalAccount: false,
    }
  }

  if (approval !== 'APROBADA') {
    return {
      key: 'APROBACION_NO_DETERMINABLE',
      title: 'No pudimos determinar la aprobación de tu empresa',
      description: 'Sin ese dato no es seguro ofrecer acciones de crédito.',
      nextStep: 'Actualizá la sesión o contactá al equipo comercial.',
      actionLabel: 'Actualizar estado',
      action: 'actualizar',
      tone: 'neutral',
      hasOperationalAccount: false,
    }
  }

  if (input.accountFailed) {
    return {
      key: 'CUENTA_NO_DISPONIBLE',
      title: 'No pudimos consultar tu cuenta corriente',
      description: 'Sin la respuesta de la cuenta no es seguro mostrar cifras ni habilitar acciones.',
      nextStep: 'Reintentá la consulta. Si el problema continúa, contactá al equipo comercial.',
      actionLabel: 'Reintentar consulta',
      action: 'actualizar',
      tone: 'neutral',
      hasOperationalAccount: false,
    }
  }

  if (!accountKnown || input.requestsLoading) return CONSULTANDO

  if (account && account.estado !== 'SIN_CUENTA') {
    if (account.estado === 'INHABILITADA') {
      if (latestRequest?.estado === 'APROBADA') {
        return {
          key: 'PENDIENTE_HABILITACION',
          title: 'Crédito aprobado, cuenta pendiente de habilitación',
          description: 'La solicitud fue aprobada y el límite quedó autorizado, pero la cuenta todavía no está habilitada para comprar.',
          nextStep: 'El equipo comercial debe habilitar la cuenta. La aprobación de la solicitud no habilita por sí sola.',
          actionLabel: 'Actualizar estado',
          action: 'actualizar',
          tone: 'warning',
          hasOperationalAccount: false,
        }
      }
      return {
        key: 'CUENTA_INHABILITADA',
        title: 'Tu cuenta corriente está inhabilitada',
        description: 'Podés consultar el saldo acreditado, los movimientos y el historial, pero no comprar a crédito.',
        nextStep: 'Revisá tus vencimientos y contactá al equipo comercial si necesitás reactivar la cuenta.',
        actionLabel: 'Ver vencimientos',
        action: 'vencimientos',
        tone: 'warning',
        hasOperationalAccount: false,
      }
    }

    if (account.estadoCredito === 'DISPONIBLE') {
      return {
        key: 'CUENTA_ELEGIBLE',
        title: 'Tu cuenta está habilitada y podés comprar a crédito',
        description: 'El crédito disponible surge de tu límite autorizado y del crédito utilizado. Cada compra se revalida.',
        nextStep: 'Agregá productos al carrito y elegí “Cuenta corriente” al confirmar la compra.',
        actionLabel: 'Comprar con cuenta corriente',
        action: 'catalogo',
        tone: 'positive',
        hasOperationalAccount: true,
      }
    }

    if (account.estadoCredito === 'BLOQUEADO') {
      return {
        key: 'COMPRA_BLOQUEADA',
        title: 'Tu cuenta está habilitada, pero la compra está bloqueada',
        description: 'Existe una restricción comercial o financiera que impide nuevas compras a crédito.',
        nextStep: 'Consultá tus vencimientos y regularizá la situación con el equipo comercial.',
        actionLabel: 'Ver vencimientos',
        action: 'vencimientos',
        tone: 'danger',
        hasOperationalAccount: true,
      }
    }

    return {
      key: 'CREDITO_NO_DETERMINABLE',
      title: 'No podemos confirmar si el crédito está disponible',
      description: 'La cuenta está habilitada, pero la información financiera no permite asegurar que una compra sea aceptada.',
      nextStep: 'Actualizá la consulta antes de intentar una compra a crédito.',
      actionLabel: 'Actualizar cuenta',
      action: 'actualizar',
      tone: 'neutral',
      hasOperationalAccount: true,
    }
  }

  if (latestRequest?.estado === 'PENDIENTE') {
    return {
      key: 'SOLICITUD_PENDIENTE',
      title: 'Tu solicitud de crédito está en revisión',
      description: 'La solicitud pendiente no autoriza un límite ni habilita una cuenta corriente.',
      nextStep: 'Esperá la resolución del equipo comercial. No necesitás enviar otra solicitud.',
      actionLabel: 'Ver solicitud',
      action: 'ver-solicitud',
      tone: 'warning',
      hasOperationalAccount: false,
    }
  }

  if (latestRequest?.estado === 'APROBADA') {
    return {
      key: 'PENDIENTE_HABILITACION',
      title: 'Crédito aprobado, cuenta pendiente de habilitación',
      description: 'La solicitud fue aprobada y el límite quedó autorizado, pero todavía no existe una cuenta habilitada para operar.',
      nextStep: 'El equipo comercial debe habilitar la cuenta. La aprobación no habilita automáticamente.',
      actionLabel: 'Actualizar estado',
      action: 'actualizar',
      tone: 'warning',
      hasOperationalAccount: false,
    }
  }

  if (latestRequest?.estado === 'RECHAZADA') {
    return {
      key: 'SOLICITUD_RECHAZADA',
      title: 'Tu solicitud de crédito fue rechazada',
      description: 'Podés consultar el motivo registrado y volver a presentar una solicitud cuando corresponda.',
      nextStep: 'Revisá el motivo y enviá una nueva solicitud o contactá al equipo comercial.',
      actionLabel: 'Enviar nueva solicitud',
      action: 'solicitar',
      tone: 'danger',
      hasOperationalAccount: false,
    }
  }

  return {
    key: 'SIN_CREDITO',
    title: 'Todavía no tenés una cuenta corriente',
    description: 'Tu empresa está aprobada. El siguiente paso es solicitar la evaluación de crédito comercial.',
    nextStep: 'Enviá una solicitud con el monto y el plazo que necesitás. La evaluación es manual.',
    actionLabel: 'Iniciar solicitud',
    action: 'solicitar',
    tone: 'info',
    hasOperationalAccount: false,
  }
}
