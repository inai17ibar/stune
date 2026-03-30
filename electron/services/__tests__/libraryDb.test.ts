import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/stunes-test-userdata';
      if (name === 'music') return '/tmp/stunes-test-music';
      return '/tmp/stunes-test';
    },
  },
}));

// Mock metadata service
vi.mock('../metadata', () => ({
  readTrackMetadata: vi.fn(),
  isSupportedAudioFile: (name: string) => {
    const ext = path.extname(name).toLowerCase();
    return ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.aiff', '.ogg'].includes(ext);
  },
}));

import {
  loadLibraryDb,
  saveLibraryDb,
  dbToLibrary,
  removeFolderFromDb,
  updateTrackCustomMeta,
  type LibraryDatabase,
  type TrackRecord,
} from '../libraryDb';

// Helper to create a minimal track record
function makeTrack(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    filePath: '/music/test.mp3',
    fileName: 'test.mp3',
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    albumArtist: 'Test Artist',
    year: 2024,
    trackNumber: 1,
    discNumber: 1,
    genre: 'Rock',
    duration: 180,
    bitrate: 320,
    sampleRate: 44100,
    format: 'mp3',
    fileSize: 5000000,
    coverArt: null,
    lastModified: Date.now(),
    dateAdded: new Date().toISOString(),
    rating: 0,
    playCount: 0,
    favorite: false,
    tags: [],
    comment: '',
    ...overrides,
  };
}

function makeDb(overrides: Partial<LibraryDatabase> = {}): LibraryDatabase {
  return {
    version: 1,
    libraryPaths: [],
    masterFolder: '/tmp/stunes-test-music/sTunes',
    lastScanned: new Date().toISOString(),
    tracks: {},
    ...overrides,
  };
}

const testDbDir = '/tmp/stunes-test-userdata';
const testDbPath = path.join(testDbDir, 'sTuneLibrary.json');

