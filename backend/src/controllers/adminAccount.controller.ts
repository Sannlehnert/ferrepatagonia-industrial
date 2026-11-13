import type { RequestHandler } from 'express';
import { parseAdminAccountQuery, type AccountScope } from '../dtos/adminAccount.query';
import { AccountQueryError, accountSourceUnavailable, isAccountSourceUnavailable } from '../services/adminAccount.errors';
import { queryAdminAccounts } from '../services/adminAccount.service';

export const adminAccountHandler = (scope: AccountScope): RequestHandler => async (req, res) => {
  try {
    const query = parseAdminAccountQuery(req.originalUrl, scope, req.params.clienteId as string | undefined);
    // Only the real authentication middleware supplies identity; request body/headers are ignored.
    const data = await queryAdminAccounts(req.auth!.id, query);
    res.json({ data });
  } catch (error) {
    if (isAccountSourceUnavailable(error)) {
      const unavailable = accountSourceUnavailable();
      res.status(unavailable.status).json({ message: unavailable.message, code: unavailable.code });
      return;
    }
    if (error instanceof AccountQueryError) {
      const body = error.status === 401 || error.status === 403
        ? { message: error.message }
        : { message: error.message, code: error.code };
      res.status(error.status).json(body);
      return;
    }
    res.status(500).json({ message: 'No se pudo consultar la cuenta corriente.' });
  }
};
