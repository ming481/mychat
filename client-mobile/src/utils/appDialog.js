let dialogHandler = null;
const nativeAlert = window.alert.bind(window);
const nativeConfirm = window.confirm.bind(window);
const nativePrompt = window.prompt.bind(window);

export function setAppDialogHandler(handler) {
  dialogHandler = handler;
  return () => {
    if (dialogHandler === handler) dialogHandler = null;
  };
}

function openDialog(options) {
  if (dialogHandler) return dialogHandler(options);

  if (options.type === 'confirm') return Promise.resolve(nativeConfirm(options.message || ''));
  if (options.type === 'prompt') return Promise.resolve(nativePrompt(options.message || '', options.defaultValue || ''));
  nativeAlert(options.message || '');
  return Promise.resolve(true);
}

export function alertDialog(message, options = {}) {
  return openDialog({
    type: 'alert',
    title: options.title || '提示',
    message,
    confirmText: options.confirmText || '知道了',
    tone: options.tone || 'info',
  });
}

export function confirmDialog(message, options = {}) {
  return openDialog({
    type: 'confirm',
    title: options.title || '确认操作',
    message,
    confirmText: options.confirmText || '确认',
    cancelText: options.cancelText || '取消',
    tone: options.tone || 'info',
  });
}

export function promptDialog(message, options = {}) {
  return openDialog({
    type: 'prompt',
    title: options.title || '请输入',
    message,
    defaultValue: options.defaultValue || '',
    placeholder: options.placeholder || '',
    inputType: options.inputType || 'text',
    confirmText: options.confirmText || '确认',
    cancelText: options.cancelText || '取消',
    tone: options.tone || 'info',
  });
}
