const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');

const router = Router();

const MAX_SIGNATURE_BYTES = 500_000; // ~500KB

// ── Multer config for avatar uploads ──
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${req.session?.userId || 'anon'}_${Date.now()}${ext}`);
  },
});
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 2 * 1024 * 1024 } });

// ── POST /api/upload-signature ──
// Accepts base64 signature data, saves to disk, returns URL
router.post('/upload-signature', async (req, res, next) => {
  try {
    const { submissionId, level, signatureData, comment, approverName } = req.body;
    if (!submissionId || !level || !signatureData) {
      return res.status(400).json({ error: 'submissionId, level, and signatureData are required' });
    }

    const base64 = signatureData.replace(/^data:image\/\w+;base64,/, '');
    const estimatedBytes = Math.ceil(base64.length * 3 / 4);
    if (estimatedBytes > MAX_SIGNATURE_BYTES) {
      return res.status(413).json({ error: `Signature too large (${Math.round(estimatedBytes / 1024)}KB). Max ${Math.round(MAX_SIGNATURE_BYTES / 1024)}KB.` });
    }

    const buffer = Buffer.from(base64, 'base64');

    // Save to disk
    const subDir = path.join(__dirname, '..', 'uploads', 'signatures', submissionId);
    fs.mkdirSync(subDir, { recursive: true });
    const filename = `level${level}_${Date.now()}.png`;
    const filePath = path.join(subDir, filename);
    fs.writeFileSync(filePath, buffer);

    const signatureUrl = `/uploads/signatures/${submissionId}/${filename}`;

    // Insert into jf_signatures
    const { rows } = await pool.query(
      `INSERT INTO jf_signatures (submission_id, level, approver_name, comment, signature_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [submissionId, level, approverName || null, comment || null, signatureUrl]
    );

    res.json({ signatureUrl, id: rows[0]?.id });
  } catch (err) { next(err); }
});

// ── POST /api/upload-avatar ──
// Multipart form upload for profile avatar
router.post('/upload-avatar', uploadAvatar.single('avatar'), async (req, res, next) => {
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
  } catch (err) { next(err); }
});

module.exports = router;