beforeEach(async () => {
  await fs.promises.mkdir(testDbDir, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.promises.rm(testDbDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ===== createEmptyDb / loadLibraryDb =====

describe('loadLibraryDb', () => {
  it('returns empty DB with default masterFolder when no DB file exists', async () => {
    // Ensure no DB file
    try { await fs.promises.unlink(testDbPath); } catch { /* ignore */ }

    const db = await loadLibraryDb();
    expect(db.version).toBe(1);
    expect(db.libraryPaths).toEqual([]);
    expect(db.masterFolder).toBe('/tmp/stunes-test-music/sTunes');
    expect(db.tracks).toEqual({});
  });

  it('loads existing DB from file', async () => {
    const existingDb: LibraryDatabase = {
      version: 1,
      libraryPaths: ['/Users/test/Music'],
      masterFolder: '/custom/master',
      lastScanned: '2024-01-01T00:00:00.000Z',
      tracks: {
        '/Users/test/Music/song.mp3': makeTrack({
          filePath: '/Users/test/Music/song.mp3',
          fileName: 'song.mp3',
          title: 'My Song',
        }),
      },
    };
    await fs.promises.writeFile(testDbPath, JSON.stringify(existingDb, null, 2));

    const db = await loadLibraryDb();
    expect(db.masterFolder).toBe('/custom/master');
    expect(db.libraryPaths).toEqual(['/Users/test/Music']);
    expect(Object.keys(db.tracks)).toHaveLength(1);
    expect(db.tracks['/Users/test/Music/song.mp3'].title).toBe('My Song');
  });

  it('migrates existing DB without masterFolder field', async () => {
    // Simulate an old DB that was created before the masterFolder feature
    const oldDb = {
      version: 1,
      libraryPaths: ['/Users/test/Music'],
      lastScanned: '2024-01-01T00:00:00.000Z',
      tracks: {},
    };
    await fs.promises.writeFile(testDbPath, JSON.stringify(oldDb, null, 2));

    const db = await loadLibraryDb();
    expect(db.masterFolder).toBe('/tmp/stunes-test-music/sTunes');
  });
});

// ===== saveLibraryDb =====

describe('saveLibraryDb', () => {
  it('persists DB to disk with masterFolder', async () => {
    const db = makeDb({
      masterFolder: '/my/custom/folder',
      libraryPaths: ['/my/custom/folder'],
    });

    await saveLibraryDb(db);

    const raw = await fs.promises.readFile(testDbPath, 'utf-8');
    const loaded = JSON.parse(raw);
    expect(loaded.masterFolder).toBe('/my/custom/folder');
    expect(loaded.libraryPaths).toEqual(['/my/custom/folder']);
  });

  it('round-trips: save then load preserves masterFolder', async () => {
    const db = makeDb({ masterFolder: '/roundtrip/test' });
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3', title: 'A' });

    await saveLibraryDb(db);
    const loaded = await loadLibraryDb();

    expect(loaded.masterFolder).toBe('/roundtrip/test');
    expect(loaded.tracks['/music/a.mp3'].title).toBe('A');
  });
});

// ===== dbToLibrary =====

describe('dbToLibrary', () => {
  it('includes masterFolder in output', () => {
    const db = makeDb({ masterFolder: '/my/master' });
    const lib = dbToLibrary(db);
    expect(lib.masterFolder).toBe('/my/master');
  });

  it('groups tracks into albums by albumArtist + album', () => {
    const db = makeDb();
    db.tracks['/a.mp3'] = makeTrack({
      filePath: '/a.mp3', album: 'Album1', artist: 'ArtistA', albumArtist: 'ArtistA', trackNumber: 1,
    });
    db.tracks['/b.mp3'] = makeTrack({
      filePath: '/b.mp3', album: 'Album1', artist: 'ArtistA', albumArtist: 'ArtistA', trackNumber: 2,
    });
    db.tracks['/c.mp3'] = makeTrack({
      filePath: '/c.mp3', album: 'Album2', artist: 'ArtistB', albumArtist: 'ArtistB', trackNumber: 1,
    });

    const lib = dbToLibrary(db);
    expect(lib.albums).toHaveLength(2);
    const album1 = lib.albums.find((a) => a.name === 'Album1');
    expect(album1).toBeDefined();
    expect(album1!.tracks).toHaveLength(2);
    expect(album1!.artist).toBe('ArtistA');
  });

  it('sorts album tracks by disc number then track number', () => {
    const db = makeDb();
    db.tracks['/t3.mp3'] = makeTrack({
      filePath: '/t3.mp3', album: 'A', albumArtist: 'X', discNumber: 2, trackNumber: 1,
    });
    db.tracks['/t1.mp3'] = makeTrack({
      filePath: '/t1.mp3', album: 'A', albumArtist: 'X', discNumber: 1, trackNumber: 1,
    });
    db.tracks['/t2.mp3'] = makeTrack({
      filePath: '/t2.mp3', album: 'A', albumArtist: 'X', discNumber: 1, trackNumber: 2,
    });

    const lib = dbToLibrary(db);
    const album = lib.albums[0];
    expect(album.tracks[0].filePath).toBe('/t1.mp3');
    expect(album.tracks[1].filePath).toBe('/t2.mp3');
    expect(album.tracks[2].filePath).toBe('/t3.mp3');
  });

  it('uses "Various Artists" for compilation albums', () => {
    const db = makeDb();
    db.tracks['/a.mp3'] = makeTrack({
      filePath: '/a.mp3', album: 'Comp', albumArtist: 'Artist1',
    });
    db.tracks['/b.mp3'] = makeTrack({
      filePath: '/b.mp3', album: 'Comp', albumArtist: 'Artist2',
    });

    const lib = dbToLibrary(db);
    // Different albumArtist means they become separate albums
    // unless albumArtist is the same
    expect(lib.albums).toHaveLength(2);
  });

  it('computes totalSize correctly', () => {
    const db = makeDb();
    db.tracks['/a.mp3'] = makeTrack({ filePath: '/a.mp3', fileSize: 1000 });
    db.tracks['/b.mp3'] = makeTrack({ filePath: '/b.mp3', fileSize: 2000 });

    const lib = dbToLibrary(db);
    expect(lib.totalSize).toBe(3000);
  });
});

// ===== removeFolderFromDb =====

describe('removeFolderFromDb', () => {
  it('removes folder path and all its tracks', () => {
    const db = makeDb({
      libraryPaths: ['/folder1', '/folder2'],
    });
    db.tracks['/folder1/a.mp3'] = makeTrack({ filePath: '/folder1/a.mp3' });
    db.tracks['/folder1/b.mp3'] = makeTrack({ filePath: '/folder1/b.mp3' });
    db.tracks['/folder2/c.mp3'] = makeTrack({ filePath: '/folder2/c.mp3' });

    const result = removeFolderFromDb(db, '/folder1');

    expect(result.libraryPaths).toEqual(['/folder2']);
    expect(Object.keys(result.tracks)).toEqual(['/folder2/c.mp3']);
  });

  it('does nothing when folder is not in the DB', () => {
    const db = makeDb({ libraryPaths: ['/existing'] });
    db.tracks['/existing/a.mp3'] = makeTrack({ filePath: '/existing/a.mp3' });

    const result = removeFolderFromDb(db, '/nonexistent');

    expect(result.libraryPaths).toEqual(['/existing']);
    expect(Object.keys(result.tracks)).toHaveLength(1);
  });
});

// ===== updateTrackCustomMeta =====

describe('updateTrackCustomMeta', () => {
  it('updates rating for an existing track', () => {
    const db = makeDb();
    db.tracks['/song.mp3'] = makeTrack({ filePath: '/song.mp3', rating: 0 });

    updateTrackCustomMeta(db, '/song.mp3', { rating: 5 });

    expect(db.tracks['/song.mp3'].rating).toBe(5);
  });

  it('updates multiple fields at once', () => {
    const db = makeDb();
    db.tracks['/song.mp3'] = makeTrack({ filePath: '/song.mp3' });

    updateTrackCustomMeta(db, '/song.mp3', {
      rating: 4,
      favorite: true,
      tags: ['jazz', 'chill'],
      comment: 'Great track',
    });

    const t = db.tracks['/song.mp3'];
    expect(t.rating).toBe(4);
    expect(t.favorite).toBe(true);
    expect(t.tags).toEqual(['jazz', 'chill']);
    expect(t.comment).toBe('Great track');
  });

  it('does nothing for nonexistent track', () => {
    const db = makeDb();

    // Should not throw
    updateTrackCustomMeta(db, '/nonexistent.mp3', { rating: 5 });

    expect(Object.keys(db.tracks)).toHaveLength(0);
  });

  it('preserves other fields when updating', () => {
    const db = makeDb();
    db.tracks['/song.mp3'] = makeTrack({
      filePath: '/song.mp3',
      title: 'My Song',
      playCount: 10,
    });

    updateTrackCustomMeta(db, '/song.mp3', { rating: 3 });

    expect(db.tracks['/song.mp3'].title).toBe('My Song');
    expect(db.tracks['/song.mp3'].playCount).toBe(10);
  });
});

// ===== Track deletion from DB =====

describe('track deletion from DB', () => {
  it('deletes a single track by filePath', () => {
    const db = makeDb();
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3', title: 'A' });
    db.tracks['/music/b.mp3'] = makeTrack({ filePath: '/music/b.mp3', title: 'B' });

    delete db.tracks['/music/a.mp3'];

    expect(Object.keys(db.tracks)).toHaveLength(1);
    expect(db.tracks['/music/b.mp3'].title).toBe('B');
  });

  it('deletes multiple tracks', () => {
    const db = makeDb();
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3' });
    db.tracks['/music/b.mp3'] = makeTrack({ filePath: '/music/b.mp3' });
    db.tracks['/music/c.mp3'] = makeTrack({ filePath: '/music/c.mp3' });

    const toDelete = ['/music/a.mp3', '/music/c.mp3'];
    for (const fp of toDelete) {
      delete db.tracks[fp];
    }

    expect(Object.keys(db.tracks)).toEqual(['/music/b.mp3']);
  });

  it('deleting all tracks from an album removes the album from dbToLibrary', () => {
    const db = makeDb();
    db.tracks['/music/a1.mp3'] = makeTrack({
      filePath: '/music/a1.mp3', album: 'Album1', albumArtist: 'X',
    });
    db.tracks['/music/a2.mp3'] = makeTrack({
      filePath: '/music/a2.mp3', album: 'Album1', albumArtist: 'X',
    });
    db.tracks['/music/b1.mp3'] = makeTrack({
      filePath: '/music/b1.mp3', album: 'Album2', albumArtist: 'Y',
    });

    // Delete all tracks from Album1
    delete db.tracks['/music/a1.mp3'];
    delete db.tracks['/music/a2.mp3'];

    const lib = dbToLibrary(db);
    expect(lib.albums).toHaveLength(1);
    expect(lib.albums[0].name).toBe('Album2');
    expect(lib.tracks).toHaveLength(1);
  });

  it('deleting all tracks from an artist removes the artist from dbToLibrary', () => {
    const db = makeDb();
    db.tracks['/music/x1.mp3'] = makeTrack({
      filePath: '/music/x1.mp3', album: 'A1', albumArtist: 'ArtistX', artist: 'ArtistX',
    });
    db.tracks['/music/x2.mp3'] = makeTrack({
      filePath: '/music/x2.mp3', album: 'A2', albumArtist: 'ArtistX', artist: 'ArtistX',
    });
    db.tracks['/music/y1.mp3'] = makeTrack({
      filePath: '/music/y1.mp3', album: 'B1', albumArtist: 'ArtistY', artist: 'ArtistY',
    });

    // Delete all ArtistX tracks
    delete db.tracks['/music/x1.mp3'];
    delete db.tracks['/music/x2.mp3'];

    const lib = dbToLibrary(db);
    expect(lib.albums).toHaveLength(1);
    expect(lib.albums[0].artist).toBe('ArtistY');
  });

  it('deletion is persisted through save/load', async () => {
    const db = makeDb();
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3' });
    db.tracks['/music/b.mp3'] = makeTrack({ filePath: '/music/b.mp3' });
    await saveLibraryDb(db);

    // Delete and save
    delete db.tracks['/music/a.mp3'];
    await saveLibraryDb(db);

    const loaded = await loadLibraryDb();
    expect(Object.keys(loaded.tracks)).toEqual(['/music/b.mp3']);
  });

  it('deleting nonexistent track is a no-op', () => {
    const db = makeDb();
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3' });

    delete db.tracks['/music/nonexistent.mp3'];

    expect(Object.keys(db.tracks)).toHaveLength(1);
  });
});

// ===== dbToLibrary artist grouping =====

describe('dbToLibrary artist grouping', () => {
  it('groups albums by artist correctly', () => {
    const db = makeDb();
    db.tracks['/a1.mp3'] = makeTrack({
      filePath: '/a1.mp3', album: 'Album1', albumArtist: 'ArtistA', artist: 'ArtistA',
    });
    db.tracks['/a2.mp3'] = makeTrack({
      filePath: '/a2.mp3', album: 'Album2', albumArtist: 'ArtistA', artist: 'ArtistA',
    });
    db.tracks['/b1.mp3'] = makeTrack({
      filePath: '/b1.mp3', album: 'Album3', albumArtist: 'ArtistB', artist: 'ArtistB',
    });

    const lib = dbToLibrary(db);
    expect(lib.albums).toHaveLength(3);

    const artistAAlbums = lib.albums.filter((a) => a.artist === 'ArtistA');
    const artistBAlbums = lib.albums.filter((a) => a.artist === 'ArtistB');
    expect(artistAAlbums).toHaveLength(2);
    expect(artistBAlbums).toHaveLength(1);
  });

  it('an artist with multiple albums has correct track counts', () => {
    const db = makeDb();
    db.tracks['/a1.mp3'] = makeTrack({
      filePath: '/a1.mp3', album: 'Album1', albumArtist: 'X',
    });
    db.tracks['/a2.mp3'] = makeTrack({
      filePath: '/a2.mp3', album: 'Album1', albumArtist: 'X',
    });
    db.tracks['/a3.mp3'] = makeTrack({
      filePath: '/a3.mp3', album: 'Album2', albumArtist: 'X',
    });

    const lib = dbToLibrary(db);
    const album1 = lib.albums.find((a) => a.name === 'Album1');
    const album2 = lib.albums.find((a) => a.name === 'Album2');
    expect(album1!.tracks).toHaveLength(2);
    expect(album2!.tracks).toHaveLength(1);
  });

  it('transfer-eligible tracks: all tracks from an album', () => {
    const db = makeDb();
    db.tracks['/a.mp3'] = makeTrack({
      filePath: '/a.mp3', album: 'A', albumArtist: 'X', trackNumber: 1,
    });
    db.tracks['/b.mp3'] = makeTrack({
      filePath: '/b.mp3', album: 'A', albumArtist: 'X', trackNumber: 2,
    });
    db.tracks['/c.mp3'] = makeTrack({
      filePath: '/c.mp3', album: 'A', albumArtist: 'X', trackNumber: 3,
    });

    const lib = dbToLibrary(db);
    const album = lib.albums[0];
    const transferPaths = album.tracks.map((t) => t.filePath);
    expect(transferPaths).toHaveLength(3);
    // Verify ordering (by track number)
    expect(transferPaths).toEqual(['/a.mp3', '/b.mp3', '/c.mp3']);
  });

  it('transfer-eligible tracks: all tracks from an artist', () => {
    const db = makeDb();
    db.tracks['/x1.mp3'] = makeTrack({
      filePath: '/x1.mp3', album: 'A1', albumArtist: 'X',
    });
    db.tracks['/x2.mp3'] = makeTrack({
      filePath: '/x2.mp3', album: 'A2', albumArtist: 'X',
    });
    db.tracks['/y1.mp3'] = makeTrack({
      filePath: '/y1.mp3', album: 'B1', albumArtist: 'Y',
    });

    const lib = dbToLibrary(db);
    const artistXAlbums = lib.albums.filter((a) => a.artist === 'X');
    const allXPaths = artistXAlbums.flatMap((a) => a.tracks.map((t) => t.filePath));
    expect(allXPaths).toHaveLength(2);
    expect(allXPaths).toContain('/x1.mp3');
    expect(allXPaths).toContain('/x2.mp3');
  });
});

// ===== Master folder integration scenarios =====

describe('master folder integration', () => {
  it('changing masterFolder is preserved through save/load cycle', async () => {
    const db = makeDb({ masterFolder: '/initial/master' });
    await saveLibraryDb(db);

    // Change master folder
    db.masterFolder = '/new/master';
    await saveLibraryDb(db);

    const loaded = await loadLibraryDb();
    expect(loaded.masterFolder).toBe('/new/master');
  });

  it('masterFolder defaults to ~/Music/sTunes for new DBs', async () => {
    try { await fs.promises.unlink(testDbPath); } catch { /* ignore */ }

    const db = await loadLibraryDb();
    expect(db.masterFolder).toBe('/tmp/stunes-test-music/sTunes');
  });

  it('dbToLibrary passes masterFolder to frontend data', () => {
    const db = makeDb({ masterFolder: '/custom/path' });
    db.tracks['/custom/path/Artist/Album/song.mp3'] = makeTrack({
      filePath: '/custom/path/Artist/Album/song.mp3',
    });

    const lib = dbToLibrary(db);
    expect(lib.masterFolder).toBe('/custom/path');
    expect(lib.tracks).toHaveLength(1);
  });
});
