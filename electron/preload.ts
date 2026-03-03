import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('stune', {
  // Library
  selectLibraryFolder: () => ipcRenderer.invoke('select-library-folder'),
  scanLibrary: (folderPath: string) =>
    ipcRenderer.invoke('scan-library', folderPath),

  // Device
  getDevices: () => ipcRenderer.invoke('get-devices'),
  scanDevice: (mountPath: string) =>
    ipcRenderer.invoke('scan-device', mountPath),
  getDiskUsage: (mountPath: string) =>
    ipcRenderer.invoke('get-disk-usage', mountPath),

  // Transfer
  copyTracks: (sourcePaths: string[], destinationDir: string) =>
    ipcRenderer.invoke('copy-tracks', { sourcePaths, destinationDir }),
  deleteTracks: (filePaths: string[]) =>
    ipcRenderer.invoke('delete-tracks', filePaths),

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
});
