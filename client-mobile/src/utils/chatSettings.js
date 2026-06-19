import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { promptDialog } from './appDialog';

const SETTINGS_KEY = 'chatapp.chatSettings.v1';

const DEFAULTS = {
  downloadPath: 'ChatApp/Downloads',
  messagePath: 'Documents/ChatApp/Records',
};

const DOWNLOAD_SUBDIRS = [
  `${DEFAULTS.downloadPath}/pictures`,
  `${DEFAULTS.downloadPath}/videos`,
  `${DEFAULTS.downloadPath}/files`,
];

function readLocal() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeLocal(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getDefaultDownloadPath() {
  return Promise.resolve(`Documents/${DEFAULTS.downloadPath}`);
}

export function getDefaultMessagePath() {
  return Promise.resolve(DEFAULTS.messagePath);
}

export async function getChatSettings() {
  return readLocal();
}

export async function saveChatSettings(next) {
  writeLocal(next);
  return next;
}

export async function chooseDownloadPath(current) {
  void current;
  const settings = { ...(await getChatSettings()), downloadPath: DEFAULTS.downloadPath };
  await saveChatSettings(settings);
  return getDefaultDownloadPath();
}

export async function chooseMessagePath(current) {
  const next = await promptDialog('请输入聊天记录位置名称', {
    title: '聊天记录位置',
    defaultValue: current || DEFAULTS.messagePath,
    placeholder: DEFAULTS.messagePath,
  });
  if (!next) return null;
  const clean = next
    .replace(/^Documents\/?/i, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  const settings = { ...(await getChatSettings()), messagePath: clean ? `Documents/${clean}` : DEFAULTS.messagePath };
  await saveChatSettings(settings);
  return settings.messagePath;
}

export async function resetDownloadPath() {
  const settings = { ...(await getChatSettings()), downloadPath: DEFAULTS.downloadPath };
  await saveChatSettings(settings);
  return getDefaultDownloadPath();
}

export async function resetMessagePath() {
  const settings = { ...(await getChatSettings()), messagePath: DEFAULTS.messagePath };
  await saveChatSettings(settings);
  return getDefaultMessagePath();
}

export function getMobileDownloadSubdir() {
  return DEFAULTS.downloadPath;
}

export async function ensureMobileStorageDirs() {
  if (!Capacitor.isNativePlatform()) return;

  await Filesystem.deleteFile({
    path: 'Downloads/.chatapp_keep',
    directory: Directory.External,
  }).catch(() => {});

  for (const path of ['ChatApp', DEFAULTS.downloadPath, ...DOWNLOAD_SUBDIRS, 'ChatApp/Records']) {
    await Filesystem.mkdir({
      path,
      directory: Directory.Documents,
      recursive: true,
    }).catch(err => {
      console.warn('[storage] mkdir failed:', path, err);
    });
  }

  await Filesystem.writeFile({
    path: `${DEFAULTS.downloadPath}/.chatapp_keep`,
    data: 'ChatApp download directory marker.',
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  }).catch(err => {
    console.warn('[storage] write downloads marker failed:', err);
  });

  await Filesystem.writeFile({
    path: 'ChatApp/Records/.chatapp_keep',
    data: 'ChatApp records directory marker.',
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  }).catch(err => {
    console.warn('[storage] write records marker failed:', err);
  });
}
