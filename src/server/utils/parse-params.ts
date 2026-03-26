// =============================================================================
// Fleet Commander -- Route parameter parsing helpers
// =============================================================================
// Shared validators for numeric route params and query params. Throws
// ServiceError (400) on invalid input so that existing catch blocks in route
// handlers produce the correct HTTP response automatically.
// =============================================================================

import { validationError } from '../services/service-error.js';

/**
 * Parse a required numeric route parameter.
 *
 * @param raw  - The raw string value from `request.params`
 * @param name - Human-readable param name for the error message
 * @returns The parsed positive integer
 * @throws ServiceError (400) when the value is not a positive integer
 */
export function parseIdParam(raw: string, name = 'id'): number {
  const id = parseInt(raw, 10);
  if (isNaN(id) || id < 1) throw validationError(`${name} must be a positive integer`);
  return id;
}

/**
 * Parse an optional numeric query parameter.
 *
 * Returns `undefined` when the value is absent or empty; otherwise delegates
 * to {@link parseIdParam} for validation.
 *
 * @param raw  - The raw string value from `request.query` (may be undefined)
 * @param name - Human-readable param name for the error message
 * @returns The parsed positive integer, or `undefined` if absent
 * @throws ServiceError (400) when the value is present but not a positive integer
 */
export function parseOptionalIdParam(raw: string | undefined, name = 'id'): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  return parseIdParam(raw, name);
}
