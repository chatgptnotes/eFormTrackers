/**
 * Approver config — module-level cache for the `jf_approver_config` Supabase table.
 *
 * Exposed as plain functions (the hook is only the cache lifetime — the actual
 * resolution logic stays pure so mappers can call it without React).
 */
import { apiFetch } from '../lib/api';

export interface ApproverConfig {
  formId: string;
  level: number;
  approverName: string;
  approverEmail: string;
}

let approverConfigCache: { configs: ApproverConfig[]; at: number } | null = null;
const APPROVER_CONFIG_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export async function fetchApproverConfigs(): Promise<ApproverConfig[]> {
  if (approverConfigCache && Date.now() - approverConfigCache.at < APPROVER_CONFIG_CACHE_TTL) {
    return approverConfigCache.configs;
  }
  try {
    const data = await apiFetch<{ configs?: Record<string, unknown>[] }>('/api/approver-config');
    const configs: ApproverConfig[] = (data.configs || []).map((c: Record<string, unknown>) => ({
      formId: String(c.form_id || ''),
      level: Number(c.level || 0),
      approverName: String(c.approver_name || ''),
      approverEmail: String(c.approver_email || ''),
    }));
    approverConfigCache = { configs, at: Date.now() };
    return configs;
  } catch {
    return [];
  }
}

export function clearApproverConfigCache(): void {
  approverConfigCache = null;
}

export function getConfiguredApprover(
  configs: ApproverConfig[],
  formId: string,
  level: number,
): { name: string; email: string } | null {
  const config = configs.find(c => c.formId === formId && c.level === level);
  if (config && (config.approverName || config.approverEmail)) {
    return { name: config.approverName, email: config.approverEmail };
  }
  return null;
}
