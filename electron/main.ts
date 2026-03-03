import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { scanLibrary, scanDevice } from './services/library';
import { getConnectedWalkman, watchDevices } from './services/device';
import { copyTracks } from './services/transfer';
import { readTrackMetadata } from './services/metadata';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'sTune',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Watch for Walkman device connections
  watchDevices((devices) => {
    if (mainWindow) {
      mainWindow.webContents.send('devices-changed', devices);
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ===== IPC Handlers =====

// Select a folder for the music library
ipcMain.handle('select-library-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Music Library Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Scan a folder and return all music tracks
ipcMain.handle('scan-library', async (_event, folderPath: string) => {
  return await scanLibrary(folderPath);
});

// Get connected Walkman devices
ipcMain.handle('get-devices', async () => {
  return await getConnectedWalkman();
});

// Scan a specific Walkman device
ipcMain.handle('scan-device', async (_event, mountPath: string) => {
  return await scanDevice(mountPath);
});

// Copy tracks from source to destination
ipcMain.handle(
  'copy-tracks',
  async (_event, args: { sourcePaths: string[]; destinationDir: string }) => {
    return await copyTracks(
      args.sourcePaths,
      args.destinationDir,
      (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('transfer-progress', progress);
        }
      }
    );
  }
);

// Read metadata for a single track
ipcMain.handle('read-metadata', async (_event, filePath: string) => {
  return await readTrackMetadata(filePath);
});

// Delete tracks
ipcMain.handle('delete-tracks', async (_event, filePaths: string[]) => {
  const results: { path: string; success: boolean; error?: string }[] = [];
  for (const filePath of filePaths) {
    try {
      await fs.promises.unlink(filePath);
      results.push({ path: filePath, success: true });
    } catch (err: any) {
      results.push({ path: filePath, success: false, error: err.message });
    }
  }
  return results;
});

// Show file in Finder
ipcMain.handle('show-in-finder', async (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// Get disk usage for a path
ipcMain.handle('get-disk-usage', async (_event, mountPath: string) => {
  try {
    const stats = await fs.promises.statfs(mountPath);
    return {
      total: stats.bsize * stats.blocks,
      free: stats.bsize * stats.bfree,
      used: stats.bsize * (stats.blocks - stats.bfree),
    };
  } catch {
    return null;
  }
});
