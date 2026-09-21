import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron (libraryDb imports `app` at module load)
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/stunes-import-test-userdata';
      if (name === 'music') return '/tmp/stunes-import-test-music';
      return '/tmp/stunes-import-test';
    },
  },
}));

// Metadata is derived from the file content written by the tests:
// each fixture file contains `Artist|Album|Title`.
vi.mock('../metadata', () => ({
  readTrackMetadata: vi.fn(async (filePath: string) => {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const [artist, album, title] = raw.split('|');
    const stats = await fs.promises.stat(filePath);
    return {
      filePath,
      fileName: path.basename(filePath),
      title: title || path.basename(filePath),
      artist: artist || 'Unknown Artist',
      album: album || 'Unknown Album',
      albumArtist: artist || 'Unknown Artist',
      year: 2024,
      trackNumber: 1,
      discNumber: 1,
      genre: 'Rock',
      duration: 180,
      bitrate: 320,
      sampleRate: 44100,
      format: 'mp3',
      fileSize: stats.size,
      coverArt: null,
    };
  }),
  isSupportedAudioFile: () => true,
}));

import { importFilesIntoDb, mergeTrackRecord } from '../importFiles';
import type { LibraryDatabase, TrackRecord } from '../libraryDb';

let tmpRoot: string;
let sourceDir: string;
let masterFolder: string;

function makeDb(overrides: Partial<LibraryDatabase> = {}): LibraryDatabase {
  return {
    version: 1,
    libraryPaths: [],
    masterFolder,
    lastScanned: new Date().toISOString(),
    tracks: {},
    ...overrides,
  };
}

async function makeSourceFile(
  fileName: string,
  artist = 'Test Artist',
  album = 'Test Album',
  title = 'Test Song'
): Promise<string> {
  const p = path.join(sourceDir, fileName);
  await fs.promises.writeFile(p, `${artist}|${album}|${title}`);
  return p;
}

beforeEach(async () => {
  tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stunes-import-'));
  sourceDir = path.join(tmpRoot, 'source');
  masterFolder = path.join(tmpRoot, 'master');
  await fs.promises.mkdir(sourceDir, { recursive: true });
  await fs.promises.mkdir(masterFolder, { recursive: true });
});

afterEach(async () => {
  await fs.promises.rm(tmpRoot, { recursive: true, force: true });
});

describe('importFilesIntoDb - first import', () => {
  it('copies files into masterFolder/Artist/Album and registers them', async () => {
    const src = await makeSourceFile('song.mp3', 'Daft Punk', 'Discovery', 'One More Time');
    const db = makeDb();

    const result = await importFilesIntoDb(db, [src]);

    const destPath = path.join(masterFolder, 'Daft Punk', 'Discovery', 'song.mp3');
    expect(fs.existsSync(destPath)).toBe(true);
    expect(result).toMatchObject({ imported: 1, skipped: 0, errors: [] });
    expect(db.tracks[destPath]).toBeDefined();
    expect(db.tracks[destPath].title).toBe('One More Time');
  });

  it('sets default custom metadata for brand new tracks', async () => {
    const src = await makeSourceFile('song.mp3');
    const db = makeDb();

    await importFilesIntoDb(db, [src]);

    const destPath = path.join(masterFolder, 'Test Artist', 'Test Album', 'song.mp3');
    const track = db.tracks[destPath];
    expect(track.rating).toBe(0);
    expect(track.playCount).toBe(0);
    expect(track.favorite).toBe(false);
    expect(track.tags).toEqual([]);
    expect(track.comment).toBe('');
    expect(track.dateAdded).toBeTruthy();
  });

  it('sanitizes filesystem-unsafe characters in artist/album names', async () => {
    const src = await makeSourceFile('track.mp3', 'AC/DC', 'Back: In Black');
    const db = makeDb();

    await importFilesIntoDb(db, [src]);

    const destPath = path.join(masterFolder, 'AC_DC', 'Back_ In Black', 'track.mp3');
    expect(fs.existsSync(destPath)).toBe(true);
    expect(db.tracks[destPath]).toBeDefined();
  });

  it('registers masterFolder as a library path', async () => {
    const src = await makeSourceFile('song.mp3');
    const db = makeDb();

    await importFilesIntoDb(db, [src]);

    expect(db.libraryPaths).toContain(masterFolder);
  });

  it('does not duplicate masterFolder in library paths', async () => {
    const src = await makeSourceFile('song.mp3');
    const db = makeDb({ libraryPaths: [masterFolder] });

    await importFilesIntoDb(db, [src]);

    expect(db.libraryPaths.filter((p) => p === masterFolder)).toHaveLength(1);
  });
});

