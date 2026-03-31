import { PAGE_SIZE_OPTIONS } from '../hooks/usePagination';
import type { PageSize } from '../hooks/usePagination';

// ---------------------------------------------------------------------------
// PaginationBar — page size selector, prev/next buttons, page indicator
// ---------------------------------------------------------------------------

interface PaginationBarProps {
  page: number;
  totalPages: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
}

export function PaginationBar({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationBarProps) {
  const isFirstPage = page <= 1;
  const isLastPage = page >= totalPages;

  return (
    <div
      className="flex items-center justify-between px-4 py-2 text-xs border-t border-dark-border"
      data-testid="pagination-bar"
    >
      {/* Page size selector */}
      <div className="flex items-center gap-2">
        <label htmlFor="pagination-page-size" className="text-dark-muted">
          Show
        </label>
        <select
          id="pagination-page-size"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
          className="bg-dark-surface border border-dark-border text-dark-text text-xs rounded px-2 py-1 focus:outline-none focus:border-dark-accent"
          data-testid="pagination-page-size"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span className="text-dark-muted">per page</span>
      </div>

      {/* Page indicator */}
      <span className="text-dark-muted" data-testid="pagination-indicator">
        Page {page} of {totalPages}
      </span>

      {/* Prev / Next buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={isFirstPage}
          className="px-2 py-1 rounded border border-dark-border text-dark-muted hover:text-dark-text hover:border-dark-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-dark-muted disabled:hover:border-dark-border"
          data-testid="pagination-prev"
        >
          Prev
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={isLastPage}
          className="px-2 py-1 rounded border border-dark-border text-dark-muted hover:text-dark-text hover:border-dark-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-dark-muted disabled:hover:border-dark-border"
          data-testid="pagination-next"
        >
          Next
        </button>
      </div>
    </div>
  );
}
