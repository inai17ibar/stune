import * as fs from 'fs';
import * as path from 'path';
import { isSupportedAudioFile } from './metadata';
import type { LibraryDatabase } from './libraryDb';

export function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Check both lexical and canonical paths; never follow a file symlink for deletion. */
export async function validateAudioDeletion(file: string, roots: string[]): Promise<void> {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.normalize(file) !== file || !isSupportedAudioFile(file)) {
    throw new Error('Invalid audio file path');
  }
  const root = roots.find((r) => path.isAbsolute(r) && isWithin(path.resolve(r), file));
  if (!root) throw new Error('File is outside the allowed folders');
  const canonicalRoot = await fs.promises.realpath(root);
  // Walk only genuinely missing components. An existing (including dangling)
  // symlink must resolve successfully and stay inside the canonical root.
  let ancestor = path.dirname(file);
  while (ancestor !== root) {
    try {
      await fs.promises.lstat(ancestor);
      break;
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  const canonicalParent = await fs.promises.realpath(ancestor);
  if (canonicalParent !== canonicalRoot && !isWithin(canonicalRoot, canonicalParent)) {
    throw new Error('File parent escapes the allowed folder');
  }
  try {
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Only regular audio files may be deleted');
    const canonicalFile = await fs.promises.realpath(file);
    if (!isWithin(canonicalRoot, canonicalFile)) throw new Error('File escapes the allowed folder');
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function deleteLibraryTracks(db: LibraryDatabase, files: unknown, fromDisk: unknown) {
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string') || typeof fromDisk !== 'boolean') {
    throw new Error('Invalid deletion request');
  }
  const errors: string[] = [];
  let deletedCount = 0;
  for (const file of new Set<string>(files)) {
    try {
      if (!Object.prototype.hasOwnProperty.call(db.tracks, file) || db.tracks[file].filePath !== file) {
        throw new Error('Track is not registered in the library');
      }
      if (fromDisk) {
        await validateAudioDeletion(file, [...db.libraryPaths, db.masterFolder]);
        try { await fs.promises.unlink(file); } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      delete db.tracks[file];
      deletedCount++;
    } catch (error: any) {
      errors.push(`${file}: ${error.message}`);
    }
  }
  return { deletedCount, errors };
}

/** MTP paths use POSIX separators regardless of the host platform. */
export function validateMtpDeletion(mount: string, file: string): string {
  let relative = file;
  if (file.startsWith('mtp://')) {
    if (!file.startsWith(mount + '/')) throw new Error('Track belongs to another MTP storage');
    relative = file.slice(mount.length);
  }
  if (!relative.startsWith('/MUSIC/') && !relative.startsWith('/Music/')) throw new Error('Track is outside MTP music folder');
  if (relative.includes('\\') || path.posix.normalize(relative) !== relative || !isSupportedAudioFile(relative)) {
    throw new Error('Invalid MTP audio path');
  }
  return relative;
}
