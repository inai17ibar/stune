// Copy audio files into the master folder and register them in the library DB.
//
// Shared by both import entry points (the import dialog and drag & drop) so
// they behave identically. Re-importing a file that is already in the master
// folder must never clobber user-owned metadata (rating / playCount /
// favorite / tags / comment / dateAdded) — same policy as scanFolderIntoDb.

import * as fs from 'fs';
import * as path from 'path';
import { readTrackMetadata } from './metadata';
import { sanitizePathSegment } from './syncDiff';
import type { LibraryDatabase, TrackRecord } from './libraryDb';

export interface ImportResult {
  /** Files actually copied into the master folder */
  imported: number;
  /** Files that were already present at the destination */
  skipped: number;
  errors: string[];
}

/**
 * Merge freshly-read metadata into the DB entry for `destPath`, keeping any
 * custom metadata the user set on a previous import/scan.
 */
export function mergeTrackRecord(
  existing: TrackRecord | undefined,
  meta: any,
  lastModified: number
): TrackRecord {
  return {
    ...meta,
    lastModified,
    dateAdded: existing?.dateAdded || new Date().toISOString(),
    rating: existing?.rating ?? 0,
    playCount: existing?.playCount ?? 0,
    favorite: existing?.favorite ?? false,
    tags: existing?.tags ?? [],
    comment: existing?.comment ?? '',
  };
}

/**
 * Copy the given source files into `db.masterFolder` as Artist/Album/filename
 * and register them in `db.tracks` (mutates `db`).
 *
 * Files already present at the destination are not copied and not counted as
 * imported; their DB entry is refreshed but user metadata is preserved.
 */
export async function importFilesIntoDb(
  db: LibraryDatabase,
  sourcePaths: string[],
  onProgress?: (current: number, total: number) => void
): Promise<ImportResult> {
  const managedDir = db.masterFolder;
  const total = sourcePaths.length;
  let processed = 0;
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const sourcePath of sourcePaths) {
    const fileName = path.basename(sourcePath);
    onProgress?.(processed, total);

    try {
      // Read metadata to determine Artist/Album
      const meta = await readTrackMetadata(sourcePath);
      const artist = sanitizePathSegment(meta.artist || 'Unknown Artist');
      const album = sanitizePathSegment(meta.album || 'Unknown Album');

      const destDir = path.join(managedDir, artist, album);
      await fs.promises.mkdir(destDir, { recursive: true });
      const destPath = path.join(destDir, fileName);

      // Don't overwrite existing files
      let alreadyExists = true;
      try {
        await fs.promises.access(destPath);
      } catch {
        alreadyExists = false;
      }
      if (alreadyExists) {
        skipped++;
      } else {
        await fs.promises.copyFile(sourcePath, destPath);
        imported++;
      }

      // Read metadata for the destination file and add to DB,
      // preserving custom metadata of an already-known track
      const destMeta = await readTrackMetadata(destPath);
      const stats = await fs.promises.stat(destPath);
      db.tracks[destPath] = mergeTrackRecord(db.tracks[destPath], destMeta, stats.mtimeMs);
    } catch (err: any) {
      errors.push(`${fileName}: ${err.message}`);
    } finally {
      processed++;
    }
  }

  onProgress?.(total, total);

  if (total > 0 && !db.libraryPaths.includes(managedDir)) {
    db.libraryPaths.push(managedDir);
  }

  return { imported, skipped, errors };
}
