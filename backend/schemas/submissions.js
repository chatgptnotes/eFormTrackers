const { z } = require('zod');

// POST /api/sync-to-supabase — batch upsert of enriched submission records.
// Only the fields actually read by the handler are validated; everything else
// is preserved via .passthrough() so we don't drop data.
const syncRecordSchema = z
  .object({
    id: z.string().min(1),
    formId: z.union([z.string(), z.number()]).transform((v) => String(v)),
    formTitle: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    submitterName: z.string().optional().nullable(),
    submitterEmail: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    submissionDate: z.union([z.string(), z.number()]).optional().nullable(),
    currentLevel: z.union([z.number(), z.string()]).optional().nullable(),
    priority: z.string().optional().nullable(),
    jotformStatus: z.string().optional().nullable(),
    pendingApproverName: z.string().optional().nullable(),
    pendingApproverEmail: z.string().optional().nullable(),
    answers: z.unknown().optional(),
    approvalHistory: z.unknown().optional(),
    approvalUrl: z.string().optional().nullable(),
  })
  .passthrough();

const syncToSupabaseBodySchema = z.object({
  records: z.array(syncRecordSchema).min(1, 'records array is required'),
});

// POST /api/workflow-action — approve/reject/complete a workflow task.
const workflowActionBodySchema = z.object({
  submissionId: z.string().min(1, 'submissionId required'),
  action: z.enum(['approve', 'reject', 'complete']),
  comment: z.string().optional(),
  signature: z.string().optional(),
});

// POST /api/workflow-tasks-batch — fetch workflow tasks for many submissions
// in a single round-trip. Capped at 50 IDs per request to limit upstream fanout.
const workflowTasksBatchBodySchema = z.object({
  submissionIds: z
    .array(z.string().min(1))
    .min(1, 'submissionIds required')
    .max(50, 'submissionIds max length is 50'),
});

// DELETE /api/delete-submission?submissionId=xxx
const deleteSubmissionQuerySchema = z.object({
  submissionId: z.string().min(1, 'submissionId required'),
}).passthrough();

// POST /api/jotform-update?submissionId=xxx
const jotformUpdateQuerySchema = z.object({
  submissionId: z.string().min(1, 'submissionId required'),
}).passthrough();

module.exports = {
  syncToSupabaseBodySchema,
  workflowActionBodySchema,
  workflowTasksBatchBodySchema,
  deleteSubmissionQuerySchema,
  jotformUpdateQuerySchema,
};
