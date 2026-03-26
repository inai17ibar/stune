import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('stune', {
  // Library
  selectLibraryFolder: () => ipcRenderer.invoke('select-library-folder'),
  scanLibrary: (folderPath: string) =>
    ipcRenderer.invoke('scan-library', folderPath),

  // Library DB (persistent JSON storage)
  loadLibraryDb: () => ipcRenderer.invoke('load-library-db'),
  addLibraryFolder: (folderPath: string) =>
    ipcRenderer.invoke('add-library-folder', folderPath),
  rescanLibrary: () => ipcRenderer.invoke('rescan-library'),
  removeLibraryFolder: (folderPath: string) =>
    ipcRenderer.invoke('remove-library-folder', folderPath),
  updateTrackMeta: (
    filePath: string,
    updates: Partial<{
      rating: number;
      playCount: number;
      favorite: boolean;
      tags: string[];
      comment: string;
    }>
  ) => ipcRenderer.invoke('update-track-meta', { filePath, updates }),
  getLibraryDbPath: () => ipcRenderer.invoke('get-library-db-path'),

  // Device
  getDevices: () => ipcRenderer.invoke('get-devices'),
  isMtpCliAvailable: () => ipcRenderer.invoke('is-mtp-cli-available'),
  scanDevice: (mountPath: string) =>
    ipcRenderer.invoke('scan-device', mountPath),
  getDiskUsage: (mountPath: string) =>
    ipcRenderer.invoke('get-disk-usage', mountPath),

  // MTP Browse & Playback
  mtpBrowse: (storageId: string, path: string) =>
    ipcRenderer.invoke('mtp-browse', { storageId, path }),
  mtpDownloadFile: (storageId: string, remotePath: string) =>
    ipcRenderer.invoke('mtp-download-file', { storageId, remotePath }),
  mtpGetDevices: () => ipcRenderer.invoke('mtp-get-devices'),

  // Import
  importToLibrary: () => ipcRenderer.invoke('import-to-library'),
  importFilesByPath: (filePaths: string[]) =>
    ipcRenderer.invoke('import-files-by-path', filePaths),

  // Transfer
  copyTracks: (sourcePaths: string[], destinationDir: string) =>
    ipcRenderer.invoke('copy-tracks', { sourcePaths, destinationDir }),
  copyTracksStructured: (sourcePaths: string[], deviceMountPath: string) =>
    ipcRenderer.invoke('copy-tracks-structured', { sourcePaths, deviceMountPath }),
  deleteTracks: (filePaths: string[]) =>
    ipcRenderer.invoke('delete-tracks', filePaths),
  deleteLibraryTracks: (filePaths: string[], fromDisk: boolean) =>
    ipcRenderer.invoke('delete-library-tracks', { filePaths, fromDisk }),
  deleteDeviceTracks: (mountPath: string, filePaths: string[]) =>
    ipcRenderer.invoke('delete-device-tracks', { mountPath, filePaths }),

  // Metadata
  readMetadata: (filePath: string) =>
    ipcRenderer.invoke('read-metadata', filePath),

  // Utilities
  showInFinder: (filePath: string) =>
    ipcRenderer.invoke('show-in-finder', filePath),

  // Event listeners
  onDevicesChanged: (callback: (devices: any[]) => void) => {
    const handler = (_event: any, devices: any[]) => callback(devices);
    ipcRenderer.on('devices-changed', handler);
    return () => ipcRenderer.removeListener('devices-changed', handler);
  },
  onTransferProgress: (callback: (progress: any) => void) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on('transfer-progress', handler);
    return () => ipcRenderer.removeListener('transfer-progress', handler);
  },
  onScanProgress: (
    callback: (progress: { current: number; total: number }) => void
  ) => {
    const handler = (
      _event: any,
      progress: { current: number; total: number }
    ) => callback(progress);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.removeListener('scan-progress', handler);
  },
});
