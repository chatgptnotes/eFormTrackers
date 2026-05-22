const { z } = require('zod');

// POST /api/auth/signup
const signupBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().optional(),
  department: z.string().optional(),
}).passthrough();

// POST /api/auth/login
const loginBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
}).passthrough();

// POST /api/auth/reset-password
const resetPasswordBodySchema = z.object({
  email: z.string().email('Invalid email address'),
}).passthrough();

// POST /api/auth/verify-workspace-member
const verifyWorkspaceMemberBodySchema = z.object({
  email: z.string().email('Invalid email address'),
}).passthrough();

module.exports = {
  signupBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
  verifyWorkspaceMemberBodySchema,
};
