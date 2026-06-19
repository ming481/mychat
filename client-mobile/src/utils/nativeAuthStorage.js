import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export async function saveNativeAuth(token, user) {
  try {
    await Preferences.set({ key: TOKEN_KEY, value: token || '' });
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(user || null) });
  } catch (err) {
    console.warn('save native auth failed', err);
  }
}

export async function loadNativeAuth() {
  try {
    const [{ value: token }, { value: userValue }] = await Promise.all([
      Preferences.get({ key: TOKEN_KEY }),
      Preferences.get({ key: USER_KEY }),
    ]);
    let user = null;
    try {
      user = userValue ? JSON.parse(userValue) : null;
    } catch {
      user = null;
    }
    return { token: token || null, user };
  } catch (err) {
    console.warn('load native auth failed', err);
    return { token: null, user: null };
  }
}

export async function clearNativeAuth() {
  try {
    await Promise.all([
      Preferences.remove({ key: TOKEN_KEY }),
      Preferences.remove({ key: USER_KEY }),
    ]);
  } catch (err) {
    console.warn('clear native auth failed', err);
  }
}
