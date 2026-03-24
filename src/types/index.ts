export interface TrackMetadata {
  filePath: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  year: number | undefined;
  trackNumber: number | undefined;
  discNumber: number | undefined;
  genre: string;
  duration: number; // seconds
  bitrate: number | undefined;
  sampleRate: number | undefined;
  format: string;
  fileSize: number; // bytes
  coverArt: string | null; // base64 data URI
  // Custom metadata (persisted in library DB)
  dateAdded?: string;
  lastModified?: number;
  rating?: number; // 0-5
  playCount?: number;
  favorite?: boolean;
  tags?: string[];
  comment?: string;
}

export interface Album {
  name: string;
  artist: string;
  year: number | undefined;
  tracks: TrackMetadata[];
  coverArt: string | null;
}

export interface Library {
  rootPath: string;
  libraryPaths?: string[];
  tracks: TrackMetadata[];
  albums: Album[];
  totalSize: number;
  lastScanned: string;
}

export interface WalkmanDevice {
  name: string;
  mountPath: string;
  musicPath: string;
  totalSpace: number;
  usedSpace: number;
  freeSpace: number;
  tracks: TrackMetadata[];
  albums: Album[];
}

export interface DiskUsageSegment {
  label: string;
  size: number;
  color: string;
  type: 'music' | 'other' | 'free';
}

export interface TransferJob {
  id: string;
  source: string;
  destination: string;
  tracks: TrackMetadata[];
  progress: number; // 0-100
  currentFile: string;
  status: 'pending' | 'transferring' | 'completed' | 'error';
  error?: string;
}

export type ViewMode = 'library' | 'device' | 'albums' | 'artists';
export type SortKey = 'title' | 'artist' | 'album' | 'duration' | 'year';
export type SortOrder = 'asc' | 'desc';
