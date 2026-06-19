const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pool } = require('../db/index');
const { authMiddleware } = require('../middleware/auth');
const { buildCloudPath, isCloudStorageEnabled, uploadBuffer } = require('../utils/cloudStorage');

const router = express.Router();
const CHAT_FILE_LIMIT = 20 * 1024 * 1024;
const AVATAR_FILE_LIMIT = 3 * 1024 * 1024;

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function createUpload(maxSize) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSize },
    fileFilter: (req, file, cb) => {
    const blocked = ['.exe', '.bat', '.sh', '.cmd', '.msi'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) return cb(new Error('不支持该文件类型'));
    cb(null, true);
    },
  });
}

function uploadSingle(fieldName, maxSize, limitLabel) {
  return (req, res, next) => {
    const upload = createUpload(maxSize);
    upload.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `文件大小超过 ${limitLabel} 限制` });
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  };
}

function normalizeOriginalName(name = '') {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

function makeStoredName(originalName = '') {
  const ext = path.extname(originalName).toLowerCase();
  return `${crypto.randomBytes(16).toString('hex')}${ext}`;
}

async function storeUploadedFile({ file, userId, kind }) {
  const originalName = normalizeOriginalName(file.originalname);
  const storedName = makeStoredName(originalName);
  const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  if (isCloudStorageEnabled()) {
    const cloudPath = buildCloudPath({
      kind,
      userId,
      filename: path.basename(storedName, path.extname(storedName)),
      originalName,
    });
    const cloud = await uploadBuffer({ buffer: file.buffer, cloudPath });
    if (cloud?.fileID && cloud?.url) {
      return {
        originalName,
        storedName,
        hash,
        url: cloud.url,
        storageType: cloud.storageType,
        cloudFileId: cloud.fileID,
        cloudPath: cloud.cloudPath,
        publicUrl: cloud.url,
      };
    }
  }

  const fullPath = path.join(uploadDir, storedName);
  await fs.promises.writeFile(fullPath, file.buffer);
  return {
    originalName,
    storedName,
    hash,
    url: `/uploads/${storedName}`,
    storageType: 'local',
    cloudFileId: null,
    cloudPath: null,
    publicUrl: null,
  };
}

router.post('/upload', authMiddleware, uploadSingle('file', CHAT_FILE_LIMIT, '20MB'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' });
  try {
    const stored = await storeUploadedFile({ file: req.file, userId: req.userId, kind: 'file' });
    const result = await pool.query(
      `INSERT INTO files
        (uploader_id, file_name, file_path, file_size, mime_type, hash,
         storage_type, cloud_file_id, cloud_path, public_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.userId,
        stored.originalName,
        stored.storedName,
        req.file.size,
        req.file.mimetype,
        stored.hash,
        stored.storageType,
        stored.cloudFileId,
        stored.cloudPath,
        stored.publicUrl,
      ]
    );
    const file = result.rows[0];
    res.json({
      id: file.id,
      file_name: file.file_name,
      file_url: stored.url,
      file_size: file.file_size,
      mime_type: file.mime_type,
      storage_type: file.storage_type,
    });
  } catch (err) {
    console.error('upload error details:', err);
    res.status(500).json({ error: '上传失败' });
  }
});

async function storeAvatarRecord(req, res, { updateUserAvatar }) {
  if (!req.file) return res.status(400).json({ error: '未选择图片' });
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowed.includes(req.file.mimetype)) {
    return res.status(400).json({ error: '只支持图片文件' });
  }

  try {
    const stored = await storeUploadedFile({ file: req.file, userId: req.userId, kind: 'avatar' });
    await pool.query(
      `INSERT INTO files
        (uploader_id, file_name, file_path, file_size, mime_type, hash,
         storage_type, cloud_file_id, cloud_path, public_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        req.userId,
        stored.originalName,
        stored.storedName,
        req.file.size,
        req.file.mimetype,
        stored.hash,
        stored.storageType,
        stored.cloudFileId,
        stored.cloudPath,
        stored.publicUrl,
      ]
    );
    if (updateUserAvatar) {
      await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [stored.url, req.userId]);
      return res.json({ avatar_url: stored.url, storage_type: stored.storageType });
    }
    return res.json({ file_url: stored.url, storage_type: stored.storageType });
  } catch (err) {
    console.error('avatar upload error details:', err);
    res.status(500).json({ error: '头像上传失败' });
  }
}

router.post('/avatar', authMiddleware, uploadSingle('avatar', AVATAR_FILE_LIMIT, '3MB'), async (req, res) => {
  return storeAvatarRecord(req, res, { updateUserAvatar: true });
});

router.post('/group-avatar', authMiddleware, uploadSingle('avatar', AVATAR_FILE_LIMIT, '3MB'), async (req, res) => {
  return storeAvatarRecord(req, res, { updateUserAvatar: false });
});

module.exports = router;
