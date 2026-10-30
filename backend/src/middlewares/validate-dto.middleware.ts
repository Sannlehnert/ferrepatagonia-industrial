import type { RequestHandler } from 'express';
import { DtoPolicy, validateDtoInput } from '../dtos/validation';

export function validateDto<T extends object>(source: 'body' | 'query' | 'params', policy: DtoPolicy<T>): RequestHandler {
  return async (req, res, next) => {
    const result = await validateDtoInput(policy, req[source]);
    if (!result.valid) {
      res.status(400).json({ message: result.message });
      return;
    }
    // Express 5 query is a getter. Store validated instances separately from raw input.
    res.locals.dto ??= {};
    res.locals.dto[source] = result.data;
    next();
  };
}
