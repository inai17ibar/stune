import * as fs from 'fs';
import * as path from 'path';
import { readTrackMetadata, isSupportedAudioFile } from './metadata';

async function walkDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files/folders
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

function groupIntoAlbums(tracks: any[]): any[] {
  const albumMap = new Map<string, any[]>();

  for (const track of tracks) {
    const key = `${track.albumArtist}:::${track.album}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, []);
    }
    albumMap.get(key)!.push(track);
  }

  return Array.from(albumMap.entries()).map(([_key, albumTracks]) => {
    // Sort tracks by disc number then track number
    albumTracks.sort((a: any, b: any) => {
      const discA = a.discNumber || 1;
      const discB = b.discNumber || 1;
      if (discA !== discB) return discA - discB;
      return (a.trackNumber || 0) - (b.trackNumber || 0);
    });

    const firstTrack = albumTracks[0];
    return {
      name: firstTrack.album,
      artist: firstTrack.albumArtist,
      year: firstTrack.year,
      tracks: albumTracks,
      coverArt: albumTracks.find((t: any) => t.coverArt)?.coverArt || null,
    };
  });
}

export async function scanLibrary(folderPath: string): Promise<any> {
  const audioFiles = await walkDirectory(folderPath);

  // Process files in batches to avoid memory pressure
  const batchSize = 20;
  const tracks: any[] = [];

  for (let i = 0; i < audioFiles.length; i += batchSize) {
    const batch = audioFiles.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((f) => readTrackMetadata(f))
    );
    tracks.push(...batchResults);
  }

  const albums = groupIntoAlbums(tracks);
  const totalSize = tracks.reduce((sum, t) => sum + t.fileSize, 0);

  return {
    rootPath: folderPath,
    tracks,
    albums,
    totalSize,
    lastScanned: new Date().toISOString(),
  };
}

export async function scanDevice(mountPath: string): Promise<any> {
  // NW-A300 stores music in MUSIC folder
  const possiblePaths = [
    path.join(mountPath, 'MUSIC'),
    path.join(mountPath, 'Music'),
    path.join(mountPath, 'music'),
    mountPath,
  ];

  let musicPath = mountPath;
  for (const p of possiblePaths) {
    try {
      await fs.promises.access(p);
      musicPath = p;
      break;
    } catch {
      continue;
    }
  }

  const library = await scanLibrary(musicPath);

  // Get disk usage
  let totalSpace = 0;
  let freeSpace = 0;
  try {
    const stats = await fs.promises.statfs(mountPath);
    totalSpace = stats.bsize * stats.blocks;
    freeSpace = stats.bsize * stats.bfree;
  } catch {
    // Disk stats not available
  }

  return {
    name: path.basename(mountPath),
    mountPath,
    musicPath,
    totalSpace,
    usedSpace: totalSpace - freeSpace,
    freeSpace,
    tracks: library.tracks,
    albums: library.albums,
  };
}
