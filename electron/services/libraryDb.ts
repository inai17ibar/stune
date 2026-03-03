import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { readTrackMetadata, isSupportedAudioFile } from './metadata';

// ===== Types =====

export interface TrackRecord {
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
  duration: number;
  bitrate: number | undefined;
  sampleRate: number | undefined;
  format: string;
  fileSize: number;
  coverArt: string | null;
  // File tracking
  lastModified: number; // file mtime in ms
  dateAdded: string; // ISO string
  // Custom metadata
  rating: number; // 0-5
  playCount: number;
  favorite: boolean;
  tags: string[];
  comment: string;
}

export interface LibraryDatabase {
  version: number;
  libraryPaths: string[];
  lastScanned: string;
  tracks: Record<string, TrackRecord>; // keyed by filePath
}

// ===== Helpers =====

function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'sTuneLibrary.json');
}

function createEmptyDb(): LibraryDatabase {
  return {
    version: 1,
    libraryPaths: [],
    lastScanned: new Date().toISOString(),
    tracks: {},
  };
}

// ===== Core Functions =====

export async function loadLibraryDb(): Promise<LibraryDatabase> {
  const dbPath = getDbPath();
  try {
    const data = await fs.promises.readFile(dbPath, 'utf-8');
    return JSON.parse(data) as LibraryDatabase;
  } catch {
    return createEmptyDb();
  }
}

export async function saveLibraryDb(db: LibraryDatabase): Promise<void> {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  await fs.promises.mkdir(dir, { recursive: true });
  // Write to temp file then rename for atomic writes
  const tmpPath = dbPath + '.tmp';
  await fs.promises.writeFile(tmpPath, JSON.stringify(db, null, 2), 'utf-8');
  await fs.promises.rename(tmpPath, dbPath);
}

async function walkDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await walkDirectory(fullPath);
      files.push(...subFiles);
    } else if (isSupportedAudioFile(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Scan a folder and merge results into the library database.
 * Only reads metadata for new or modified files; preserves custom metadata for unchanged files.
 */
export async function scanFolderIntoDb(
  db: LibraryDatabase,
  folderPath: string,
  onProgress?: (current: number, total: number) => void
): Promise<LibraryDatabase> {
  // Add folder to library paths if not already tracked
  if (!db.libraryPaths.includes(folderPath)) {
    db.libraryPaths.push(folderPath);
  }

  const audioFiles = await walkDirectory(folderPath);
  const batchSize = 20;
  let processed = 0;

  for (let i = 0; i < audioFiles.length; i += batchSize) {
    const batch = audioFiles.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          const stats = await fs.promises.stat(filePath);
          const mtime = stats.mtimeMs;
          const existing = db.tracks[filePath];

          // Skip if file hasn't changed since last scan
          if (existing && existing.lastModified === mtime) {
            return;
          }

          // Read fresh metadata
          const meta = await readTrackMetadata(filePath);

          // Merge: preserve custom fields if the track already existed
          db.tracks[filePath] = {
            ...meta,
            lastModified: mtime,
            dateAdded: existing?.dateAdded || new Date().toISOString(),
            rating: existing?.rating ?? 0,
            playCount: existing?.playCount ?? 0,
            favorite: existing?.favorite ?? false,
            tags: existing?.tags ?? [],
            comment: existing?.comment ?? '',
          };
        } catch {
          // Skip files that can't be read
        }
      })
    );
    processed += batch.length;
    onProgress?.(Math.min(processed, audioFiles.length), audioFiles.length);
  }

  // Remove tracks that no longer exist on disk (only for this folder)
  for (const filePath of Object.keys(db.tracks)) {
    if (filePath.startsWith(folderPath)) {
      if (!audioFiles.includes(filePath)) {
        delete db.tracks[filePath];
      }
    }
  }

  db.lastScanned = new Date().toISOString();
  return db;
}

/**
 * Remove a folder from the library and delete all its tracks from the DB.
 */
export function removeFolderFromDb(
  db: LibraryDatabase,
  folderPath: string
): LibraryDatabase {
  db.libraryPaths = db.libraryPaths.filter((p) => p !== folderPath);
  for (const filePath of Object.keys(db.tracks)) {
    if (filePath.startsWith(folderPath)) {
      delete db.tracks[filePath];
    }
  }
  return db;
}

/**
 * Update custom metadata for a specific track.
 */
export function updateTrackCustomMeta(
  db: LibraryDatabase,
  filePath: string,
  updates: Partial<Pick<TrackRecord, 'rating' | 'playCount' | 'favorite' | 'tags' | 'comment'>>
): LibraryDatabase {
  const track = db.tracks[filePath];
  if (track) {
    Object.assign(track, updates);
  }
  return db;
}

/**
 * Convert the DB into the Library format expected by the frontend.
 */
export function dbToLibrary(db: LibraryDatabase) {
  const tracks = Object.values(db.tracks);

  // Group into albums
  const albumMap = new Map<string, any[]>();
  for (const track of tracks) {
    const key = `${track.albumArtist}:::${track.album}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, []);
    }
    albumMap.get(key)!.push(track);
  }

  const albums = Array.from(albumMap.entries()).map(([_key, albumTracks]) => {
    albumTracks.sort((a, b) => {
      const discA = a.discNumber || 1;
      const discB = b.discNumber || 1;
      if (discA !== discB) return discA - discB;
      return (a.trackNumber || 0) - (b.trackNumber || 0);
    });
    const first = albumTracks[0];
    return {
      name: first.album,
      artist: first.albumArtist,
      year: first.year,
      tracks: albumTracks,
      coverArt: albumTracks.find((t: any) => t.coverArt)?.coverArt || null,
    };
  });

  const totalSize = tracks.reduce((sum, t) => sum + t.fileSize, 0);

  return {
    rootPath: db.libraryPaths.join('; '),
    libraryPaths: db.libraryPaths,
    tracks,
    albums,
    totalSize,
    lastScanned: db.lastScanned,
  };
}
