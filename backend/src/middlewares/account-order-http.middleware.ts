import type { RequestHandler } from 'express';

function defaultCode(status: number): string {
  switch (status) {
    case 400: return 'SOLICITUD_INVALIDA';
    case 401: return 'NO_AUTENTICADO';
    case 403: return 'NO_AUTORIZADO';
    case 404: return 'RECURSO_NO_ENCONTRADO';
    case 413: return 'CUERPO_DEMASIADO_GRANDE';
    case 429: return 'LIMITE_SOLICITUDES';
    default: return 'SERVICIO_NO_DISPONIBLE';
  }
}

export const accountOrderPrivateResponses: RequestHandler = (
  _req,
  res,
  next,
) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Cookie');

  const sendJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    if (res.statusCode < 400) {
      return sendJson(body);
    }

    const failure = body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};

    return sendJson({
      code: typeof failure.code === 'string'
        ? failure.code
        : defaultCode(res.statusCode),
      message: typeof failure.message === 'string'
        ? failure.message
        : 'No se pudo procesar la solicitud.',
    });
  }) as typeof res.json;

  next();
};