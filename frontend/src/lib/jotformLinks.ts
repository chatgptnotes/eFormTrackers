type TaskLink = { type?: string; accessLink?: string };

export function isUsableTaskAccessLink(task?: TaskLink | null): boolean {
  if (!task?.accessLink) return false;
  const link = task.accessLink.toLowerCase();
  if (task.type === 'workflow_assign_task') return link.includes('/approval-form/') && link.includes('/access-token/');
  if (task.type === 'workflow_assign_form') return link.includes('/prefill/');
  return !link.includes('/share/') && !link.includes('/inbox/');
}

export function getUsableTaskAccessLink(task?: TaskLink | null): string {
  return isUsableTaskAccessLink(task) ? String(task?.accessLink || '') : '';
}
