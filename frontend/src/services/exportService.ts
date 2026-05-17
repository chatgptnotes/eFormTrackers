import { Submission } from '../types';

export async function exportToExcel(submissions: Submission[], filename = 'jotform-submissions') {
  const XLSX = await import('xlsx');

  const data = submissions.map(s => ({
    'Reference': s.referenceNumber,
    'Form': s.formTitle,
    'Title': s.title,
    'Submitted By': s.submittedBy.name,
    'Department': s.submittedBy.department,
    'Submission Date': s.submissionDate,
    'Current Level': typeof s.currentApprovalLevel === 'number' ? `Level ${s.currentApprovalLevel}` : s.currentApprovalLevel,
    'Days at Level': s.daysAtCurrentLevel,
    'Total Days': s.totalDaysSinceSubmission,
    'Status': s.overallStatus,
    'Priority': s.priority,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Submissions');

  const colWidths = Object.keys(data[0] || {}).map(key => ({
    wch: Math.max(key.length, ...data.map(row => String((row as Record<string, unknown>)[key] || '').length)) + 2
  }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export async function exportChartAsPng(elementId: string, filename = 'chart') {
  const { default: html2canvas } = await import('html2canvas');

  const element = document.getElementById(elementId);
  if (!element) return;
  const canvas = await html2canvas(element, { backgroundColor: '#1B2A4A', scale: 2 });
  const link = document.createElement('a');
  link.download = `${filename}.png`;
  link.href = canvas.toDataURL();
  link.click();
}

export async function exportBottleneckPdf(elementId: string, filename = 'bottleneck-report') {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const element = document.getElementById(elementId);
  if (!element) return;
  const canvas = await html2canvas(element, { backgroundColor: '#1B2A4A', scale: 2 });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('l', 'mm', 'a4');
  const width = pdf.internal.pageSize.getWidth();
  const height = (canvas.height * width) / canvas.width;
  pdf.addImage(imgData, 'PNG', 0, 0, width, height);
  pdf.save(`${filename}.pdf`);
}
