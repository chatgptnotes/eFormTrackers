import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface Props {
  show: boolean;
  onClose: () => void;
  uniqueLevels: string[];
  uniqueDepartments: string[];
  uniqueSubmitters: string[];
  filterLevel: string;
  filterDepartment: string;
  filterStatus: string;
  filterDateFrom: string;
  filterDateTo: string;
  filterSubmittedBy: string;
  activeFilterCount: number;
  onClear: () => void;
  onFilterLevelChange: (v: string) => void;
  onFilterDepartmentChange: (v: string) => void;
  onFilterStatusChange: (v: string) => void;
  onFilterDateFromChange: (v: string) => void;
  onFilterDateToChange: (v: string) => void;
  onFilterSubmittedByChange: (v: string) => void;
}

/**
 * Collapsible filter panel for the Director Dashboard.
 * Pure presentational — values + handlers live in the parent.
 */
function FilterPanelImpl({
  show,
  onClose,
  uniqueLevels,
  uniqueDepartments,
  uniqueSubmitters,
  filterLevel,
  filterDepartment,
  filterStatus,
  filterDateFrom,
  filterDateTo,
  filterSubmittedBy,
  activeFilterCount,
  onClear,
  onFilterLevelChange,
  onFilterDepartmentChange,
  onFilterStatusChange,
  onFilterDateFromChange,
  onFilterDateToChange,
  onFilterSubmittedByChange,
}: Props) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Filters</h3>
              <div className="flex items-center gap-2">
                {activeFilterCount > 0 && (
                  <button
                    onClick={onClear}
                    className="text-xs text-gold hover:text-gold/80 transition-colors"
                  >
                    Clear All
                  </button>
                )}
                <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="responsive-panel-grid">
              {/* Level */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Level</label>
                <select
                  value={filterLevel}
                  onChange={e => onFilterLevelChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-navy-dark border border-navy-light/30 text-sm text-white focus:border-gold/50 focus:outline-none"
                >
                  <option value="">All Levels</option>
                  {uniqueLevels.map(l => (
                    <option key={l} value={l}>
                      {l === 'completed' ? 'Completed' : l === 'rejected' ? 'Rejected' : `Level ${l}`}
                    </option>
                  ))}
                </select>
              </div>
              {/* Department */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Department</label>
                <select
                  value={filterDepartment}
                  onChange={e => onFilterDepartmentChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-navy-dark border border-navy-light/30 text-sm text-white focus:border-gold/50 focus:outline-none"
                >
                  <option value="">All Departments</option>
                  {uniqueDepartments.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              {/* Status */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Status</label>
                <select
                  value={filterStatus}
                  onChange={e => onFilterStatusChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-navy-dark border border-navy-light/30 text-sm text-white focus:border-gold/50 focus:outline-none"
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              {/* Date From */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Date From</label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={e => onFilterDateFromChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-navy-dark border border-navy-light/30 text-sm text-white focus:border-gold/50 focus:outline-none"
                />
              </div>
              {/* Date To */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Date To</label>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={e => onFilterDateToChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-navy-dark border border-navy-light/30 text-sm text-white focus:border-gold/50 focus:outline-none"
                />
              </div>
              {/* Submitted By */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Submitted By</label>
                <select
                  value={filterSubmittedBy}
                  onChange={e => onFilterSubmittedByChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-navy-dark border border-navy-light/30 text-sm text-white focus:border-gold/50 focus:outline-none"
                >
                  <option value="">All Submitters</option>
                  {uniqueSubmitters.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const FilterPanel = memo(FilterPanelImpl);
