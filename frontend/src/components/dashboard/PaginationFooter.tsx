import { memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  totalCount: number;
  currentPage: number;
  rowsPerPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * Pagination footer for the Director Dashboard table.
 * Shows "Showing X–Y of Z" + numbered page buttons with ellipses.
 */
function PaginationFooterImpl({ totalCount, currentPage, rowsPerPage, totalPages, onPageChange }: Props) {
  const pages: (number | '...')[] = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="px-4 py-3 border-t border-navy-light/20 flex items-center justify-between">
      <p className="text-xs text-gray-500">
        {totalCount === 0
          ? 'No submissions'
          : `Showing ${(currentPage - 1) * rowsPerPage + 1}–${Math.min(currentPage * rowsPerPage, totalCount)} of ${totalCount} submissions`}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-navy-light/30 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {pages.map((p, idx) =>
            p === '...' ? (
              <span key={`ellipsis-${idx}`} className="px-1 text-xs text-gray-500">...</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`min-w-[28px] h-7 rounded text-xs font-medium ${
                  p === currentPage
                    ? 'bg-gold/90 text-navy-dark'
                    : 'text-gray-400 hover:text-white hover:bg-navy-light/30'
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-navy-light/30 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export const PaginationFooter = memo(PaginationFooterImpl);
