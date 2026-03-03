import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { scanLibrary, scanDevice } from './services/library';
import { getConnectedWalkman, watchDevices } from './services/device';
import { copyTracks } from './services/transfer';
import { readTrackMetadata } from './services/metadata';
import {
  loadLibraryDb,
  saveLibraryDb,
  scanFolderIntoDb,
  removeFolderFromDb,
  updateTrackCustomMeta,
  dbToLibrary,
  type LibraryDatabase,
} from './services/libraryDb';

let libraryDb: LibraryDatabase | null = null;

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
  // Allow eval() in dev mode for Vite's React Fast Refresh (Babel HMR)
  if (isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*; img-src 'self' data:",
          ],
        },
      });
    });
  }

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
  const defaultMusicPath = path.join(app.getPath('home'), 'Music');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'treatPackageAsDirectory'],
    title: 'Select Music Library Folder',
    defaultPath: defaultMusicPath,
    message: 'Select a folder containing your music files',
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

// ===== Library DB Handlers =====

// Load the persistent library database
ipcMain.handle('load-library-db', async () => {
  libraryDb = await loadLibraryDb();
  if (Object.keys(libraryDb.tracks).length > 0) {
    return dbToLibrary(libraryDb);
  }
  return null;
});

// Add a folder to the library and scan it
ipcMain.handle('add-library-folder', async (_event, folderPath: string) => {
  if (!libraryDb) {
    libraryDb = await loadLibraryDb();
  }
  libraryDb = await scanFolderIntoDb(libraryDb, folderPath, (current, total) => {
    if (mainWindow) {
      mainWindow.webContents.send('scan-progress', { current, total });
    }
  });
  await saveLibraryDb(libraryDb);
  return dbToLibrary(libraryDb);
});

// Rescan all library folders (incremental - only changed files)
ipcMain.handle('rescan-library', async () => {
  if (!libraryDb) {
    libraryDb = await loadLibraryDb();
  }
  for (const folderPath of libraryDb.libraryPaths) {
    libraryDb = await scanFolderIntoDb(libraryDb, folderPath, (current, total) => {
      if (mainWindow) {
        mainWindow.webContents.send('scan-progress', { current, total });
      }
    });
  }
  await saveLibraryDb(libraryDb);
  return dbToLibrary(libraryDb);
});

// Remove a folder from the library
ipcMain.handle('remove-library-folder', async (_event, folderPath: string) => {
  if (!libraryDb) {
    libraryDb = await loadLibraryDb();
  }
  libraryDb = removeFolderFromDb(libraryDb, folderPath);
  await saveLibraryDb(libraryDb);
  return dbToLibrary(libraryDb);
});

// Update custom metadata for a track (rating, tags, etc.)
ipcMain.handle(
  'update-track-meta',
  async (
    _event,
    args: {
      filePath: string;
      updates: Partial<{
        rating: number;
        playCount: number;
        favorite: boolean;
        tags: string[];
        comment: string;
      }>;
    }
  ) => {
    if (!libraryDb) {
      libraryDb = await loadLibraryDb();
    }
    libraryDb = updateTrackCustomMeta(libraryDb, args.filePath, args.updates);
    await saveLibraryDb(libraryDb);
    return libraryDb.tracks[args.filePath] || null;
  }
);

// Get the library DB file path (for debugging / export)
ipcMain.handle('get-library-db-path', async () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'sTuneLibrary.json');
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
