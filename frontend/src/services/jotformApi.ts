import { ApiConfig } from '../types';
import { apiFetch } from '../lib/api';
import { humanizeError, messageFromStatus } from '../lib/errors';

// The browser no longer reads from JotForm directly — the backend poller owns
// all reads and writes to the database. The only live JotForm-bound call left
// is the per-submission update used by inline edits, which goes through the
// authenticated /api/jotform-update endpoint.
const DEFAULT_BASE_URL = '/api/jotform';

class JotFormApiService {
  private config: ApiConfig;

  constructor() {
    const stored = localStorage.getItem('jotform_config');
    const parsed = stored ? JSON.parse(stored) : null;
    this.config = parsed ? {
      ...parsed,
      apiKey: '', // never store API key in browser
    } : {
      apiKey: '',
      formIds: [],
      baseUrl: DEFAULT_BASE_URL,
      isConnected: false,
      useDemoData: false,
    };
  }

  getConfig(): ApiConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ApiConfig>) {
    this.config = { ...this.config, ...updates };
    localStorage.setItem('jotform_config', JSON.stringify(this.config));
  }

  async updateSubmission(
    submissionId: string,
    fields: Record<string, string>,
    meta?: Record<string, string>,  // metadata fields sent without submission[] wrapper
  ): Promise<{ success: boolean; message: string }> {
    try {
      const params = new URLSearchParams();
      for (const [key, val] of Object.entries(fields)) {
        params.append(`submission[${key}]`, val);
      }
      // Metadata fields (e.g. _action, _level, _signatureUrl) go unwrapped
      if (meta) {
        for (const [key, val] of Object.entries(meta)) {
          params.append(key, val);
        }
      }
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 20000); // 20s timeout
      const data = await apiFetch<{ responseCode?: number; error?: string; message?: string }>(`/api/jotform-update?submissionId=${submissionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: ctrl.signal,
        throwOnError: false,
      });
      clearTimeout(timeout);
      if (data.responseCode === 200) {
        return { success: true, message: 'Updated successfully' };
      }
      // Server error responses use `data.error`; JotForm API errors use `data.message`
      return { success: false, message: messageFromStatus(0, data.error || data.message) };
    } catch (err) {
      return { success: false, message: humanizeError(err, 'Could not update the submission. Please try again.') };
    }
  }
}

export const jotformApi = new JotFormApiService();
export default jotformApi;
