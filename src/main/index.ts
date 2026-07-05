import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { registerAssetProtocolHandler, registerAssetProtocolScheme } from './assets/assetProtocol';
import { registerAssetIpc } from './ipc/assetIpc';
import { registerBackupIpc } from './ipc/backupIpc';
import { registerDataIpc } from './ipc/dataIpc';
import { registerExportIpc } from './ipc/exportIpc';
import { registerIntegrityIpc } from './ipc/integrityIpc';
import { registerVaultIpc } from './ipc/vaultIpc';

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: '手稿星图 Manuscript Atlas',
    backgroundColor: '#E8D1A7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
};

registerAssetProtocolScheme();

app.whenReady().then(() => {
  registerAssetProtocolHandler();
  registerVaultIpc();
  registerDataIpc();
  registerExportIpc();
  registerAssetIpc();
  registerBackupIpc();
  registerIntegrityIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
