const { contextBridge, ipcRenderer } = require('electron');
const call = async (name, ...args) => {
  const response = await ipcRenderer.invoke(name, ...args);
  if (!response.ok) throw Object.assign(new Error(response.error), { code: response.code, retryable: response.retryable });
  return response.value;
};
const on = (channel, handler) => { const listener = (_, value) => handler(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); };
contextBridge.exposeInMainWorld('transcribe', {
  getState: () => call('state'), saveSettings: value => call('settings', value),
  saveKey: key => call('save-key', key), removeKey: () => call('remove-key'), testKey: () => call('test-key'),
  transcribe: audio => call('transcribe', audio), cancel: () => call('cancel'),
  beginRecording: () => call('begin-recording'), recordingAction: action => call('recording-action', action),
  appendSegment: input => call('append-segment', input), finishDictation: (id, duration, retry) => call('finish-dictation', id, duration, retry),
  getOverlayState: () => call('overlay-state'), moveOverlay: (dx, dy) => call('move-overlay', dx, dy),
  setRecordingState: (value, message) => call('recording-state', value, message), microphonePermission: () => call('microphone-permission'),
  openSettings: () => call('open-settings'), dismissOverlay: () => call('dismiss-overlay'),
  getHistory: () => call('history'), deleteHistory: id => call('delete-history', id), clearHistory: () => call('clear-history'),
  copy: text => call('copy', text), exportText: text => call('export', text),
  openExternal: name => call('external', name), accessibility: () => call('accessibility'),
  minimize: () => call('minimize'), close: () => call('close'),
  onToggle: handler => on('toggle-recording', handler), onNavigate: handler => on('navigate', handler),
  onRecordingAction: handler => on('recording-action', handler),
  onOverlay: handler => on('overlay-state', handler)
});
