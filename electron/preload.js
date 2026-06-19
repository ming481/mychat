const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatApp', {
  getDefaultPaths: () => ipcRenderer.invoke('chat-settings:get-default-paths'),
  getSettings: () => ipcRenderer.invoke('chat-settings:get'),
  setSettings: settings => ipcRenderer.invoke('chat-settings:set', settings),
  chooseDirectory: currentPath => ipcRenderer.invoke('chat-settings:choose-directory', currentPath),
  notifyNewMessage: payload => ipcRenderer.invoke('notify:new-message', payload),
  onDownloadCompleted: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download:completed', listener);
    return () => ipcRenderer.removeListener('download:completed', listener);
  },
  localMessages: {
    save: payload => ipcRenderer.invoke('local-messages:save', payload),
    replace: payload => ipcRenderer.invoke('local-messages:replace', payload),
    getLatest: payload => ipcRenderer.invoke('local-messages:get-latest', payload),
    getOlder: payload => ipcRenderer.invoke('local-messages:get-older', payload),
    deleteMessage: payload => ipcRenderer.invoke('local-messages:delete-message', payload),
    list: payload => ipcRenderer.invoke('local-messages:list', payload),
    clear: items => ipcRenderer.invoke('local-messages:clear', items),
    getDraft: payload => ipcRenderer.invoke('local-messages:get-draft', payload),
    saveDraft: payload => ipcRenderer.invoke('local-messages:save-draft', payload),
  },
});
