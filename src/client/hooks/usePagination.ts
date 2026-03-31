import { useState, useCallback, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const DEFAULT_PAGE_SIZE: PageSize = 25;
const STORAGE_KEY = 'fleet-grid-page-size';

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function readPageSize(): PageSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_PAGE_SIZE;
    const parsed = Number(raw);
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed)) {
      return parsed as PageSize;
    }
  } catch {
    // Ignore corrupt data
  }
  return DEFAULT_PAGE_SIZE;
}

function writePageSize(size: PageSize): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // Ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Pure pagination function (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Paginate an array of items.
 * - Clamps page to [1, totalPages].
 * - Returns the slice for the current page and the total number of pages.
 */
export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): { pageItems: T[]; totalPages: number } {
  if (items.length === 0) {
    return { pageItems: [], totalPages: 1 };
  }
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.max(1, Math.min(page, totalPages));
  const start = (clampedPage - 1) * pageSize;
  const end = start + pageSize;
  return { pageItems: items.slice(start, end), totalPages };
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface Pagination {
  page: number;
  pageSize: PageSize;
  setPage: (page: number) => void;
  setPageSize: (size: PageSize) => void;
  resetPage: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Custom hook to manage pagination state with localStorage persistence
 * for page size. Follows the same initialized-ref pattern as useGridFilters
 * to avoid writing to localStorage on mount.
 */
export function usePagination(): Pagination {
  const [page, setPageRaw] = useState(1);
  const [pageSize, setPageSizeRaw] = useState<PageSize>(readPageSize);

  // Track initialization to avoid writing back on mount
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    writePageSize(pageSize);
  }, [pageSize]);

  const setPage = useCallback((p: number) => {
    setPageRaw(p);
  }, []);

  const setPageSize = useCallback((size: PageSize) => {
    setPageSizeRaw(size);
    setPageRaw(1);
  }, []);

  const resetPage = useCallback(() => {
    setPageRaw(1);
  }, []);

  return {
    page,
    pageSize,
    setPage,
    setPageSize,
    resetPage,
  };
}
