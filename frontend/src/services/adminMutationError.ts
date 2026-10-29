import axios from 'axios';

// Only these API rejections guarantee that the mutation was not applied.
// A lost response, timeout or server failure can happen after persistence.
export function isMutationResultUncertain(error: unknown): boolean {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    return !status || ![400, 401, 403, 404, 409, 422].includes(status);
}

export function adminMutationErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) return 'La sesión expiró. Iniciá sesión nuevamente.';
        if (error.response?.status === 403) return 'No tenés permisos para modificar productos.';
        return error.response?.data?.message || error.response?.data?.error || error.message;
    }
    return error instanceof Error ? error.message : 'No se pudo guardar el producto.';
}

export const uncertainMutationMessage = 'No se pudo confirmar el resultado. Las modificaciones están bloqueadas hasta recargar el listado correctamente. Al recargar se cerrará el formulario; verificá los datos antes de volver a editar.';
