// =============================================================================
// Fleet Commander -- parseIdParam / parseOptionalIdParam Unit Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseIdParam, parseOptionalIdParam } from '../../../src/server/utils/parse-params.js';
import { ServiceError } from '../../../src/server/services/service-error.js';

// =============================================================================
// parseIdParam
// =============================================================================

describe('parseIdParam', () => {
  // ---------------------------------------------------------------------------
  // Valid inputs
  // ---------------------------------------------------------------------------

  it('should parse a valid positive integer string', () => {
    expect(parseIdParam('42')).toBe(42);
  });

  it('should parse "1" as the minimum valid ID', () => {
    expect(parseIdParam('1')).toBe(1);
  });

  it('should parse a large number', () => {
    expect(parseIdParam('999999')).toBe(999999);
  });

  it('should truncate decimal strings to integer', () => {
    // parseInt('3.7', 10) returns 3 — this is acceptable behavior
    expect(parseIdParam('3.7')).toBe(3);
  });

  it('should parse strings with trailing non-numeric characters', () => {
    // parseInt('123abc', 10) returns 123 — acceptable behavior
    expect(parseIdParam('123abc')).toBe(123);
  });

  // ---------------------------------------------------------------------------
  // Invalid inputs
  // ---------------------------------------------------------------------------

  it('should throw ServiceError for non-numeric string', () => {
    expect(() => parseIdParam('abc')).toThrow(ServiceError);
    try {
      parseIdParam('abc');
    } catch (err) {
      const se = err as ServiceError;
      expect(se.statusCode).toBe(400);
      expect(se.code).toBe('VALIDATION');
      expect(se.message).toContain('positive integer');
    }
  });

  it('should throw ServiceError for "0"', () => {
    expect(() => parseIdParam('0')).toThrow(ServiceError);
  });

  it('should throw ServiceError for negative numbers', () => {
    expect(() => parseIdParam('-5')).toThrow(ServiceError);
  });

  it('should throw ServiceError for empty string', () => {
    expect(() => parseIdParam('')).toThrow(ServiceError);
  });

  it('should throw ServiceError for whitespace', () => {
    expect(() => parseIdParam('   ')).toThrow(ServiceError);
  });

  // ---------------------------------------------------------------------------
  // Custom name in error message
  // ---------------------------------------------------------------------------

  it('should use default name "id" in error message', () => {
    try {
      parseIdParam('abc');
    } catch (err) {
      expect((err as ServiceError).message).toBe('id must be a positive integer');
    }
  });

  it('should use custom name in error message', () => {
    try {
      parseIdParam('abc', 'projectId');
    } catch (err) {
      expect((err as ServiceError).message).toBe('projectId must be a positive integer');
    }
  });
});

// =============================================================================
// parseOptionalIdParam
// =============================================================================

describe('parseOptionalIdParam', () => {
  // ---------------------------------------------------------------------------
  // Absent values
  // ---------------------------------------------------------------------------

  it('should return undefined for undefined input', () => {
    expect(parseOptionalIdParam(undefined)).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(parseOptionalIdParam('')).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Valid values
  // ---------------------------------------------------------------------------

  it('should parse a valid positive integer string', () => {
    expect(parseOptionalIdParam('42')).toBe(42);
  });

  it('should parse "1" as minimum valid', () => {
    expect(parseOptionalIdParam('1')).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Invalid values
  // ---------------------------------------------------------------------------

  it('should throw ServiceError for non-numeric string', () => {
    expect(() => parseOptionalIdParam('abc')).toThrow(ServiceError);
  });

  it('should throw ServiceError for "0"', () => {
    expect(() => parseOptionalIdParam('0')).toThrow(ServiceError);
  });

  it('should throw ServiceError for negative numbers', () => {
    expect(() => parseOptionalIdParam('-5')).toThrow(ServiceError);
  });

  // ---------------------------------------------------------------------------
  // Custom name
  // ---------------------------------------------------------------------------

  it('should use custom name in error message', () => {
    try {
      parseOptionalIdParam('abc', 'team_id');
    } catch (err) {
      expect((err as ServiceError).message).toBe('team_id must be a positive integer');
    }
  });
});
