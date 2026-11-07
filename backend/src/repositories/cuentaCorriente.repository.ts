import { EntityManager } from 'typeorm';
import { dataSource, inTransaction } from '../config/database.config';
import { CuentaCorrienteSchema, MovimientoCuentaCorrienteSchema } from '../entities/active.schemas';

export interface ResumenCredito {
    id_cuenta_corriente: number;
    habilitada: boolean;
    limite_credito: string;
    total_cargos: string;
    total_abonos: string;
    deuda_vigente: string;
    credito_disponible: string;
}

export interface RegistrarCargoPedidoDTO {
    id_cuenta_corriente: number;
    id_pedido: number;
    monto: number | string;
    moneda?: 'USD' | 'ARS';
    dias_vencimiento?: number;
    observaciones?: string | null;
}

const toFixed2 = (n: number): string => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);

export const findCuentaByClienteId = async (idCliente: number, manager?: EntityManager) => {
    const repo = (manager ?? dataSource).getRepository(CuentaCorrienteSchema);
    return await repo.findOne({ where: { id_cliente: idCliente } });
};

export const calcularEstadoCuenta = async (
    idCuentaCorriente: number,
    manager?: EntityManager
): Promise<ResumenCredito | null> => {
    const cuentaRepo = (manager ?? dataSource).getRepository(CuentaCorrienteSchema);
    const cuenta = await cuentaRepo.findOne({ where: { id_cuenta_corriente: idCuentaCorriente } });
    if (!cuenta) return null;

    const rawTotals = await (manager ?? dataSource)
        .getRepository(MovimientoCuentaCorrienteSchema)
        .createQueryBuilder('m')
        .select("COALESCE(SUM(CASE WHEN m.tipo_movimiento = 'CARGO' THEN m.monto ELSE 0 END), 0)", 'total_cargos')
        .addSelect("COALESCE(SUM(CASE WHEN m.tipo_movimiento = 'ABONO' THEN m.monto ELSE 0 END), 0)", 'total_abonos')
        .where('m.id_cuenta_corriente = :idCuenta', { idCuenta: idCuentaCorriente })
        .andWhere("m.estado = 'ACREDITADO'")
        .getRawOne<{ total_cargos: string; total_abonos: string }>();

    const totalCargosNum = Number(rawTotals?.total_cargos ?? 0);
    const totalAbonosNum = Number(rawTotals?.total_abonos ?? 0);
    const limiteNum = Number(cuenta.limite_credito);

    const deudaVigenteNum = Math.max(0, totalCargosNum - totalAbonosNum);
    const creditoDisponibleNum = cuenta.habilitada === 1
        ? Math.max(0, limiteNum - deudaVigenteNum)
        : 0;

    return {
        id_cuenta_corriente: cuenta.id_cuenta_corriente,
        habilitada: cuenta.habilitada === 1,
        limite_credito: toFixed2(limiteNum),
        total_cargos: toFixed2(totalCargosNum),
        total_abonos: toFixed2(totalAbonosNum),
        deuda_vigente: toFixed2(deudaVigenteNum),
        credito_disponible: toFixed2(creditoDisponibleNum)
    };
};

export const registrarCargoPorPedido = async (
    dto: RegistrarCargoPedidoDTO,
    externalManager?: EntityManager
): Promise<number> => {
    const execute = async (manager: EntityManager): Promise<number> => {
        // H-02: Validación temprana de tipo y número finito mayor a cero
        const montoNum = Number(dto.monto);
        if (!Number.isFinite(montoNum) || montoNum <= 0) {
            throw new Error('El importe del cargo debe ser un número finito mayor a cero.');
        }

        // H-01: Bloqueo pesimista de escritura (FOR UPDATE) sobre CUENTA_CORRIENTE
        // Serializa pedidos simultáneos de la misma empresa para evitar sobregiro concurrente
        const cuentaBloqueada = await manager
            .getRepository(CuentaCorrienteSchema)
            .createQueryBuilder('c')
            .setLock('pessimistic_write')
            .where('c.id_cuenta_corriente = :id', { id: dto.id_cuenta_corriente })
            .getOne();

        if (!cuentaBloqueada) {
            throw new Error('Cuenta corriente no encontrada.');
        }

        const estado = await calcularEstadoCuenta(dto.id_cuenta_corriente, manager);
        if (!estado) {
            throw new Error('Cuenta corriente no encontrada.');
        }
        if (!estado.habilitada) {
            throw new Error('La cuenta corriente no se encuentra habilitada.');
        }

        const disponibleNum = Number(estado.credito_disponible);
        if (montoNum > disponibleNum) {
            throw new Error('El monto del pedido excede el crédito disponible de la cuenta corriente.');
        }

        let fechaVencimiento: Date | null = null;
        if (dto.dias_vencimiento && dto.dias_vencimiento > 0) {
            fechaVencimiento = new Date();
            fechaVencimiento.setDate(fechaVencimiento.getDate() + dto.dias_vencimiento);
        }

        const result = await manager.getRepository(MovimientoCuentaCorrienteSchema).insert({
            id_cuenta_corriente: dto.id_cuenta_corriente,
            tipo_movimiento: 'CARGO',
            origen: 'PEDIDO',
            id_pedido: dto.id_pedido,
            id_pago: null,
            monto: toFixed2(montoNum),
            moneda: dto.moneda ?? 'USD',
            fecha_vencimiento: fechaVencimiento,
            estado: 'ACREDITADO',
            observaciones: dto.observaciones ?? null
        });

        return Number(result.identifiers[0].id_movimiento_cuenta);
    };

    if (externalManager) {
        return await execute(externalManager);
    }
    return await inTransaction(execute);
};