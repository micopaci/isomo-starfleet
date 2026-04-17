import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getDarkMode: () => ipcRenderer.invoke('dark-mode:get'),
  toggleDarkMode: () => ipcRenderer.invoke('dark-mode:toggle'),
  onDarkModeChanged: (cb: (dark: boolean) => void) => {
    ipcRenderer.on('dark-mode:changed', (_evt, dark) => cb(dark));
  },
});
