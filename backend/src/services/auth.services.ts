import bcrypt from 'bcrypt';
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

    // Firmamos el JWT
    const token = signToken({ id: user.id_usuario, rol: user.rol });

    // Preparamos los datos públicos para Pinia
    const userPublic = {
        id: user.id_usuario,
        email: user.email,
        rol: user.rol,
        tipo_cliente: user.tipo_cliente,
        nombre: user.nombre_razon_social || "Administrador"
    };

    return { token, user: userPublic };
};
