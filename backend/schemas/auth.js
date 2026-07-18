const { z } = require('zod');

// POST /api/auth/signup
// H-6: min 12 chars, max 128 to prevent bcrypt DoS. M-1: no .passthrough().
const signupBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128),
  fullName: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
});

// POST /api/auth/login
const loginBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required').max(128),
  adminLogin: z.boolean().optional(),
});

// POST /api/auth/reset-password
const resetPasswordBodySchema = z.object({
  email: z.string().email('Invalid email address'),
});

// POST /api/auth/reset-password/confirm
// H-6: same min/max as signup.
const confirmResetBodySchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128),
});

// POST /api/auth/verify-workspace-member
const verifyWorkspaceMemberBodySchema = z.object({
  email: z.string().email('Invalid email address'),
});

module.exports = {
  signupBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
  confirmResetBodySchema,
  verifyWorkspaceMemberBodySchema,
};
