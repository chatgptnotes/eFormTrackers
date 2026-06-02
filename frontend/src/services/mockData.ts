import { Submission, ApprovalLevel, ApprovalEntry, OverallStatus, SidebarCategory } from '../types';

const DEPARTMENTS = ['Finance', 'HR', 'Procurement', 'IT', 'Operations', 'Legal', 'Admin', 'Marketing'];

const FORM_TYPES = [
  { id: 'F001', title: 'Purchase Order Approval' },
  { id: 'F002', title: 'Leave Request' },
  { id: 'F003', title: 'Travel Authorization' },
  { id: 'F004', title: 'Budget Allocation Request' },
  { id: 'F005', title: 'Vendor Registration' },
  { id: 'F006', title: 'IT Equipment Request' },
  { id: 'F007', title: 'Contract Renewal' },
  { id: 'F008', title: 'Employee Onboarding' },
  { id: 'F009', title: 'Expense Reimbursement' },
  { id: 'F010', title: 'Facility Maintenance Request' },
];

const NAMES = [
  { en: 'Ahmed Al Maktoum', ar: 'أحمد آل مكتوم' },
  { en: 'Fatima Al Hashimi', ar: 'فاطمة الهاشمي' },
  { en: 'Mohammed Al Falasi', ar: 'محمد الفلاسي' },
  { en: 'Sara Al Suwaidi', ar: 'سارة السويدي' },
  { en: 'Khalid Al Mansouri', ar: 'خالد المنصوري' },
  { en: 'Noura Al Ketbi', ar: 'نورة الكتبي' },
  { en: 'Omar Al Shamsi', ar: 'عمر الشامسي' },
  { en: 'Mariam Al Nuaimi', ar: 'مريم النعيمي' },
  { en: 'Hassan Al Dhaheri', ar: 'حسن الظاهري' },
  { en: 'Aisha Al Zaabi', ar: 'عائشة الزعابي' },
  { en: 'Rashid Al Muhairi', ar: 'راشد المهيري' },
  { en: 'Latifa Al Qassimi', ar: 'لطيفة القاسمي' },
  { en: 'Sultan Al Ameri', ar: 'سلطان العامري' },
  { en: 'Hessa Al Balooshi', ar: 'حصة البلوشي' },
  { en: 'Yousef Al Hammadi', ar: 'يوسف الحمادي' },
  { en: 'Dana Al Marzooqi', ar: 'دانة المرزوقي' },
  { en: 'Abdulla Al Kaabi', ar: 'عبدالله الكعبي' },
  { en: 'Sheikha Al Mazrouei', ar: 'شيخة المزروعي' },
  { en: 'Saeed Al Tayer', ar: 'سعيد الطاير' },
  { en: 'Moza Al Nahyan', ar: 'موزة آل نهيان' },
];

const APPROVERS = [
  { en: 'Director Huzaifa Dawasaz', ar: 'المدير حذيفة داواساز' },
  { en: 'Manager Fatima Hassan', ar: 'المديرة فاطمة حسن' },
  { en: 'VP Mohammed Al Falasi', ar: 'نائب الرئيس محمد الفلاسي' },
  { en: 'CFO Khalid Sultan', ar: 'المدير المالي خالد سلطان' },
  { en: 'Director Huzaifa Dawasaz', ar: 'المدير حذيفة داواساز' },
  { en: 'Manager Omar Al Ketbi', ar: 'المدير عمر الكتبي' },
  { en: 'VP Noura Al Shamsi', ar: 'نائبة الرئيس نورة الشامسي' },
  { en: 'CEO Rashid Al Maktoum', ar: 'الرئيس التنفيذي راشد آل مكتوم' },
];

const DESCRIPTIONS: Record<string, string[]> = {
  'F001': ['Office supplies - Q4 2024', 'Server hardware upgrade', 'Marketing campaign materials', 'Furniture for new wing', 'Software licenses renewal'],
  'F002': ['Annual leave - 2 weeks', 'Sick leave request', 'Maternity leave', 'Emergency leave - family', 'Study leave - certification'],
  'F003': ['Conference in Abu Dhabi', 'Client meeting - London', 'Training program - Singapore', 'Regional summit - Riyadh', 'Trade expo - Dubai'],
  'F004': ['Q1 2025 department budget', 'Emergency fund allocation', 'Project expansion budget', 'Training budget increase', 'Technology upgrade fund'],
  'F005': ['Al Futtaim Trading LLC', 'Emirates Consulting Group', 'Dubai Tech Solutions', 'Gulf Supplies Co.', 'National Services LLC'],
  'F006': ['Laptop replacement - dept', '10x monitors for new office', 'Server room equipment', 'Printers for 3rd floor', 'Video conferencing setup'],
  'F007': ['Cleaning services - 2yr', 'Security contract renewal', 'IT support agreement', 'Catering services', 'Transport services'],
  'F008': ['New hire - Sr. Analyst', 'Graduate program intake', 'Executive transfer', 'Intern batch - Summer', 'Contract staff onboarding'],
  'F009': ['Business dinner - client', 'Taxi & transport claims', 'Conference registration', 'Team building event', 'Office supplies (urgent)'],
  'F010': ['AC repair - 5th floor', 'Parking lot resurfacing', 'Elevator maintenance', 'Fire safety inspection', 'Plumbing - restrooms'],
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - randomInt(0, daysAgo));
  return d.toISOString().split('T')[0];
}

function getOverallStatus(daysAtCurrent: number): OverallStatus {
  if (daysAtCurrent <= 3) return 'on-track';
  if (daysAtCurrent <= 7) return 'delayed';
  return 'critical';
}