describe('importFilesIntoDb - re-import of an already imported file (issue #15)', () => {
  it('preserves rating, playCount, favorite, tags and comment', async () => {
    const src = await makeSourceFile('song.mp3');
    const db = makeDb();
    await importFilesIntoDb(db, [src]);

    const destPath = path.join(masterFolder, 'Test Artist', 'Test Album', 'song.mp3');
    // User marks up the track
    db.tracks[destPath].rating = 5;
    db.tracks[destPath].playCount = 42;
    db.tracks[destPath].favorite = true;
    db.tracks[destPath].tags = ['chill', 'night'];
    db.tracks[destPath].comment = 'best track';

    await importFilesIntoDb(db, [src]);

    expect(db.tracks[destPath].rating).toBe(5);
    expect(db.tracks[destPath].playCount).toBe(42);
    expect(db.tracks[destPath].favorite).toBe(true);
    expect(db.tracks[destPath].tags).toEqual(['chill', 'night']);
    expect(db.tracks[destPath].comment).toBe('best track');
  });

  it('preserves the original dateAdded', async () => {
    const src = await makeSourceFile('song.mp3');
    const db = makeDb();
    await importFilesIntoDb(db, [src]);

    const destPath = path.join(masterFolder, 'Test Artist', 'Test Album', 'song.mp3');
    const originalDate = '2020-01-02T03:04:05.000Z';
    db.tracks[destPath].dateAdded = originalDate;

    await importFilesIntoDb(db, [src]);

    expect(db.tracks[destPath].dateAdded).toBe(originalDate);
  });

  it('does not count an already-present file as imported', async () => {
    const src = await makeSourceFile('song.mp3');
    const db = makeDb();
    await importFilesIntoDb(db, [src]);

    const result = await importFilesIntoDb(db, [src]);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('does not overwrite the destination file contents', async () => {
    const src = await makeSourceFile('song.mp3');
    const db = makeDb();
    await importFilesIntoDb(db, [src]);

    const destPath = path.join(masterFolder, 'Test Artist', 'Test Album', 'song.mp3');
    // Source changes, but the destination must stay as-is (no overwrite policy)
    await fs.promises.writeFile(src, 'Test Artist|Test Album|Changed Title');

    await importFilesIntoDb(db, [src]);

    const contents = await fs.promises.readFile(destPath, 'utf-8');
    expect(contents).toBe('Test Artist|Test Album|Test Song');
  });

  it('counts new and existing files separately in a mixed batch', async () => {
    const a = await makeSourceFile('a.mp3');
    const db = makeDb();
    await importFilesIntoDb(db, [a]);

    const b = await makeSourceFile('b.mp3');
    const result = await importFilesIntoDb(db, [a, b]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('keeps custom metadata when the same file is imported from a different source folder', async () => {
    const src = await makeSourceFile('song.mp3');
    const db = makeDb();
    await importFilesIntoDb(db, [src]);

    const destPath = path.join(masterFolder, 'Test Artist', 'Test Album', 'song.mp3');
    db.tracks[destPath].rating = 3;
    db.tracks[destPath].tags = ['keep'];

    const otherDir = path.join(tmpRoot, 'other');
    await fs.promises.mkdir(otherDir, { recursive: true });
    const copy = path.join(otherDir, 'song.mp3');
    await fs.promises.copyFile(src, copy);

    const result = await importFilesIntoDb(db, [copy]);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(db.tracks[destPath].rating).toBe(3);
    expect(db.tracks[destPath].tags).toEqual(['keep']);
  });
});

describe('importFilesIntoDb - errors and progress', () => {
  it('reports unreadable files as errors without aborting the batch', async () => {
    const good = await makeSourceFile('good.mp3');
    const missing = path.join(sourceDir, 'missing.mp3');
    const db = makeDb();

    const result = await importFilesIntoDb(db, [missing, good]);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing.mp3');
  });

  it('reports progress monotonically and finishes at total', async () => {
    const a = await makeSourceFile('a.mp3');
    const b = await makeSourceFile('b.mp3');
    const db = makeDb();
    const progress: Array<[number, number]> = [];

    await importFilesIntoDb(db, [a, b], (current, total) => progress.push([current, total]));

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every(([, total]) => total === 2)).toBe(true);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i][0]).toBeGreaterThanOrEqual(progress[i - 1][0]);
    }
  });

  it('handles an empty file list without touching library paths', async () => {
    const db = makeDb();

    const result = await importFilesIntoDb(db, []);

    expect(result).toMatchObject({ imported: 0, skipped: 0, errors: [] });
    expect(db.libraryPaths).toEqual([]);
  });
});

describe('mergeTrackRecord', () => {
  const meta = {
    filePath: '/m/song.mp3',
    fileName: 'song.mp3',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
  };

  it('uses defaults when there is no existing record', () => {
    const rec = mergeTrackRecord(undefined, meta, 123);
    expect(rec.lastModified).toBe(123);
    expect(rec.rating).toBe(0);
    expect(rec.playCount).toBe(0);
    expect(rec.favorite).toBe(false);
    expect(rec.tags).toEqual([]);
    expect(rec.comment).toBe('');
  });

  it('keeps existing custom metadata and dateAdded', () => {
    const existing = {
      dateAdded: '2021-05-05T00:00:00.000Z',
      rating: 4,
      playCount: 7,
      favorite: true,
      tags: ['a'],
      comment: 'hi',
    } as TrackRecord;

    const rec = mergeTrackRecord(existing, meta, 999);

    expect(rec.dateAdded).toBe('2021-05-05T00:00:00.000Z');
    expect(rec.rating).toBe(4);
    expect(rec.playCount).toBe(7);
    expect(rec.favorite).toBe(true);
    expect(rec.tags).toEqual(['a']);
    expect(rec.comment).toBe('hi');
    expect(rec.lastModified).toBe(999);
  });

  it('keeps falsy-but-set values like rating 0 and favorite false', () => {
    const existing = {
      dateAdded: '2021-05-05T00:00:00.000Z',
      rating: 0,
      playCount: 0,
      favorite: false,
      tags: [],
      comment: '',
    } as unknown as TrackRecord;

    const rec = mergeTrackRecord(existing, meta, 1);

    expect(rec.rating).toBe(0);
    expect(rec.favorite).toBe(false);
    expect(rec.dateAdded).toBe('2021-05-05T00:00:00.000Z');
  });

  it('refreshes file metadata from the newly read tags', () => {
    const existing = { rating: 2, title: 'Old', artist: 'Old' } as TrackRecord;
    const rec = mergeTrackRecord(existing, { ...meta, title: 'New Title' }, 55);
    expect(rec.title).toBe('New Title');
    expect(rec.rating).toBe(2);
  });
});
