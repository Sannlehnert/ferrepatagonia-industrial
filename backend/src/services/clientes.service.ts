import {
    findAllClientes,
    updateEstadoAprobacionEmpresa,
} from '../repositories/cliente.repository';
import type { EstadoAprobacionEmpresa } from '../dtos/clients/company-approval.dto';

export async function listClientes() {
    const clientes = await findAllClientes();
    return clientes.map((cliente) => {
        const item: {
            id: number;
            nombreRazonSocial: string;
            email: string;
            fechaRegistro: Date | string;
            tipoCliente?: 'PARTICULAR' | 'EMPRESA';
            cuit?: string | null;
            docCliente?: string | null;
            estadoAprobacionEmpresa?: EstadoAprobacionEmpresa | null;
        } = {
            id: Number(cliente.id_cliente),
            nombreRazonSocial: cliente.nombre_razon_social,
            email: cliente.email,
            fechaRegistro: cliente.fecha_creacion,
        };

        if (cliente.tipo_cliente === 'EMPRESA') {
            item.tipoCliente = cliente.tipo_cliente;
        }
        if (cliente.cuit !== undefined && cliente.cuit !== null) {
            item.cuit = cliente.cuit;
        }
        if (cliente.doc_cliente !== undefined && cliente.doc_cliente !== null) {
            item.docCliente = cliente.doc_cliente;
        }
        if (cliente.estado_aprobacion_empresa !== undefined && cliente.estado_aprobacion_empresa !== null) {
            item.estadoAprobacionEmpresa = cliente.estado_aprobacion_empresa;
        }

        return item;
    });
}

export async function updateCompanyApprovalStatus(
    clientId: number,
    estado: EstadoAprobacionEmpresa,
) {
    const cliente = await updateEstadoAprobacionEmpresa(clientId, estado);
    if (!cliente) {
        const err = new Error('El cliente no existe.');
        (err as unknown as { statusCode: number; code: string }).statusCode = 404;
        (err as unknown as { statusCode: number; code: string }).code = 'CLIENTE_NO_ENCONTRADO';
        throw err;
    }

    const fechaRegistro = cliente.usuario?.fecha_creacion ?? cliente.fecha_alta;

    return {
        id: Number(cliente.id_cliente),
        nombreRazonSocial: cliente.nombre_razon_social,
        email: cliente.usuario?.email ?? cliente.email ?? '',
        fechaRegistro: fechaRegistro instanceof Date ? fechaRegistro.toISOString() : String(fechaRegistro),
        tipoCliente: cliente.tipo_cliente,
        estadoAprobacionEmpresa: cliente.estado_aprobacion_empresa ?? estado,
        cuit: cliente.cuit ?? null,
        docCliente: cliente.doc_cliente ?? null,
    };
}