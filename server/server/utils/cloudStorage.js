const path = require('path');

let cloudApp = null;

function isCloudStorageEnabled() {
  return Boolean(
    process.env.CLOUDBASE_ENV_ID &&
    process.env.TENCENT_SECRET_ID &&
    process.env.TENCENT_SECRET_KEY
  );
}

function getCloudApp() {
  if (!isCloudStorageEnabled()) return null;
  if (!cloudApp) {
    const tcb = require('@cloudbase/node-sdk');
    cloudApp = tcb.init({
      env: process.env.CLOUDBASE_ENV_ID,
      secretId: process.env.TENCENT_SECRET_ID,
      secretKey: process.env.TENCENT_SECRET_KEY,
    });
  }
  return cloudApp;
}

function safeExt(originalName = '') {
  const ext = path.extname(originalName).toLowerCase();
  return ext && ext.length <= 12 ? ext : '';
}

function buildCloudPath({ kind, userId, filename, originalName }) {
  const prefix = (process.env.CLOUDBASE_STORAGE_PREFIX || 'chatapp').replace(/^\/+|\/+$/g, '');
  const ext = safeExt(originalName);
  const folder = kind === 'avatar' ? 'avatars' : 'files';
  return `${prefix}/${folder}/${userId}/${filename}${ext}`;
}

async function getTempFileURL(fileID) {
  const app = getCloudApp();
  if (!app || !fileID) return null;
  const { fileList } = await app.getTempFileURL({ fileList: [fileID] });
  return fileList?.[0]?.tempFileURL || null;
}

async function uploadBuffer({ buffer, cloudPath }) {
  const app = getCloudApp();
  if (!app) return null;
  const result = await app.uploadFile({
    cloudPath,
    fileContent: buffer,
  });
  const fileID = result.fileID;
  const publicBase = (process.env.CLOUDBASE_PUBLIC_BASE_URL || '').replace(/\/+$/g, '');
  const url = publicBase ? `${publicBase}/${cloudPath}` : await getTempFileURL(fileID);
  return {
    storageType: 'cloudbase',
    fileID,
    cloudPath,
    url,
  };
}

async function deleteCloudFile(fileID) {
  const app = getCloudApp();
  if (!app || !fileID) return false;
  await app.deleteFile({ fileList: [fileID] });
  return true;
}

module.exports = {
  buildCloudPath,
  deleteCloudFile,
  getTempFileURL,
  isCloudStorageEnabled,
  uploadBuffer,
};
