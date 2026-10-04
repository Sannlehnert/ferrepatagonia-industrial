export type RegisterInput = {
  tipoCliente: 'PARTICULAR' | 'EMPRESA';
  nombreRazonSocial: string;
  email: string;
  password: string;
  docCliente: string | null;
  cuit: string | null;
  telefono: string | null;
  direccion: string | null;
};

type ValidationResult =
  | { valid: true; data: RegisterInput }
  | { valid: false; message: string };

// Longitudes de CLIENTE y USUARIO en database/schema.sql.
const textLimits = {
  nombreRazonSocial: 200,
  email: 254,
  docCliente: 30,
  cuit: 20,
  telefono: 50,
  direccion: 500,
};

export function validateRegister(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, message: 'El body debe ser un objeto JSON.' };
  }

  const input = body as Record<string, unknown>;
  const allowedFields = ['tipoCliente', 'password', ...Object.keys(textLimits)];
  if (Object.keys(input).some((key) => !allowedFields.includes(key))) {
    return { valid: false, message: 'El body contiene campos no permitidos.' };
  }

  if (input.tipoCliente !== 'PARTICULAR' && input.tipoCliente !== 'EMPRESA') {
    return { valid: false, message: 'tipoCliente debe ser PARTICULAR o EMPRESA.' };
  }

  for (const [field, maxLength] of Object.entries(textLimits)) {
    const value = input[field];
    const required = field === 'nombreRazonSocial' || field === 'email';
    if (value === undefined || value === null) {
      if (required) return { valid: false, message: `${field} es obligatorio.` };
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      return { valid: false, message: `${field} debe ser un texto no vacío.` };
    }
    if (Array.from(value.trim()).length > maxLength) {
      return { valid: false, message: `${field} admite hasta ${maxLength} caracteres.` };
    }
  }

  const email = (input.email as string).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, message: 'email debe tener un formato válido.' };
  }
  if (typeof input.password !== 'string' || !input.password.trim()) {
    return { valid: false, message: 'password debe ser un texto no vacío.' };
  }

  // No recortar ni devolver la contraseña al cliente; se hashea en el servidor.
  return {
    valid: true,
    data: {
      tipoCliente: input.tipoCliente,
      nombreRazonSocial: (input.nombreRazonSocial as string).trim(),
      email,
      password: input.password,
      docCliente: (input.docCliente as string | null | undefined)?.trim() ?? null,
      cuit: (input.cuit as string | null | undefined)?.trim() ?? null,
      telefono: (input.telefono as string | null | undefined)?.trim() ?? null,
      direccion: (input.direccion as string | null | undefined)?.trim() ?? null,
    },
  };
}
