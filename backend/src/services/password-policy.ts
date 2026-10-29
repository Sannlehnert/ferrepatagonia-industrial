// Registration only: count Unicode code points, not UTF-16 units or graphemes.
// Spaces and combining marks count; never trim or normalize the original value.
export function registrationPasswordError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'password debe ser un texto no vacío.';
  if ([...value].length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (Buffer.byteLength(value, 'utf8') > 72) return 'Solicitud inválida.';
  return null;
}
