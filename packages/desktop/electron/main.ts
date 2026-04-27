import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow(): BrowserWindow {
  const iconPath = path.join(__dirname, '../build/icon.png');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    title: 'Starfleet Monitor',
    icon: process.platform === 'darwin' ? undefined : iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Frameless-ish on macOS
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();

  // Auto-updater (production only)
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: dark mode
ipcMain.handle('dark-mode:get', () => nativeTheme.shouldUseDarkColors);
ipcMain.handle('dark-mode:toggle', () => {
  nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
  return nativeTheme.shouldUseDarkColors;
});

nativeTheme.on('updated', () => {
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send('dark-mode:changed', nativeTheme.shouldUseDarkColors),
  );
});
