const { z } = require('zod');

// GET /api/form-workflow?formId=xxx
// POST /api/ensure-fields?formId=xxx
// GET /api/detect-approvers?formId=xxx (optional)
const formIdRequiredQuerySchema = z.object({
  formId: z.string().min(1, 'formId required'),
}).passthrough();

const formIdOptionalQuerySchema = z.object({
  formId: z.string().min(1).optional(),
}).passthrough();

// GET /api/email-url?formId=xxx&submissionId=yyy
// GET /api/form-url?formId=xxx&submissionId=yyy
// GET /api/task-url?formId=xxx&submissionId=yyy
const formAndSubmissionQuerySchema = z.object({
  formId: z.string().min(1, 'formId required'),
  submissionId: z.string().min(1, 'submissionId required'),
}).passthrough();

module.exports = {
  formIdRequiredQuerySchema,
  formIdOptionalQuerySchema,
  formAndSubmissionQuerySchema,
};
