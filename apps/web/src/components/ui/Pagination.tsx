'use client';

import { paginationBtnStyle } from './theme';

function pageNumbers(currentPage: number, totalPages: number, windowSize = 5): number[] {
  const count = Math.min(windowSize, totalPages);
  return Array.from({ length: count }, (_, i) => {
    if (totalPages <= windowSize) return i + 1;
    if (currentPage <= 3) return i + 1;
    if (currentPage >= totalPages - 2) return totalPages - windowSize + 1 + i;
    return currentPage - 2 + i;
  });
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  variant?: 'full' | 'compact';
}

function btn(disabled: boolean): React.CSSProperties {
  return {
    ...paginationBtnStyle,
    background: '#1e2433',
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? 'default' : 'pointer',
  };
}

export default function Pagination({ currentPage, totalPages, onPageChange, variant = 'full' }: PaginationProps) {
  if (totalPages <= 1) return null;

  if (variant === 'compact') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="text-sm"
          style={btn(currentPage === 1)}
        >
          Prev
        </button>
        <span className="text-sm" style={{ color: '#6b7280' }}>
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="text-sm"
          style={btn(currentPage >= totalPages)}
        >
          Next
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <button
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        className="text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          padding: '6px 10px',
          background: '#252d3d',
          borderRadius: '6px',
          border: 'none',
          cursor: currentPage === 1 ? 'default' : 'pointer',
        }}
      >
        Prev
      </button>
      {pageNumbers(currentPage, totalPages).map((pageNum) => (
        <button
          key={pageNum}
          onClick={() => onPageChange(pageNum)}
          className="text-sm"
          style={{
            padding: '6px 12px',
            background: currentPage === pageNum ? '#2563eb' : '#252d3d',
            color: currentPage === pageNum ? '#fff' : '#d1d5db',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {pageNum}
        </button>
      ))}
      <button
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
        className="text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          padding: '6px 10px',
          background: '#252d3d',
          borderRadius: '6px',
          border: 'none',
          cursor: currentPage === totalPages ? 'default' : 'pointer',
        }}
      >
        Next
      </button>
    </div>
  );
}
