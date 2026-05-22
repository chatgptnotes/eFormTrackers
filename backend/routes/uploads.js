const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// Uploads write to disk and DB; never accept anonymously.
router.use(requireAuth);

const MAX_SIGNATURE_BYTES = 500_000; // ~500KB
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

// Allowlist of MIME types for avatar uploads. The frontend SignaturePad emits
// only PNG (canvas.toDataURL('image/png')), so signatures go through the
// dedicated /upload-signature endpoint. Avatars accept the common image
// formats but NOT SVG by default — SVG can carry <script>/onload handlers
// that XSS any viewer who renders it. Re-enable SVG only with DOMPurify
// sanitisation in place.
const AVATAR_MIME_ALLOWLIST = new Set(['image/png', 'image/jpeg', 'image/webp']);
const AVATAR_EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

// Validate IDs that are interpolated into filesystem paths. Prevents
// path traversal (../) and absolute paths via user-controlled values.
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
function safeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value);
}

// ── Multer config for avatar uploads ──
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Never trust file.originalname. Pick the extension from the validated
    // MIME type and use a random UUID for the basename.
    const ext = AVATAR_EXT_BY_MIME[file.mimetype] || '.bin';
    const id = crypto.randomUUID();
    cb(null, `${id}${ext}`);
  },
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!AVATAR_MIME_ALLOWLIST.has(file.mimetype)) {
      return cb(new Error('Unsupported image type'));
    }
    cb(null, true);
  },
});

// ── POST /api/upload-signature ──
// Accepts base64 signature data, saves to disk, returns URL.
// The frontend SignaturePad always emits PNG via canvas.toDataURL('image/png').
router.post('/upload-signature', async (req, res, next) => {
  try {
    const { submissionId, level, signatureData, comment, approverName } = req.body;
    if (!submissionId || !level || !signatureData) {
      return res.status(400).json({ error: 'submissionId, level, and signatureData are required' });
    }

    // Path-traversal defense: submissionId becomes a directory name on disk.
    if (!safeId(String(submissionId))) {
      return res.status(400).json({ error: 'Invalid submissionId' });
    }
    const lvl = Number(level);
    if (!Number.isInteger(lvl) || lvl < 0 || lvl > 99) {
      return res.status(400).json({ error: 'Invalid level' });
    }

    // Only accept the PNG data URL that SignaturePad produces. Reject anything
    // else (e.g. an SVG data URL that could XSS via inline script).
    if (typeof signatureData !== 'string' || !signatureData.startsWith('data:image/png;base64,')) {
      return res.status(400).json({ error: 'Signature must be a base64 PNG data URL' });
    }

    const base64 = signatureData.slice('data:image/png;base64,'.length);
    const estimatedBytes = Math.ceil(base64.length * 3 / 4);
    if (estimatedBytes > MAX_SIGNATURE_BYTES) {
      return res.status(413).json({ error: `Signature too large (${Math.round(estimatedBytes / 1024)}KB). Max ${Math.round(MAX_SIGNATURE_BYTES / 1024)}KB.` });
    }

    const buffer = Buffer.from(base64, 'base64');
    // Verify PNG magic bytes — the data URL prefix is trivially spoofable.
    const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < 8 || !buffer.slice(0, 8).equals(PNG_SIG)) {
      return res.status(400).json({ error: 'Signature payload is not a valid PNG' });
    }

    // Save to disk under a normalised path. We construct the path then
    // re-resolve it and assert it stays inside the signatures root.
    const sigRoot = path.resolve(__dirname, '..', 'uploads', 'signatures');
    const subDir = path.resolve(sigRoot, String(submissionId));
    if (!subDir.startsWith(sigRoot + path.sep)) {
      return res.status(400).json({ error: 'Invalid submissionId' });
    }
    fs.mkdirSync(subDir, { recursive: true });
    const filename = `level${lvl}_${Date.now()}_${crypto.randomUUID()}.png`;
    const filePath = path.join(subDir, filename);
    fs.writeFileSync(filePath, buffer);

    const signatureUrl = `/uploads/signatures/${submissionId}/${filename}`;

    // Insert into jf_signatures
    const { rows } = await pool.query(
      `INSERT INTO jf_signatures (submission_id, level, approver_name, comment, signature_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [submissionId, lvl, approverName || null, comment || null, signatureUrl]
    );

    res.json({ signatureUrl, id: rows[0]?.id });
  } catch (err) { next(err); }
});

// ── POST /api/upload-avatar ──
// Multipart form upload for profile avatar
router.post('/upload-avatar', (req, res, next) => {
  uploadAvatar.single('avatar')(req, res, async (err) => {
    if (err) {
      const status = err instanceof multer.MulterError ? 413 : 400;
      return res.status(status).json({ error: err.message });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const avatarUrl = `/uploads/avatars/${req.file.filename}`;

      // Update profile if user is authenticated
      if (req.session?.userId) {
        await pool.query(
          'UPDATE profiles SET avatar_url = $1, updated_at = now() WHERE user_id = $2',
          [avatarUrl, req.session.userId]
        );
      }

      res.json({ avatarUrl });
    } catch (e) { next(e); }
  });
});

module.exports = router;
