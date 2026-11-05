const { contextBridge, ipcRenderer } = require('electron');
const methods = new Set(['info', 'discover', 'pick', 'preview', 'invalidate', 'execute', 'backups', 'previewRestore', 'restore', 'reveal', 'cancel','libraryScan','libraryPage','libraryPreview','libraryAnalyze','libraryMark','libraryPrepare','librarySave','libraryOutputs','libraryReveal','environment']);
contextBridge.exposeInMainWorld('maintenance', Object.freeze({
  call(method, value) {
    if (!methods.has(method)) return Promise.resolve({ ok: false, error: '不支持的操作。' });
    return ipcRenderer.invoke('maintenance:call', method, value);
  },
  onProgress(callback) {
    const listener = (_event, event) => callback(event);
    ipcRenderer.on('maintenance:progress', listener);
    return () => ipcRenderer.removeListener('maintenance:progress', listener);
  }
}));
