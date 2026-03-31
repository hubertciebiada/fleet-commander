// =============================================================================
// Fleet Commander — usePagination Hook & paginateItems Tests
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePagination, paginateItems, PAGE_SIZE_OPTIONS } from '../../src/client/hooks/usePagination';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((_index: number) => null),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: storageMock });

// ---------------------------------------------------------------------------
// paginateItems — Pure function tests
// ---------------------------------------------------------------------------

describe('paginateItems', () => {
  const items = Array.from({ length: 60 }, (_, i) => i + 1);

  it('returns first page slice with correct total pages', () => {
    const result = paginateItems(items, 1, 25);
    expect(result.pageItems).toHaveLength(25);
    expect(result.pageItems[0]).toBe(1);
    expect(result.pageItems[24]).toBe(25);
    expect(result.totalPages).toBe(3);
  });

  it('returns second page slice', () => {
    const result = paginateItems(items, 2, 25);
    expect(result.pageItems).toHaveLength(25);
    expect(result.pageItems[0]).toBe(26);
    expect(result.pageItems[24]).toBe(50);
  });

  it('returns last page with remaining items', () => {
    const result = paginateItems(items, 3, 25);
    expect(result.pageItems).toHaveLength(10);
    expect(result.pageItems[0]).toBe(51);
    expect(result.pageItems[9]).toBe(60);
  });

  it('clamps page below 1 to page 1', () => {
    const result = paginateItems(items, 0, 25);
    expect(result.pageItems[0]).toBe(1);
    expect(result.pageItems).toHaveLength(25);
  });

  it('clamps page above totalPages to last page', () => {
    const result = paginateItems(items, 100, 25);
    expect(result.pageItems[0]).toBe(51);
    expect(result.pageItems).toHaveLength(10);
    expect(result.totalPages).toBe(3);
  });

  it('returns all items when page size exceeds total', () => {
    const result = paginateItems(items, 1, 100);
    expect(result.pageItems).toHaveLength(60);
    expect(result.totalPages).toBe(1);
  });

  it('handles empty array', () => {
    const result = paginateItems([], 1, 25);
    expect(result.pageItems).toHaveLength(0);
    expect(result.totalPages).toBe(1);
  });

  it('handles single item', () => {
    const result = paginateItems(['a'], 1, 25);
    expect(result.pageItems).toEqual(['a']);
    expect(result.totalPages).toBe(1);
  });

  it('handles exact page boundary', () => {
    const exactItems = Array.from({ length: 50 }, (_, i) => i + 1);
    const result = paginateItems(exactItems, 2, 25);
    expect(result.pageItems).toHaveLength(25);
    expect(result.pageItems[0]).toBe(26);
    expect(result.totalPages).toBe(2);
  });

  it('works with page size 50', () => {
    const result = paginateItems(items, 1, 50);
    expect(result.pageItems).toHaveLength(50);
    expect(result.totalPages).toBe(2);
  });

  it('works with page size 100', () => {
    const result = paginateItems(items, 1, 100);
    expect(result.pageItems).toHaveLength(60);
    expect(result.totalPages).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PAGE_SIZE_OPTIONS constant
// ---------------------------------------------------------------------------

describe('PAGE_SIZE_OPTIONS', () => {
  it('contains 25, 50, 100', () => {
    expect([...PAGE_SIZE_OPTIONS]).toEqual([25, 50, 100]);
  });
});

// ---------------------------------------------------------------------------
// usePagination — Hook tests
// ---------------------------------------------------------------------------

describe('usePagination', () => {
  beforeEach(() => {
    storageMock.clear();
    vi.clearAllMocks();
  });

  it('starts on page 1 with default page size 25', () => {
    const { result } = renderHook(() => usePagination());
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(25);
  });

  it('rehydrates page size from localStorage', () => {
    storageMock.setItem('fleet-grid-page-size', '50');
    const { result } = renderHook(() => usePagination());
    expect(result.current.pageSize).toBe(50);
  });

  it('falls back to default for invalid localStorage value', () => {
    storageMock.setItem('fleet-grid-page-size', '42');
    const { result } = renderHook(() => usePagination());
    expect(result.current.pageSize).toBe(25);
  });

  it('falls back to default for non-numeric localStorage value', () => {
    storageMock.setItem('fleet-grid-page-size', 'abc');
    const { result } = renderHook(() => usePagination());
    expect(result.current.pageSize).toBe(25);
  });

  it('setPage updates the current page', () => {
    const { result } = renderHook(() => usePagination());
    act(() => {
      result.current.setPage(3);
    });
    expect(result.current.page).toBe(3);
  });

  it('setPageSize updates page size and resets to page 1', () => {
    const { result } = renderHook(() => usePagination());
    act(() => {
      result.current.setPage(3);
    });
    expect(result.current.page).toBe(3);
    act(() => {
      result.current.setPageSize(50);
    });
    expect(result.current.pageSize).toBe(50);
    expect(result.current.page).toBe(1);
  });

  it('resetPage sets page back to 1', () => {
    const { result } = renderHook(() => usePagination());
    act(() => {
      result.current.setPage(5);
    });
    expect(result.current.page).toBe(5);
    act(() => {
      result.current.resetPage();
    });
    expect(result.current.page).toBe(1);
  });

  it('persists page size to localStorage on setPageSize', () => {
    const { result } = renderHook(() => usePagination());
    act(() => {
      result.current.setPageSize(100);
    });
    expect(storageMock.getItem('fleet-grid-page-size')).toBe('100');
  });

  it('does not write to localStorage on initial mount', () => {
    storageMock.setItem('fleet-grid-page-size', '50');
    vi.clearAllMocks();
    renderHook(() => usePagination());
    // setItem should not have been called during mount
    expect(storageMock.setItem).not.toHaveBeenCalled();
  });
});