function generateApprovalHistory(
  currentLevel: ApprovalLevel | 'completed' | 'rejected',
  submissionDate: string
): ApprovalEntry[] {
  const history: ApprovalEntry[] = [];
  const maxLevel = currentLevel === 'completed' ? 4 : currentLevel === 'rejected' ? randomInt(1, 4) : (currentLevel as number);
  const startDate = new Date(submissionDate);

  for (let i = 1; i <= 4; i++) {
    const approver = APPROVERS[(i - 1) * 2] || randomChoice(APPROVERS);
    if (i < maxLevel || (currentLevel === 'completed' && i <= 4)) {
      startDate.setDate(startDate.getDate() + randomInt(1, 5));
      history.push({
        level: i as ApprovalLevel,
        approverName: approver.en,
        approverNameAr: approver.ar,
        status: 'approved',
        date: startDate.toISOString().split('T')[0],
        comments: randomChoice(['Approved', 'Looks good', 'Verified and approved', 'No issues found', '']),
      });
    } else if (i === maxLevel && currentLevel === 'rejected') {
      startDate.setDate(startDate.getDate() + randomInt(1, 3));
      history.push({
        level: i as ApprovalLevel,
        approverName: approver.en,
        approverNameAr: approver.ar,
        status: 'rejected',
        date: startDate.toISOString().split('T')[0],
        comments: randomChoice(['Budget exceeded', 'Insufficient documentation', 'Not aligned with policy', 'Requires revision']),
      });
    } else if (i === maxLevel) {
      history.push({
        level: i as ApprovalLevel,
        approverName: approver.en,
        approverNameAr: approver.ar,
        status: 'pending',
      });
    }
  }
  return history;
}

export function generateMockSubmissions(count: number = 500): Submission[] {
  const submissions: Submission[] = [];

  // Distribution: ~200 completed, ~30 rejected, ~270 stuck at various levels
  const distribution = [
    { level: 'completed' as const, weight: 0.38 },
    { level: 'rejected' as const, weight: 0.06 },
    { level: 1 as const, weight: 0.15 },
    { level: 2 as const, weight: 0.18 },
    { level: 3 as const, weight: 0.13 },
    { level: 4 as const, weight: 0.10 },
  ];

  for (let i = 0; i < count; i++) {
    const form = randomChoice(FORM_TYPES);
    const person = randomChoice(NAMES);
    const dept = randomChoice(DEPARTMENTS);
    const submissionDate = randomDate(90);

    // Weighted random level
    let rand = Math.random();
    let currentLevel: ApprovalLevel | 'completed' | 'rejected' = 1;
    for (const d of distribution) {
      rand -= d.weight;
      if (rand <= 0) { currentLevel = d.level; break; }
    }

    const daysAtCurrent = currentLevel === 'completed' ? 0 :
      currentLevel === 'rejected' ? 0 : randomInt(1, 65);

    const totalDays = Math.floor((Date.now() - new Date(submissionDate).getTime()) / 86400000);
    const descriptions = DESCRIPTIONS[form.id] || ['General request'];

    const submission: Submission = {
      id: `SUB-${String(i + 1).padStart(5, '0')}`,
      formId: form.id,
      formTitle: form.title,
      referenceNumber: `REF-${new Date().getFullYear()}-${String(randomInt(10000, 99999))}`,
      title: randomChoice(descriptions),
      description: `${form.title} - ${randomChoice(descriptions)}`,
      submittedBy: {
        name: person.en,
        nameAr: person.ar,
        department: dept,
        email: `${person.en.split(' ')[0].toLowerCase()}@gov.dubai.ae`,
      },
      submissionDate,
      currentApprovalLevel: currentLevel,
      approvalHistory: generateApprovalHistory(currentLevel, submissionDate),
      daysAtCurrentLevel: daysAtCurrent,
      totalDaysSinceSubmission: totalDays,
      overallStatus: getOverallStatus(daysAtCurrent),
      jotformStatus: currentLevel === 'completed' ? 'Completed' : currentLevel === 'rejected' ? 'Rejected' : 'Pending',
      priority: daysAtCurrent > 30 ? 'urgent' : daysAtCurrent > 14 ? 'high' : daysAtCurrent > 7 ? 'medium' : 'low',
      actionType: 'approval',
      answers: {},
    };

    submissions.push(submission);
  }

  return submissions.sort((a, b) => new Date(b.submissionDate).getTime() - new Date(a.submissionDate).getTime());
}

export const SIDEBAR_CATEGORIES: SidebarCategory[] = [
  { id: 'all', label: 'All Assets', type: 'all' as const },
  { id: 'procurement', label: 'Procurement', type: 'department' as const, filter: { departments: ['Procurement'] } },
  { id: 'finance', label: 'Finance', type: 'department' as const, filter: { departments: ['Finance'] } },
  { id: 'hr', label: 'HR', type: 'department' as const, filter: { departments: ['HR'] } },
  { id: 'it', label: 'IT', type: 'department' as const, filter: { departments: ['IT'] } },
  { id: 'operations', label: 'Operations', type: 'department' as const, filter: { departments: ['Operations'] } },
  { id: 'legal', label: 'Legal', type: 'department' as const, filter: { departments: ['Legal'] } },
  { id: 'admin', label: 'Admin', type: 'department' as const, filter: { departments: ['Admin'] } },
  { id: 'marketing', label: 'Marketing', type: 'department' as const, filter: { departments: ['Marketing'] } },
];

export const DEFAULT_AUTO_APPROVE_RULES = [
  {
    id: '1',
    name: 'Auto-approve low priority items',
    enabled: false,
    conditions: { maxPriority: 'low' as const, maxDaysAtLevel: 3 },
    action: 'approve' as const,
  },
];


