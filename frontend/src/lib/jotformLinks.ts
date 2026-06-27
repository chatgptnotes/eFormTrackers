import { WorkflowTask } from '../types';

export function isUsableTaskAccessLink(task?: WorkflowTask | null): boolean {
  if (!task?.accessLink) return false;
  const link = task.accessLink.toLowerCase();
  if (task.type === 'workflow_assign_form' && link.includes('/share/')) return false;
  return true;
}

export function getUsableTaskAccessLink(task?: WorkflowTask | null): string {
  return isUsableTaskAccessLink(task) ? String(task?.accessLink || '') : '';
}
