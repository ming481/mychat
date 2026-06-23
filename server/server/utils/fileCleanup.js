const fs = require('fs');
const path = require('path');
const { deleteCloudFile } = require('./cloudStorage');

function localUrl(filePath) {
  return filePath ? `/uploads/${filePath}` : null;
}

function fileUrls(file) {
  return [localUrl(file.file_path), file.public_url].filter(Boolean);
}

function deleteLocalFile(uploadDir, filePath) {
  if (!filePath) return;
  const fullPath = path.join(uploadDir, path.basename(filePath));
  try {
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (err) {
    console.warn('[cleanup] delete local file failed:', fullPath, err.message);
  }
}

async function deleteStoredFile({ uploadDir, file }) {
  if (file.storage_type === 'cloudbase') {
    try {
      await deleteCloudFile(file.cloud_file_id);
    } catch (err) {
      console.warn('[cleanup] delete cloud file failed:', file.cloud_path || file.cloud_file_id, err.message);
    }
    return;
  }

  deleteLocalFile(uploadDir, file.file_path);
}

async function cleanupExpiredFiles({ pool, uploadDir, ttlDays }) {
  const result = await pool.query(
    `SELECT DISTINCT f.id, f.file_path, f.storage_type, f.cloud_file_id, f.cloud_path, f.public_url
     FROM files f
     JOIN messages m
       ON m.type IN (1, 2)
      AND m.created_at < NOW() - ($1 * INTERVAL '1 day')
      AND (
        m.file_url = f.public_url
        OR m.content = f.public_url
        OR m.file_url = ('/uploads/' || f.file_path)
        OR m.content = ('/uploads/' || f.file_path)
      )`,
    [ttlDays]
  );

  if (!result.rows.length) return { removed: 0 };

  for (const file of result.rows) {
    const messageUrls = fileUrls(file);
    await deleteStoredFile({ uploadDir, file });

    await pool.query(
      `UPDATE messages
       SET file_url = NULL,
           content = NULL,
           file_name = NULL,
           file_size = NULL
       WHERE type IN (1, 2)
         AND created_at < NOW() - ($2 * INTERVAL '1 day')
         AND (file_url = ANY($1::text[]) OR content = ANY($1::text[]))`,
      [messageUrls, ttlDays]
    );
    await pool.query(
      `DELETE FROM files
       WHERE id = $1
         AND NOT EXISTS (
           SELECT 1 FROM messages
           WHERE file_url = ANY($2::text[]) OR content = ANY($2::text[])
         )`,
      [file.id, messageUrls]
    );
  }

  return { removed: result.rows.length };
}

function scheduleFileCleanup({ pool, uploadDir, ttlDays, intervalMs }) {
  const run = async () => {
    try {
      const { removed } = await cleanupExpiredFiles({ pool, uploadDir, ttlDays });
      if (removed > 0) console.log(`[cleanup] removed expired files: ${removed}`);
    } catch (err) {
      console.error('[cleanup] cleanup task failed:', err);
    }
  };

  run();
  return setInterval(run, intervalMs);
}

module.exports = { scheduleFileCleanup };
