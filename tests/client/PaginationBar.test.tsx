// =============================================================================
// Fleet Commander — PaginationBar Component Tests
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PaginationBar } from '../../src/client/components/PaginationBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOOP = () => {};

const DEFAULT_PROPS = {
  page: 1,
  totalPages: 5,
  pageSize: 25 as const,
  onPageChange: NOOP,
  onPageSizeChange: NOOP,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PaginationBar', () => {
  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  describe('rendering', () => {
    it('renders the pagination bar container', () => {
      render(<PaginationBar {...DEFAULT_PROPS} />);
      expect(screen.getByTestId('pagination-bar')).toBeInTheDocument();
    });

    it('renders page indicator with current page and total', () => {
      render(<PaginationBar {...DEFAULT_PROPS} page={2} totalPages={5} />);
      expect(screen.getByTestId('pagination-indicator')).toHaveTextContent('Page 2 of 5');
    });

    it('renders page size selector with all options', () => {
      render(<PaginationBar {...DEFAULT_PROPS} />);
      const select = screen.getByTestId('pagination-page-size') as HTMLSelectElement;
      const options = select.querySelectorAll('option');
      expect(options).toHaveLength(3);
      expect(options[0].textContent).toBe('25');
      expect(options[1].textContent).toBe('50');
      expect(options[2].textContent).toBe('100');
    });

    it('shows selected page size in the dropdown', () => {
      render(<PaginationBar {...DEFAULT_PROPS} pageSize={50} />);
      const select = screen.getByTestId('pagination-page-size') as HTMLSelectElement;
      expect(select.value).toBe('50');
    });

    it('renders Prev and Next buttons', () => {
      render(<PaginationBar {...DEFAULT_PROPS} />);
      expect(screen.getByTestId('pagination-prev')).toBeInTheDocument();
      expect(screen.getByTestId('pagination-next')).toBeInTheDocument();
    });

    it('renders "Show" and "per page" labels', () => {
      render(<PaginationBar {...DEFAULT_PROPS} />);
      expect(screen.getByText('Show')).toBeInTheDocument();
      expect(screen.getByText('per page')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Button disabled states
  // -------------------------------------------------------------------------

  describe('button disabled states', () => {
    it('disables Prev button on page 1', () => {
      render(<PaginationBar {...DEFAULT_PROPS} page={1} />);
      expect(screen.getByTestId('pagination-prev')).toBeDisabled();
    });

    it('enables Prev button on page 2+', () => {
      render(<PaginationBar {...DEFAULT_PROPS} page={2} />);
      expect(screen.getByTestId('pagination-prev')).not.toBeDisabled();
    });

    it('disables Next button on last page', () => {
      render(<PaginationBar {...DEFAULT_PROPS} page={5} totalPages={5} />);
      expect(screen.getByTestId('pagination-next')).toBeDisabled();
    });

    it('enables Next button when not on last page', () => {
      render(<PaginationBar {...DEFAULT_PROPS} page={1} totalPages={5} />);
      expect(screen.getByTestId('pagination-next')).not.toBeDisabled();
    });

    it('disables both buttons when totalPages is 1', () => {
      render(<PaginationBar {...DEFAULT_PROPS} page={1} totalPages={1} />);
      expect(screen.getByTestId('pagination-prev')).toBeDisabled();
      expect(screen.getByTestId('pagination-next')).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  describe('interaction', () => {
    it('calls onPageChange(page - 1) when Prev is clicked', () => {
      const onChange = vi.fn();
      render(<PaginationBar {...DEFAULT_PROPS} page={3} onPageChange={onChange} />);
      fireEvent.click(screen.getByTestId('pagination-prev'));
      expect(onChange).toHaveBeenCalledWith(2);
    });

    it('calls onPageChange(page + 1) when Next is clicked', () => {
      const onChange = vi.fn();
      render(<PaginationBar {...DEFAULT_PROPS} page={3} onPageChange={onChange} />);
      fireEvent.click(screen.getByTestId('pagination-next'));
      expect(onChange).toHaveBeenCalledWith(4);
    });

    it('calls onPageSizeChange when page size is changed', () => {
      const onSizeChange = vi.fn();
      render(<PaginationBar {...DEFAULT_PROPS} onPageSizeChange={onSizeChange} />);
      fireEvent.change(screen.getByTestId('pagination-page-size'), { target: { value: '50' } });
      expect(onSizeChange).toHaveBeenCalledWith(50);
    });

    it('does not call onPageChange when disabled Prev is clicked', () => {
      const onChange = vi.fn();
      render(<PaginationBar {...DEFAULT_PROPS} page={1} onPageChange={onChange} />);
      fireEvent.click(screen.getByTestId('pagination-prev'));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onPageChange when disabled Next is clicked', () => {
      const onChange = vi.fn();
      render(<PaginationBar {...DEFAULT_PROPS} page={5} totalPages={5} onPageChange={onChange} />);
      fireEvent.click(screen.getByTestId('pagination-next'));
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
