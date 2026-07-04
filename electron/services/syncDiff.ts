// Pure diff logic between the local library and a device (USB or MTP).
// No filesystem access — operates on already-scanned track lists.
//
// Matching is path-first: the expected device path is derived from the same
// naming rules as copy-tracks-structured (sanitized Artist/Album segments,
// track-number-prefixed filename), so anything sTunes transferred is found
// by path alone. MTP scans have no tag metadata, so this is the only
// reliable signal there. A tag-based fallback pass catches files placed on
// USB-mounted devices by other tools.

export interface SyncTrack {
  filePath: string;
  fileName: string;
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  discNumber?: number;
  fileSize?: number;
}

export interface SyncPlan<L extends SyncTrack = SyncTrack, D extends SyncTrack = SyncTrack> {
  /** Library tracks with no counterpart on the device */
  toTransfer: L[];
  /** Device tracks with no counterpart in the library */
  toDelete: D[];
  /** Pairs found on both sides */
  matched: Array<{ library: L; device: D }>;
}

export function sanitizePathSegment(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * Filename a track gets when transferred to the device: prefixed with the
 * track number (and disc number when disc > 1) unless already numbered.
 */
export function buildTransferFileName(track: SyncTrack): string {
  const disc = track.discNumber || 1;
  const trackNum = track.trackNumber || 0;
  const prefix =
    trackNum > 0
      ? disc > 1
        ? `${disc}-${String(trackNum).padStart(2, '0')}`
        : String(trackNum).padStart(2, '0')
      : '';
  const alreadyPrefixed = prefix && track.fileName.match(/^\d+[-.\s]/);
  return !alreadyPrefixed && prefix ? `${prefix} ${track.fileName}` : track.fileName;
}

/**
 * Path (relative to the device MUSIC folder) where a library track is
 * expected to live after a structured transfer.
 */
export function buildExpectedDevicePath(track: SyncTrack): string {
  const artist = sanitizePathSegment(track.artist || 'Unknown Artist');
  const album = sanitizePathSegment(track.album || 'Unknown Album');
  return `${artist}/${album}/${buildTransferFileName(track)}`;
}

/**
 * Extract the path of a device file relative to its MUSIC folder.
 * Handles both USB mounts (/Volumes/WALKMAN/MUSIC/...) and MTP paths
 * (mtp://<storageId>/MUSIC/...). Pass musicRoot when the device stores
 * music outside a MUSIC folder. Returns null when no root can be found.
 */
export function getDeviceRelativePath(filePath: string, musicRoot?: string): string | null {
  if (musicRoot) {
    const root = musicRoot.endsWith('/') ? musicRoot : musicRoot + '/';
    if (filePath.startsWith(root)) return filePath.slice(root.length);
  }
  const match = filePath.match(/\/MUSIC\//i);
  if (match && match.index !== undefined) {
    return filePath.slice(match.index + match[0].length);
  }
  return null;
}

function normalizeKey(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

function tagKey(track: SyncTrack): string | null {
  const title = track.title?.trim();
  const artist = track.artist?.trim();
  const album = track.album?.trim();
  if (!title || !artist || !album) return null;
  return normalizeKey(`${artist}|||${album}|||${title}`);
}

export function computeSyncPlan<L extends SyncTrack, D extends SyncTrack>(
  libraryTracks: L[],
  deviceTracks: D[],
  options?: { musicRoot?: string }
): SyncPlan<L, D> {
  const matched: Array<{ library: L; device: D }> = [];
  const unmatchedDevice = new Set(deviceTracks);

  // Index device tracks by their MUSIC-relative path
  const deviceByPath = new Map<string, D>();
  for (const dev of deviceTracks) {
    const rel = getDeviceRelativePath(dev.filePath, options?.musicRoot);
    if (rel !== null && !deviceByPath.has(normalizeKey(rel))) {
      deviceByPath.set(normalizeKey(rel), dev);
    }
  }

  // Pass 1: match by expected transfer path (prefixed and legacy unprefixed)
  const unmatchedLibrary: L[] = [];
  for (const lib of libraryTracks) {
    const artist = sanitizePathSegment(lib.artist || 'Unknown Artist');
    const album = sanitizePathSegment(lib.album || 'Unknown Album');
    const candidates = [
      buildExpectedDevicePath(lib),
      `${artist}/${album}/${lib.fileName}`,
    ];
    let found: D | undefined;
    for (const candidate of candidates) {
      const dev = deviceByPath.get(normalizeKey(candidate));
      if (dev && unmatchedDevice.has(dev)) {
        found = dev;
        break;
      }
    }
    if (found) {
      matched.push({ library: lib, device: found });
      unmatchedDevice.delete(found);
    } else {
      unmatchedLibrary.push(lib);
    }
  }

  // Pass 2: tag-based fallback for device tracks with readable metadata
  const deviceByTag = new Map<string, D[]>();
  for (const dev of unmatchedDevice) {
    const key = tagKey(dev);
    if (!key) continue;
    const list = deviceByTag.get(key);
    if (list) list.push(dev);
    else deviceByTag.set(key, [dev]);
  }

  const toTransfer: L[] = [];
  for (const lib of unmatchedLibrary) {
    const key = tagKey(lib);
    const list = key ? deviceByTag.get(key) : undefined;
    const dev = list?.shift();
    if (dev) {
      matched.push({ library: lib, device: dev });
      unmatchedDevice.delete(dev);
    } else {
      toTransfer.push(lib);
    }
  }

  return { toTransfer, toDelete: Array.from(unmatchedDevice), matched };
}
