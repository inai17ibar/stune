interface STuneAPI {
  selectLibraryFolder: () => Promise<string | null>;
  scanLibrary: (folderPath: string) => Promise<any>;
  getDevices: () => Promise<any[]>;
  scanDevice: (mountPath: string) => Promise<any>;
  getDiskUsage: (mountPath: string) => Promise<any>;
  copyTracks: (
    sourcePaths: string[],
    destinationDir: string
  ) => Promise<{ success: boolean; copiedCount: number; errors: string[] }>;
  deleteTracks: (
    filePaths: string[]
  ) => Promise<{ path: string; success: boolean; error?: string }[]>;
  readMetadata: (filePath: string) => Promise<any>;
  showInFinder: (filePath: string) => Promise<void>;
  onDevicesChanged: (callback: (devices: any[]) => void) => () => void;
  onTransferProgress: (callback: (progress: any) => void) => () => void;
}

interface Window {
  stune: STuneAPI;
}
