const { z } = require('zod');

// PUT /api/submissions/:jotformSubmissionId — body is a partial update.
// Handler whitelists keys against ALLOWED, but we still require the body to be
// a plain non-empty object.
const submissionsPutBodySchema = z
  .object({})
  .passthrough()
  .refine((v) => v && typeof v === 'object' && Object.keys(v).length > 0, {
    message: 'No fields to update',
  });

// PUT /api/profiles/:userId — same shape: arbitrary keys, handler whitelists.
const profilesPutBodySchema = z
  .object({})
  .passthrough()
  .refine((v) => v && typeof v === 'object' && Object.keys(v).length > 0, {
    message: 'No fields to update',
  });

// PUT /api/organizations/:id
const organizationsPutBodySchema = z.object({
  name: z.string().optional(),
  settings: z.unknown().optional(),
  logo_url: z.string().optional().nullable(),
  branding: z.unknown().optional(),
  plan: z.string().optional(),
}).passthrough();

// POST /api/activity-log — handler reads specific keys but doesn't enforce
// any of them; only require a plain object so we don't 400 on payloads the
// handler previously accepted.
const activityLogPostBodySchema = z.object({
  user_id: z.string().optional().nullable(),
  user_email: z.string().optional().nullable(),
  action: z.string().optional().nullable(),
  entity_type: z.string().optional().nullable(),
  entity_id: z.string().optional().nullable(),
  details: z.unknown().optional(),
}).passthrough();

// PUT /api/subscriptions/:orgId
const subscriptionsPutBodySchema = z.object({
  plan: z.string().optional(),
  status: z.string().optional(),
}).passthrough();

module.exports = {
  submissionsPutBodySchema,
  profilesPutBodySchema,
  organizationsPutBodySchema,
  activityLogPostBodySchema,
  subscriptionsPutBodySchema,
};
