import { useState, useEffect, useMemo } from 'react';
import { Submission, FilterConfig, SortConfig, PaginationConfig } from '../types';

export function useSubmissionFilters(allSubmissions: Submission[]) {
  const [filters, setFilters] = useState<FilterConfig>(() => {
    try {
      const saved = localStorage.getItem('jotflow_filters');
      return saved ? { ...{ approvalLevel: '', department: '', status: '', dateFrom: '', dateTo: '', search: '' }, ...JSON.parse(saved) } : { approvalLevel: '', department: '', status: '', dateFrom: '', dateTo: '', search: '' };
    } catch { return { approvalLevel: '', department: '', status: '', dateFrom: '', dateTo: '', search: '' }; }
  });
  const wrappedSetFilters = (updater: FilterConfig | ((prev: FilterConfig) => FilterConfig)) => {
    setFilters(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('jotflow_filters', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const [sort, setSort] = useState<SortConfig>({ key: 'submissionDate', direction: 'desc' });
  const [pagination, setPagination] = useState<PaginationConfig>({ page: 1, perPage: 25, total: 0 });

  const filteredSubmissions = useMemo(() => {
    let result = [...allSubmissions];
    if (filters.approvalLevel) {
      const level = filters.approvalLevel === 'completed' ? 'completed'
        : filters.approvalLevel === 'rejected' ? 'rejected'
        : Number(filters.approvalLevel);
      result = result.filter(s => s.currentApprovalLevel === level);
    }
    if (filters.department) result = result.filter(s => s.submittedBy.department === filters.department);
    if (filters.status) result = result.filter(s => s.jotformStatus?.toLowerCase().includes(filters.status.toLowerCase()));
    if (filters.dateFrom) result = result.filter(s => s.submissionDate >= filters.dateFrom);
    if (filters.dateTo) result = result.filter(s => s.submissionDate <= filters.dateTo);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.referenceNumber.toLowerCase().includes(q) ||
        s.submittedBy.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.formId.toLowerCase().includes(q) ||
        s.formTitle.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sort.key];
      const bVal = (b as unknown as Record<string, unknown>)[sort.key];
      const cmp = String(aVal || '').localeCompare(String(bVal || ''), undefined, { numeric: true });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [allSubmissions, filters, sort]);

  useEffect(() => {
    setPagination(prev => ({ ...prev, total: filteredSubmissions.length, page: 1 }));
  }, [filteredSubmissions.length]);

  const paginatedSubmissions = useMemo(() => {
    const start = (pagination.page - 1) * pagination.perPage;
    return filteredSubmissions.slice(start, start + pagination.perPage);
  }, [filteredSubmissions, pagination.page, pagination.perPage]);

  return {
    filters,
    setFilters: wrappedSetFilters,
    sort,
    setSort,
    pagination,
    setPagination,
    filteredSubmissions,
    paginatedSubmissions,
  };
}
