export type ApprovalLevel = 1 | 2 | 3 | 4;
export type SubmissionStatus = 'pending' | 'completed' | 'rejected';
export type OverallStatus = 'on-track' | 'delayed' | 'critical';
export type WorkflowActionType = 'approval' | 'task' | 'form';

export interface Submission {
  id: string;
  formId: string;
  formTitle: string;
  referenceNumber: string;
  title: string;
  description: string;
  editLink?: string;
  /** Smart action type derived from the JotForm workflow step configuration */
  actionType: WorkflowActionType;
  /** URL to open the JotForm task (for actionType === 'task') */
  taskUrl?: string;
  /** URL to open/fill the JotForm form (for actionType === 'form') */
  formUrl?: string;
  submittedBy: {
    name: string;
    nameAr?: string;
    department: string;
    email: string;
  };
  submissionDate: string;
  currentApprovalLevel: ApprovalLevel | 'completed' | 'rejected';
  approvalHistory: ApprovalEntry[];
  daysAtCurrentLevel: number;
  totalDaysSinceSubmission: number;
  overallStatus: OverallStatus;
  /** Raw status value pulled directly from JotForm (e.g. 'Approved', 'Rejected', 'In Progress', 'Completed', 'Pending') */
  jotformStatus: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  answers: Record<string, string>;
  /** Populated by the generic mapper for dynamically-discovered forms so the modal can approve/reject them */
  levelFieldMap?: { level: number; statusFieldId: string; approverFieldId: string | null; overallStatusFieldId: string | null }[];
  /** True when a native JotForm approval was detected but hidden fields weren't updated — user must confirm action */
  needsSync?: boolean;
  /** Actual pending approver name from workflow API */
  pendingApproverName?: string;
  /** Actual pending approver email from workflow API */
  pendingApproverEmail?: string;
  /** Direct approval/form URL constructed from workflow task data */
  approvalUrl?: string;
  /** Workflow instance ID — used to group parent + child form submissions */
  workflowInstanceId?: string;
}

export interface ApprovalEntry {
  level: ApprovalLevel;
  approverName: string;
  approverEmail?: string;
  approverNameAr?: string;
  status: 'approved' | 'pending' | 'rejected';
  date?: string;
  comments?: string;
}

export interface FormSummary {
  id: string;
  title: string;
  totalSubmissions: number;
  completed: number;
  pending: number;
  rejected: number;
}

export interface DashboardStats {
  totalForms: number;
  completed: number;
  inProgress: number;
  stuckOver7Days: number;
  stuckOver30Days: number;
  rejected: number;
}

export interface ApprovalLevelStats {
  level: string;
  count: number;
  avgDays: number;
  color: string;
}

export interface DepartmentStats {
  department: string;
  total: number;
  completed: number;
  pending: number;
  rejected: number;
}

export interface TrendDataPoint {
  date: string;
  completed: number;
  submitted: number;
  rejected: number;
}

export interface BottleneckData {
  level: string;
  stuckCount: number;
  avgWaitDays: number;
  longestWaitDays: number;
  topApprovers: { name: string; pending: number }[];
}

export interface HeatmapCell {
  day: string;
  hour: string;
  value: number;
}

export interface ApiConfig {
  apiKey: string;
  formIds: string[];
  baseUrl: string;
  isConnected: boolean;
  useDemoData: boolean;
}

export interface RefreshConfig {
  autoRefresh: boolean;
  intervalMinutes: number;
  lastUpdated: string | null;
}

export interface WorkflowTask {
  name: string;
  type: string;           // "workflow_approval", "workflow_assign_task", "workflow_assign_form"
  status: string;         // "COMPLETED", "ACTIVE", "PENDING"
  assigneeName: string;
  assigneeEmail: string;
  level: number;
  updatedAt: string;
  taskId: string;
  internalFormID: string;
  accessLink: string;
  submittedBy: string;
  submittedByEmail: string;
  formData?: Record<string, { label: string; value: string }>;
}

export type SortDirection = 'asc' | 'desc';
export interface SortConfig {
  key: string;
  direction: SortDirection;
}

export interface FilterConfig {
  approvalLevel: string;
  department: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  search: string;
}

export interface PaginationConfig {
  page: number;
  perPage: number;
  total: number;
}

export interface AutoApproveRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    formTypes?: string[];
    maxDaysAtLevel?: number;
    maxPriority?: 'low' | 'medium';
    approvalLevels?: ApprovalLevel[];
  };
  action: 'approve' | 'escalate';
}

export interface SidebarCategory {
  id: string;
  label: string;
  type: 'all' | 'department' | 'form-group';
  filter?: {
    departments?: string[];
    formIds?: string[];
  };
  children?: SidebarCategory[];
}

export interface DiscoveredForm {
  id: string;
  title: string;
  count: number;
  status: string;
  created_at: string;
}
