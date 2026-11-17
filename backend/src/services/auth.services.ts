import bcrypt from 'bcrypt';
import type { QueryRunner } from 'typeorm';
import type { AuthContext, SessionUser } from '../types/auth';
import { findUsuarioById } from '../repositories/usuario.repository';
import { signToken } from './token.service';
import { findUsuarioByEmail } from '../repositories/usuario.repository'; // Ajustá la ruta a donde guardaste el repo

export const loginUsuario = async (email: string, password: string) => {
    const user = await findUsuarioByEmail(email);

    // Validamos si existe y está activo
    if (!user || !user.activo) {
        return { error: "Credenciales inválidas", status: 401 };
    }

    // Comparamos la contraseña contra el hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
        return { error: "Credenciales inválidas", status: 401 };
    }

    const companySession = user.rol === 'CLIENTE' && user.tipo_cliente === 'EMPRESA'
        ? await restoreUsuario({ id: user.id_usuario, rol: user.rol }, undefined, true) : null;
    if (user.rol === 'CLIENTE' && user.tipo_cliente === 'EMPRESA' && !companySession) {
        return { error: "Credenciales inválidas", status: 401 };
    }

    // Firmamos el JWT
    const token = signToken({ id: user.id_usuario, rol: user.rol });

    // Preparamos los datos públicos para Pinia
    const userPublic: SessionUser = companySession ?? {
        id: user.id_usuario,
        email: user.email,
        rol: user.rol,
        tipo_cliente: user.tipo_cliente,
        estadoAprobacionEmpresa: null,
        cuentaCorrienteHabilitada: null,
        nombre: user.nombre_razon_social || "Administrador"
    };

    return { token, user: userPublic };
};

export const restoreUsuario = async (auth: AuthContext, runner?: QueryRunner, includeAccount = false): Promise<SessionUser | null> => {
    const user = await (includeAccount ? findUsuarioById(auth.id, runner, true)
        : runner ? findUsuarioById(auth.id, runner) : findUsuarioById(auth.id));
    if (!user || !user.activo || user.rol !== auth.rol) {
        return null;
    }

    return {
        id: user.id_usuario,
        email: user.email,
        rol: user.rol,
        tipo_cliente: user.rol === 'ADMIN' ? null : user.tipo_cliente,
        estadoAprobacionEmpresa: user.rol === 'CLIENTE' && user.tipo_cliente === 'EMPRESA'
            ? user.estado_aprobacion_empresa ?? null : null,
        cuentaCorrienteHabilitada: user.rol === 'CLIENTE' && user.tipo_cliente === 'EMPRESA'
            && user.cuenta_corriente_habilitada != null ? user.cuenta_corriente_habilitada === 1 : null,
        nombre: user.nombre_razon_social || 'Administrador',
    };
};
