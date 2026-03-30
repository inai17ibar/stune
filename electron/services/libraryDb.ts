import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
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
  coverArt: string | null; // path to cover art file (covers/<hash>.jpg) or data: URI
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
  /** マスターフォルダ: インポートした曲のコピー先。iTunes の "iTunes Media" に相当 */
  masterFolder: string;
  lastScanned: string;
  tracks: Record<string, TrackRecord>; // keyed by filePath
}

// ===== Helpers =====

function getDbDir(): string {
  return app.getPath('userData');
}

function getDbPath(): string {
  return path.join(getDbDir(), 'sTuneLibrary.json');
}

function getCoversDir(): string {
  return path.join(getDbDir(), 'covers');
}

function getDefaultMasterFolder(): string {
  return path.join(app.getPath('music'), 'sTunes');
}

function createEmptyDb(): LibraryDatabase {
  return {
    version: 1,
    libraryPaths: [],
    masterFolder: getDefaultMasterFolder(),
    lastScanned: new Date().toISOString(),
    tracks: {},
  };
}

/**
 * カバーアートの base64 データをファイルに保存し、パスを返す。
 * 既に保存済みなら既存パスを返す。
 */
async function saveCoverArt(dataUri: string): Promise<string> {
  const coversDir = getCoversDir();
  await fs.promises.mkdir(coversDir, { recursive: true });

  // data:image/jpeg;base64,... → extract
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUri; // not a data URI, return as-is

  const mimeType = match[1];
  const base64Data = match[2];
  const hash = crypto.createHash('md5').update(base64Data.slice(0, 1000)).digest('hex');
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const fileName = `${hash}.${ext}`;
  const filePath = path.join(coversDir, fileName);

  try {
    await fs.promises.access(filePath);
    // Already exists
  } catch {
    await fs.promises.writeFile(filePath, Buffer.from(base64Data, 'base64'));
  }

  return filePath;
}

/**
 * カバーアートのファイルパスを data URI に戻す（フロントエンド送信用）。
 */
function coverArtToDataUri(coverArt: string | null): string | null {
  if (!coverArt) return null;
  if (coverArt.startsWith('data:')) return coverArt;
  // File path → read and convert
  try {
    const data = fs.readFileSync(coverArt);
    const ext = path.extname(coverArt).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

// ===== Core Functions =====

/**
 * 旧アプリ名 (sTune) の DB が存在する場合はマイグレーションする。
 */
async function migrateOldDb(): Promise<void> {
  const newDbPath = getDbPath();
  try {
    await fs.promises.access(newDbPath);
    // New DB already exists, check if it has meaningful data
    const data = await fs.promises.readFile(newDbPath, 'utf-8');
    const db = JSON.parse(data) as LibraryDatabase;
    if (Object.keys(db.tracks).length > 0) return; // Has data, skip migration
  } catch {
    // New DB doesn't exist, that's fine
  }

  // Look for old DB in sibling directories
  const userDataDir = getDbDir();
  const parentDir = path.dirname(userDataDir);
  const oldCandidates = ['sTune', 'stune'];
  for (const oldName of oldCandidates) {
    const oldDbPath = path.join(parentDir, oldName, 'sTuneLibrary.json');
    try {
      await fs.promises.access(oldDbPath);
      console.log(`Migrating library DB from ${oldDbPath}`);
      await fs.promises.mkdir(path.dirname(newDbPath), { recursive: true });
      await fs.promises.copyFile(oldDbPath, newDbPath);
      // Also copy covers directory if it exists
      const oldCoversDir = path.join(parentDir, oldName, 'covers');
      const newCoversDir = getCoversDir();
      try {
        await fs.promises.access(oldCoversDir);
        await fs.promises.cp(oldCoversDir, newCoversDir, { recursive: true });
      } catch { /* no covers to migrate */ }
      return;
    } catch {
      continue;
    }
  }
}

export async function loadLibraryDb(): Promise<LibraryDatabase> {
  await migrateOldDb();
  const dbPath = getDbPath();
  try {
    const data = await fs.promises.readFile(dbPath, 'utf-8');
    const db = JSON.parse(data) as LibraryDatabase;
    // Migration: add masterFolder for existing DBs
    if (!db.masterFolder) {
      db.masterFolder = getDefaultMasterFolder();
    }
    return db;
  } catch {
    return createEmptyDb();
  }
}

export async function saveLibraryDb(db: LibraryDatabase): Promise<void> {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  await fs.promises.mkdir(dir, { recursive: true });

  // Extract cover art to files before saving to keep DB small
  for (const track of Object.values(db.tracks)) {
    if (track.coverArt && track.coverArt.startsWith('data:')) {
      track.coverArt = await saveCoverArt(track.coverArt);
    }
  }

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
          // BUT re-read if existing data is all defaults (previous failed read)
          const existingIsDefault = existing
            && existing.artist === 'Unknown Artist'
            && existing.album === 'Unknown Album';
          if (existing && existing.lastModified === mtime && !existingIsDefault) {
            return;
          }

          // Read fresh metadata
          const meta = await readTrackMetadata(filePath);

          // Don't overwrite good data with fallback "Unknown" values
          // If metadata read returned defaults AND we have existing good data, keep existing
          const isMetaDefault = meta.artist === 'Unknown Artist' && meta.album === 'Unknown Album';
          if (isMetaDefault && existing && existing.artist !== 'Unknown Artist') {
            // Keep existing metadata, just update file info
            existing.lastModified = mtime;
            existing.fileSize = meta.fileSize;
            return;
          }

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
 * Converts cover art file paths back to data URIs for display.
 */
export function dbToLibrary(db: LibraryDatabase) {
  const tracks = Object.values(db.tracks).map((t) => ({
    ...t,
    coverArt: coverArtToDataUri(t.coverArt),
  }));

  // Group into albums by albumArtist + album name
  const albumMap = new Map<string, any[]>();
  for (const track of tracks) {
    const key = `${track.albumArtist || track.artist}\0${track.album}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, []);
    }
    albumMap.get(key)!.push(track);
  }

  const albums = Array.from(albumMap.entries()).map(([_key, albumTracks]) => {
    albumTracks.sort((a: any, b: any) => {
      const discA = a.discNumber || 1;
      const discB = b.discNumber || 1;
      if (discA !== discB) return discA - discB;
      return (a.trackNumber || 0) - (b.trackNumber || 0);
    });
    const first = albumTracks[0];
    // Use albumArtist if consistent, otherwise "Various Artists"
    const artists = new Set(albumTracks.map((t: any) => t.albumArtist));
    const albumArtist = artists.size === 1 ? first.albumArtist : 'Various Artists';
    return {
      name: first.album,
      artist: albumArtist,
      year: first.year,
      tracks: albumTracks,
      coverArt: albumTracks.find((t: any) => t.coverArt)?.coverArt || null,
    };
  });

  const totalSize = tracks.reduce((sum, t) => sum + t.fileSize, 0);

  return {
    rootPath: db.libraryPaths.join('; '),
    libraryPaths: db.libraryPaths,
    masterFolder: db.masterFolder,
    tracks,
    albums,
    totalSize,
    lastScanned: db.lastScanned,
  };
}
