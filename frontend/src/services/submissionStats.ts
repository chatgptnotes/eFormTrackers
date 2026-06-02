import { Submission, ApprovalLevelStats, DepartmentStats, TrendDataPoint, BottleneckData, HeatmapCell } from '../types';

export function getDashboardStats(submissions: Submission[]) {
  const completed = submissions.filter(s => s.currentApprovalLevel === 'completed').length;
  const rejected = submissions.filter(s => s.currentApprovalLevel === 'rejected').length;
  const inProgress = submissions.length - completed - rejected;
  const stuckOver7 = submissions.filter(s => typeof s.currentApprovalLevel === 'number' && s.daysAtCurrentLevel > 7).length;
  const stuckOver30 = submissions.filter(s => typeof s.currentApprovalLevel === 'number' && s.daysAtCurrentLevel > 30).length;

  return { totalForms: submissions.length, completed, inProgress, stuckOver7Days: stuckOver7, stuckOver30Days: stuckOver30, rejected };
}

export function getApprovalLevelStats(submissions: Submission[]): ApprovalLevelStats[] {
  const levels = [
    { key: 1, label: 'Level 1 - Department', color: '#3B82F6' },
    { key: 2, label: 'Level 2 - Division', color: '#F59E0B' },
    { key: 3, label: 'Level 3 - Director', color: '#8B5CF6' },
    { key: 4, label: 'Level 4 - Executive', color: '#EF4444' },
    { key: 'completed', label: 'Completed', color: '#10B981' },
    { key: 'rejected', label: 'Rejected', color: '#6B7280' },
  ];

  return levels.map(l => {
    const items = submissions.filter(s => s.currentApprovalLevel === l.key);
    const avgDays = items.length > 0 ? items.reduce((sum, s) => sum + s.daysAtCurrentLevel, 0) / items.length : 0;
    return { level: l.label, count: items.length, avgDays: Math.round(avgDays * 10) / 10, color: l.color };
  });
}

export function getDepartmentStats(submissions: Submission[]): DepartmentStats[] {
  const deptMap = new Map<string, { total: number; completed: number; pending: number; rejected: number }>();
  submissions.forEach(s => {
    const d = deptMap.get(s.submittedBy.department) || { total: 0, completed: 0, pending: 0, rejected: 0 };
    d.total++;
    if (s.currentApprovalLevel === 'completed') d.completed++;
    else if (s.currentApprovalLevel === 'rejected') d.rejected++;
    else d.pending++;
    deptMap.set(s.submittedBy.department, d);
  });
  return Array.from(deptMap.entries()).map(([department, stats]) => ({ department, ...stats }));
}

export function getTrendData(submissions: Submission[]): TrendDataPoint[] {
  const days = 30;
  const points: TrendDataPoint[] = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const submitted = submissions.filter(s => s.submissionDate === dateStr).length;
    const completed = submissions.filter(s =>
      s.currentApprovalLevel === 'completed' &&
      s.approvalHistory.some(a => a.date === dateStr && a.status === 'approved')
    ).length;
    const rejected = submissions.filter(s =>
      s.currentApprovalLevel === 'rejected' &&
      s.approvalHistory.some(a => a.date === dateStr && a.status === 'rejected')
    ).length;
    points.push({ date: dateStr, submitted, completed, rejected });
  }
  return points;
}

export function getBottleneckData(submissions: Submission[]): BottleneckData[] {
  return [1, 2, 3, 4].map(level => {
    const stuck = submissions.filter(s => s.currentApprovalLevel === level);
    const avgWait = stuck.length > 0 ? stuck.reduce((s, i) => s + i.daysAtCurrentLevel, 0) / stuck.length : 0;
    const longestWait = stuck.length > 0 ? Math.max(...stuck.map(i => i.daysAtCurrentLevel)) : 0;

    const approverMap = new Map<string, number>();
    stuck.forEach(s => {
      const pending = s.approvalHistory.find(a => a.level === level && a.status === 'pending');
      if (pending) {
        approverMap.set(pending.approverName, (approverMap.get(pending.approverName) || 0) + 1);
      }
    });
    const topApprovers = Array.from(approverMap.entries())
      .map(([name, pending]) => ({ name, pending }))
      .sort((a, b) => b.pending - a.pending)
      .slice(0, 5);

    return {
      level: `Level ${level}`,
      stuckCount: stuck.length,
      avgWaitDays: Math.round(avgWait * 10) / 10,
      longestWaitDays: longestWait,
      topApprovers,
    };
  });
}

export function getHeatmapData(submissions: Submission[]): HeatmapCell[] {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const displayDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = ['9AM', '10AM', '11AM', '12PM', '1PM', '2PM', '3PM', '4PM'];
  const hourWeights = [0.08, 0.12, 0.15, 0.18, 0.15, 0.13, 0.11, 0.08];

  const dayCounts: Record<string, number> = {};
  dayNames.forEach(d => { dayCounts[d] = 0; });
  submissions.forEach(s => {
    const date = new Date(s.submissionDate);
    if (!isNaN(date.getTime())) {
      dayCounts[dayNames[date.getDay()]]++;
    }
  });

  const cells: HeatmapCell[] = [];
  displayDays.forEach(day => {
    const total = dayCounts[day] || 0;
    hours.forEach((hour, i) => {
      cells.push({ day, hour, value: Math.round(total * hourWeights[i]) });
    });
  });
  return cells;
}
