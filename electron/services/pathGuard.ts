// Last line of defence for write destinations built from audio file tags.
//
// Tags are arbitrary strings from outside, and they end up as directory names
// (Artist/Album). sanitizePathSegment in syncDiff.ts rejects the segments that
// would escape, but every place that actually writes also verifies the final
// resolved path still sits under the directory the user asked for, so a future
// gap in the sanitizer cannot turn into a file written somewhere unexpected.

import * as path from 'path';

/** True when `candidate` resolves to something strictly inside `parentDir`. */
export function isPathInside(parentDir: string, candidate: string): boolean {
  const parent = path.resolve(parentDir);
  const child = path.resolve(candidate);
  if (child === parent) return false;
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/**
 * Throw unless `candidate` is inside `parentDir`. Callers treat the error as a
 * per-file failure so one bad tag skips one track instead of aborting the run.
 */
export function assertPathInside(parentDir: string, candidate: string): void {
  if (!isPathInside(parentDir, candidate)) {
    throw new Error(
      `refusing to write outside ${path.resolve(parentDir)}: ${path.resolve(candidate)}`
    );
  }
}

/**
 * Same check for a device-side POSIX path (MTP), where there is no local
 * directory to resolve against. `root` and `candidate` are absolute paths on
 * the device, e.g. `/MUSIC` and `/MUSIC/Artist/Album`.
 */
export function isDevicePathInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.posix.resolve(root);
  const normalizedChild = path.posix.resolve(candidate);
  if (normalizedChild === normalizedRoot) return true;
  return normalizedChild.startsWith(
    normalizedRoot.endsWith('/') ? normalizedRoot : normalizedRoot + '/'
  );
}
