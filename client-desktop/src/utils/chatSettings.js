const SETTINGS_KEY = 'chatapp.chatSettings.v1';

const DEFAULTS = {
  downloadPath: '',
  messagePath: '',
};

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
  return window.chatApp?.getDefaultPaths?.()
    .then(paths => paths?.downloadPath || DEFAULTS.downloadPath)
    .catch(() => DEFAULTS.downloadPath);
}

export function getDefaultMessagePath() {
  return window.chatApp?.getDefaultPaths?.()
    .then(paths => paths?.messagePath || DEFAULTS.messagePath)
    .catch(() => DEFAULTS.messagePath);
}

export async function getChatSettings() {
  const local = readLocal();
  const nativeSettings = await window.chatApp?.getSettings?.().catch(() => null);
  return { ...local, ...(nativeSettings || {}) };
}

export async function saveChatSettings(next) {
  writeLocal(next);
  await window.chatApp?.setSettings?.(next).catch(() => {});
  return next;
}

export async function chooseDownloadPath(current) {
  const selected = await window.chatApp?.chooseDirectory?.(current).catch(() => null);
  if (!selected) return null;
  const settings = { ...(await getChatSettings()), downloadPath: selected };
  await saveChatSettings(settings);
  return selected;
}

export async function chooseMessagePath(current) {
  const selected = await window.chatApp?.chooseDirectory?.(current).catch(() => null);
  if (!selected) return null;
  const settings = { ...(await getChatSettings()), messagePath: selected };
  await saveChatSettings(settings);
  return selected;
}

export async function resetDownloadPath() {
  const settings = { ...(await getChatSettings()), downloadPath: '' };
  await saveChatSettings(settings);
  return getDefaultDownloadPath();
}

export async function resetMessagePath() {
  const settings = { ...(await getChatSettings()), messagePath: '' };
  await saveChatSettings(settings);
  return getDefaultMessagePath();
}

