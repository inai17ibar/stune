interface STuneAPI {
  selectLibraryFolder: () => Promise<string | null>;
  scanLibrary: (folderPath: string) => Promise<any>;

  // Library DB (persistent JSON storage)
  loadLibraryDb: () => Promise<any | null>;
  addLibraryFolder: (folderPath: string) => Promise<any>;
  rescanLibrary: () => Promise<any>;
  removeLibraryFolder: (folderPath: string) => Promise<any>;
  updateTrackMeta: (
    filePath: string,
    updates: Partial<{
      rating: number;
      playCount: number;
      favorite: boolean;
      tags: string[];
      comment: string;
    }>
  ) => Promise<any>;
  getLibraryDbPath: () => Promise<string>;

  // Device
  getDevices: () => Promise<any[]>;
  isMtpCliAvailable: () => Promise<boolean>;
  scanDevice: (mountPath: string) => Promise<any>;
  getDiskUsage: (mountPath: string) => Promise<any>;

  // MTP Browse & Playback
  mtpBrowse: (storageId: string, path: string) => Promise<any[]>;
  mtpDownloadFile: (storageId: string, remotePath: string) => Promise<string | null>;
  mtpGetDevices: () => Promise<any[]>;

  // Import
  importToLibrary: () => Promise<{ library: any; imported: number; errors: string[] } | null>;
  importFilesByPath: (filePaths: string[]) => Promise<{ library: any; imported: number; errors: string[] }>;

  // Transfer
  copyTracks: (
    sourcePaths: string[],
    destinationDir: string
  ) => Promise<{ success: boolean; copiedCount: number; errors: string[] }>;
  copyTracksStructured: (
    sourcePaths: string[],
    deviceMountPath: string
  ) => Promise<{ success: boolean; copiedCount: number; errors: string[] }>;
  deleteTracks: (
    filePaths: string[]
  ) => Promise<{ path: string; success: boolean; error?: string }[]>;

  // Metadata
  readMetadata: (filePath: string) => Promise<any>;

  // Utilities
  showInFinder: (filePath: string) => Promise<void>;

  // Event listeners
  onDevicesChanged: (callback: (devices: any[]) => void) => () => void;
  onTransferProgress: (callback: (progress: any) => void) => () => void;
  onScanProgress: (
    callback: (progress: { current: number; total: number }) => void
  ) => () => void;
}

interface Window {
  stune: STuneAPI;
}
