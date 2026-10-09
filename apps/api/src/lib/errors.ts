/**
 * Errors with an HTTP status and a plain-language message that can be shown
 * to the user as is. Anything else becomes a generic 500 (details only in logs).
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { CalcError } from '@ekotrace/calc';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(message: string, public status = 400, public code = 'BAD_REQUEST', public details?: unknown) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(`${what} not found`, 404, 'NOT_FOUND');
export const forbidden = (msg = 'You do not have access to this') => new AppError(msg, 403, 'FORBIDDEN');

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
  if (err instanceof CalcError) return reply.status(422).send({ error: err.code, message: err.message });
  if (err instanceof ZodError) {
    return reply.status(400).send({ error: 'VALIDATION', message: 'Some fields are missing or invalid', details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
  }
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '23505') return reply.status(409).send({ error: 'DUPLICATE', message: 'This already exists' });
  if (pgCode === '23503') return reply.status(409).send({ error: 'IN_USE', message: 'This is referenced by other records' });
  if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
    return reply.status((err as FastifyError).statusCode!).send({ error: 'BAD_REQUEST', message: err.message });
  }
  req.log.error(err);
  return reply.status(500).send({ error: 'SERVER_ERROR', message: 'Something went wrong on the server. Please try again.' });
}
