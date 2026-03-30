import { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFileCb);
import { scanLibrary, scanDevice } from './services/library';
import { getConnectedWalkman, watchDevices } from './services/device';
import { copyTracks } from './services/transfer';
import { scanMtpDevice, isMtpPath, mtpUpload, isMtpCliAvailable, mtpBrowse, mtpDownloadFile, getMtpDevices, mtpDeleteFiles } from './services/mtp';
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
    title: 'sTunes',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show();
    mainWindow!.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部リンク（target="_blank" 等）はシステムのブラウザで開く
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// Register custom protocol for serving local audio files
protocol.registerSchemesAsPrivileged([
  { scheme: 'stune-audio', privileges: { stream: true, bypassCSP: true } },
]);

app.whenReady().then(() => {
  // Register file protocol handler for audio playback
  protocol.handle('stune-audio', (request) => {
    const filePath = decodeURIComponent(request.url.replace('stune-audio://', ''));
    return net.fetch('file://' + filePath);
  });

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

// MTP 用 mtp-cli が利用可能か（サイドバーで表示用）
ipcMain.handle('is-mtp-cli-available', () => isMtpCliAvailable());

// Scan a specific Walkman device（USB マウント or MTP）
ipcMain.handle('scan-device', async (_event, mountPath: string) => {
  if (isMtpPath(mountPath)) return await scanMtpDevice(mountPath);
  return await scanDevice(mountPath);
});

// Copy tracks from source to destination（USB または MTP へ）
ipcMain.handle(
  'copy-tracks',
  async (_event, args: { sourcePaths: string[]; destinationDir: string }) => {
    if (isMtpPath(args.destinationDir)) {
      const total = args.sourcePaths.length;
      const result = await mtpUpload(
        args.destinationDir,
        args.sourcePaths,
        '/MUSIC',
        (current, tot, currentFile) => {
          if (mainWindow) {
            mainWindow.webContents.send('transfer-progress', {
              totalFiles: tot,
              completedFiles: current,
              currentFile: currentFile.split('/').pop() || currentFile,
              percentage: Math.round((current / tot) * 100),
              status: current === tot ? 'completed' : 'transferring',
            });
          }
        }
      );
      if (!result.success && mainWindow) {
        mainWindow.webContents.send('transfer-progress', {
          totalFiles: total,
          completedFiles: 0,
          currentFile: '',
          percentage: 0,
          status: 'error',
          error: result.error,
        });
      }
      return {
        success: result.success,
        copiedCount: result.success ? total : 0,
        errors: result.error ? [result.error] : [],
      };
    }
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

// Copy tracks to device with Artist/Album directory structure
ipcMain.handle(
  'copy-tracks-structured',
  async (_event, args: { sourcePaths: string[]; deviceMountPath: string }) => {
    if (!libraryDb) {
      libraryDb = await loadLibraryDb();
    }
    const total = args.sourcePaths.length;
    const errors: string[] = [];
    let completed = 0;

    const isMtp = isMtpPath(args.deviceMountPath);

    // Build ordered filename: prefix with disc/track number so Walkman plays in order
    const tmpDir = isMtp ? path.join(app.getPath('temp'), 'stunes-transfer') : '';
    if (isMtp && tmpDir) {
      await fs.promises.mkdir(tmpDir, { recursive: true });
    }

    for (const filePath of args.sourcePaths) {
      const track = libraryDb.tracks[filePath];
      const artist = (track?.artist || 'Unknown Artist').replace(/[/\\:*?"<>|]/g, '_');
      const album = (track?.album || 'Unknown Album').replace(/[/\\:*?"<>|]/g, '_');
      const origFileName = path.basename(filePath);

      // Generate track-number-prefixed filename for correct playback order
      const disc = track?.discNumber || 1;
      const trackNum = track?.trackNumber || 0;
      const prefix = trackNum > 0
        ? (disc > 1 ? `${disc}-${String(trackNum).padStart(2, '0')}` : String(trackNum).padStart(2, '0'))
        : '';
      // Only prefix if filename doesn't already start with the track number
      const alreadyPrefixed = prefix && origFileName.match(/^\d+[-.\s]/);
      const destFileName = (!alreadyPrefixed && prefix)
        ? `${prefix} ${origFileName}`
        : origFileName;

      if (mainWindow) {
        mainWindow.webContents.send('transfer-progress', {
          totalFiles: total,
          completedFiles: completed,
          currentFile: origFileName,
          percentage: Math.round((completed / total) * 100),
          status: 'transferring',
        });
      }

      try {
        if (isMtp) {
          const destDir = `/MUSIC/${artist}/${album}`;
          // For MTP, create a symlink with the desired filename so mtp-cli uses it
          const symlinkPath = path.join(tmpDir, destFileName);
          try { await fs.promises.unlink(symlinkPath); } catch { /* ignore */ }
          await fs.promises.symlink(filePath, symlinkPath);
          console.log(`[transfer] MTP upload: ${destFileName} -> ${destDir} (storage: ${args.deviceMountPath})`);
          const result = await mtpUpload(args.deviceMountPath, [symlinkPath], destDir);
          try { await fs.promises.unlink(symlinkPath); } catch { /* ignore */ }
          if (!result.success) {
            console.error(`[transfer] MTP upload failed: ${destFileName}: ${result.error}`);
            errors.push(`${destFileName}: ${result.error}`);
          }
        } else {
          // USB mount: create directory and copy file with prefixed name
          const destDir = path.join(args.deviceMountPath, 'MUSIC', artist, album);
          await fs.promises.mkdir(destDir, { recursive: true });
          const destPath = path.join(destDir, destFileName);
          await fs.promises.copyFile(filePath, destPath);
        }
      } catch (err: any) {
        errors.push(`${origFileName}: ${err.message}`);
      }
      completed++;
    }

    // Clean up temp directory
    if (isMtp && tmpDir) {
      try { await fs.promises.rm(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }

    if (mainWindow) {
      mainWindow.webContents.send('transfer-progress', {
        totalFiles: total,
        completedFiles: total,
        currentFile: '',
        percentage: 100,
        status: errors.length > 0 ? 'error' : 'completed',
        error: errors.length > 0 ? errors.join('\n') : undefined,
      });
    }

    return { success: errors.length === 0, copiedCount: completed - errors.length, errors };
  }
);

// Delete tracks from a device (USB or MTP), then rescan to update the view
ipcMain.handle(
  'delete-device-tracks',
  async (_event, args: { mountPath: string; filePaths: string[] }) => {
    // MTP device
    if (isMtpPath(args.mountPath)) {
      const storageId = args.mountPath.replace('mtp://', '').split('/')[0];
      // Convert full virtual paths to MTP-relative paths
      const mtpPaths = args.filePaths.map((fp) => {
        // filePaths may be "mtp://0/MUSIC/Artist/Album/track.flac" or just "/MUSIC/..."
        if (fp.startsWith('mtp://')) {
          const rest = fp.slice(fp.indexOf('/', 6)); // skip "mtp://X"
          return rest || fp;
        }
        return fp;
      });
      const result = await mtpDeleteFiles(storageId, mtpPaths);
      let device: any = null;
      try { device = await scanMtpDevice(args.mountPath); } catch { /* ignore */ }
      return {
        success: result.success,
        deletedCount: result.deletedCount,
        errors: result.error ? [result.error] : [],
        device,
      };
    }

    // USB-mounted device
    const errors: string[] = [];
    for (const filePath of args.filePaths) {
      try {
        // Safety: only delete files that are actually on the device
        if (!filePath.startsWith(args.mountPath)) {
          errors.push(`${filePath}: not on device ${args.mountPath}`);
          continue;
        }
        await fs.promises.unlink(filePath);

        // Clean up empty parent directories up to the MUSIC folder
        const musicRoot = path.join(args.mountPath, 'MUSIC');
        let dir = path.dirname(filePath);
        while (dir.startsWith(musicRoot) && dir !== musicRoot) {
          const entries = await fs.promises.readdir(dir);
          if (entries.length === 0) {
            await fs.promises.rmdir(dir);
            dir = path.dirname(dir);
          } else {
            break;
          }
        }
      } catch (err: any) {
        errors.push(`${path.basename(filePath)}: ${err.message}`);
      }
    }

    // Rescan device to get updated track list
    const updatedDevice = await scanDevice(args.mountPath);

    return {
      success: errors.length === 0,
      deletedCount: args.filePaths.length - errors.length,
      errors,
      device: updatedDevice,
    };
  }
);

// Read metadata for a single track
ipcMain.handle('read-metadata', async (_event, filePath: string) => {
  return await readTrackMetadata(filePath);
});

// Delete tracks (file system only — legacy)
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

// Delete tracks from the library DB, optionally also from disk, then return updated library
ipcMain.handle(
  'delete-library-tracks',
  async (_event, args: { filePaths: string[]; fromDisk: boolean }) => {
    if (!libraryDb) {
      libraryDb = await loadLibraryDb();
    }
    const errors: string[] = [];

    for (const filePath of args.filePaths) {
      if (args.fromDisk) {
        try {
          await fs.promises.unlink(filePath);
        } catch (err: any) {
          // File might already be deleted — still remove from DB
          if (err.code !== 'ENOENT') {
            errors.push(`${path.basename(filePath)}: ${err.message}`);
          }
        }
      }
      delete libraryDb.tracks[filePath];
    }

    await saveLibraryDb(libraryDb);
    const library = dbToLibrary(libraryDb);
    return { library, deletedCount: args.filePaths.length - errors.length, errors };
  }
);

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

// Set master folder (iTunes-style managed library folder)
ipcMain.handle('set-master-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'マスターフォルダを選択',
    message: 'インポートした曲のコピー先フォルダを選択してください',
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  if (!libraryDb) {
    libraryDb = await loadLibraryDb();
  }
  libraryDb.masterFolder = result.filePaths[0];
  // Ensure it's also in libraryPaths so it gets scanned
  if (!libraryDb.libraryPaths.includes(libraryDb.masterFolder)) {
    libraryDb.libraryPaths.push(libraryDb.masterFolder);
  }
  await saveLibraryDb(libraryDb);
  return { masterFolder: libraryDb.masterFolder, library: dbToLibrary(libraryDb) };
});

// Browse MTP device directory (filtered)
ipcMain.handle('mtp-browse', async (_event, args: { storageId: string; path: string }) => {
  return await mtpBrowse(args.storageId, args.path);
});

// Download file from MTP device to temp directory for playback
ipcMain.handle('mtp-download-file', async (_event, args: { storageId: string; remotePath: string }) => {
  const os = require('os');
  const tempDir = path.join(os.tmpdir(), 'stune-playback');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  return await mtpDownloadFile(args.storageId, args.remotePath, tempDir);
});

// Get MTP device info with all storages
ipcMain.handle('mtp-get-devices', async () => {
  return await getMtpDevices();
});

// Eject a device (USB: diskutil eject, MTP: no-op but clear from UI)
ipcMain.handle('eject-device', async (_event, mountPath: string) => {
  if (mountPath.startsWith('mtp://')) {
    // MTP devices can't be ejected from software — just acknowledge
    return { success: true, message: 'MTP device removed from list. You can safely disconnect the USB cable.' };
  }
  // USB-mounted volume: use diskutil eject
  try {
    await execFileAsync('diskutil', ['eject', mountPath]);
    return { success: true, message: 'デバイスを取り出しました。USBケーブルを安全に抜けます。' };
  } catch (err: any) {
    return { success: false, message: `取り出しに失敗: ${err.message}` };
  }
});

// Import files into library: select files, read metadata, copy to ~/Music/sTunes/Artist/Album/
ipcMain.handle('import-to-library', async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Import Music Files',
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'flac', 'wav', 'aac', 'm4a', 'aiff', 'aif', 'ogg', 'wma', 'dsf', 'dff', 'opus'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  if (!libraryDb) {
    libraryDb = await loadLibraryDb();
  }

  const managedDir = libraryDb.masterFolder;
  const total = result.filePaths.length;
  let imported = 0;
  const errors: string[] = [];

  for (const sourcePath of result.filePaths) {
    const fileName = path.basename(sourcePath);
    if (mainWindow) {
      mainWindow.webContents.send('scan-progress', { current: imported, total });
    }

    try {
      // Read metadata to determine Artist/Album
      const meta = await readTrackMetadata(sourcePath);
      const artist = (meta.artist || 'Unknown Artist').replace(/[/\\:*?"<>|]/g, '_');
      const album = (meta.album || 'Unknown Album').replace(/[/\\:*?"<>|]/g, '_');

      const destDir = path.join(managedDir, artist, album);
      await fs.promises.mkdir(destDir, { recursive: true });
      const destPath = path.join(destDir, fileName);

      // Don't overwrite existing files
      try {
        await fs.promises.access(destPath);
        // File already exists, skip
      } catch {
        await fs.promises.copyFile(sourcePath, destPath);
      }

      // Read metadata for the destination file and add to DB
      const destMeta = await readTrackMetadata(destPath);
      const stats = await fs.promises.stat(destPath);
      libraryDb.tracks[destPath] = {
        ...destMeta,
        lastModified: stats.mtimeMs,
        dateAdded: new Date().toISOString(),
        rating: 0,
        playCount: 0,
        favorite: false,
        tags: [],
        comment: '',
      };
      imported++;
    } catch (err: any) {
      errors.push(`${fileName}: ${err.message}`);
    }
  }

  // Add managed dir as a library path if not already present
  if (!libraryDb.libraryPaths.includes(managedDir)) {
    libraryDb.libraryPaths.push(managedDir);
  }

  await saveLibraryDb(libraryDb);

  if (mainWindow) {
    mainWindow.webContents.send('scan-progress', { current: total, total });
  }

  return { library: dbToLibrary(libraryDb), imported, errors };
});

// Import files by paths (for drag & drop - no dialog)
ipcMain.handle('import-files-by-path', async (_event, filePaths: string[]) => {
  if (!libraryDb) {
    libraryDb = await loadLibraryDb();
  }

  const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.aac', '.m4a', '.aiff', '.aif', '.ogg', '.wma', '.dsf', '.dff', '.opus']);
  const managedDir = libraryDb.masterFolder;
  let imported = 0;
  const errors: string[] = [];

  // Separate directories and files
  const dirs: string[] = [];
  const files: string[] = [];
  for (const p of filePaths) {
    try {
      const stat = await fs.promises.stat(p);
      if (stat.isDirectory()) {
        dirs.push(p);
      } else if (AUDIO_EXTS.has(path.extname(p).toLowerCase())) {
        files.push(p);
      }
    } catch { /* skip invalid paths */ }
  }

  // Add directories as library folders
  for (const dir of dirs) {
    libraryDb = await scanFolderIntoDb(libraryDb, dir, (current, total) => {
      if (mainWindow) {
        mainWindow.webContents.send('scan-progress', { current, total });
      }
    });
  }

  // Import individual files to managed folder
  const total = files.length;
  for (const sourcePath of files) {
    const fileName = path.basename(sourcePath);
    if (mainWindow) {
      mainWindow.webContents.send('scan-progress', { current: imported, total });
    }

    try {
      const meta = await readTrackMetadata(sourcePath);
      const artist = (meta.artist || 'Unknown Artist').replace(/[/\\:*?"<>|]/g, '_');
      const album = (meta.album || 'Unknown Album').replace(/[/\\:*?"<>|]/g, '_');

      const destDir = path.join(managedDir, artist, album);
      await fs.promises.mkdir(destDir, { recursive: true });
      const destPath = path.join(destDir, fileName);

      try {
        await fs.promises.access(destPath);
      } catch {
        await fs.promises.copyFile(sourcePath, destPath);
      }

      const destMeta = await readTrackMetadata(destPath);
      const stats = await fs.promises.stat(destPath);
      libraryDb.tracks[destPath] = {
        ...destMeta,
        lastModified: stats.mtimeMs,
        dateAdded: new Date().toISOString(),
        rating: 0,
        playCount: 0,
        favorite: false,
        tags: [],
        comment: '',
      };
      imported++;
    } catch (err: any) {
      errors.push(`${fileName}: ${err.message}`);
    }
  }

  if (files.length > 0 && !libraryDb.libraryPaths.includes(managedDir)) {
    libraryDb.libraryPaths.push(managedDir);
  }

  await saveLibraryDb(libraryDb);

  if (mainWindow) {
    mainWindow.webContents.send('scan-progress', { current: total, total });
  }

  return { library: dbToLibrary(libraryDb), imported: imported + dirs.length, errors };
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
