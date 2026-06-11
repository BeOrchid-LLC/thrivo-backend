/**
 * Success envelope. Every endpoint returns `{ data, meta? }`; the error half
 * (`{ error: { code, message, details? } }`) is produced centrally by the error
 * boundary (middleware/error.ts), so handlers only ever build the success shape.
 */
export type Meta = { nextCursor?: string | null } & Record<string, unknown>;

export type ApiSuccess<T> = { data: T; meta?: Meta };

export function ok<T>(data: T, meta?: Meta): ApiSuccess<T> {
  return meta ? { data, meta } : { data };
}
