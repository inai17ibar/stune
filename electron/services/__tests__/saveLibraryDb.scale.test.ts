import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock electron (own userData dir so this file can run in parallel with libraryDb.test.ts)
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/stunes-save-scale-test-userdata';
      if (name === 'music') return '/tmp/stunes-save-scale-test-music';
      return '/tmp/stunes-save-scale-test';
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
  type LibraryDatabase,
  type TrackRecord,
} from '../libraryDb';

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
    lastModified: 1700000000000,
    dateAdded: '2024-01-01T00:00:00.000Z',
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
    masterFolder: '/tmp/stunes-save-scale-test-music/sTunes',
    lastScanned: '2024-01-01T00:00:00.000Z',
    tracks: {},
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

const testDbDir = '/tmp/stunes-save-scale-test-userdata';
const testDbPath = path.join(testDbDir, 'sTuneLibrary.json');
const testTmpPath = testDbPath + '.tmp';
const testCoversDir = path.join(testDbDir, 'covers');

beforeEach(async () => {
  await fs.promises.mkdir(testDbDir, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.promises.rm(testDbDir, { recursive: true, force: true });
});

describe('saveLibraryDb compact JSON (#60)', () => {
  it('writes a single-line file that round-trips through loadLibraryDb', async () => {
    const db = makeDb({ libraryPaths: ['/music'] });
    for (let i = 0; i < 5; i++) {
      const p = `/music/t${i}.mp3`;
      db.tracks[p] = makeTrack({ filePath: p, fileName: `t${i}.mp3`, title: `T${i}`, tags: ['a', 'b'] });
    }

    await saveLibraryDb(db);

    const raw = await fs.promises.readFile(testDbPath, 'utf-8');
    expect(raw).not.toContain('\n');
    const loaded = await loadLibraryDb();
    expect(loaded).toEqual(db);
  });
});

describe('saveLibraryDb coalescing (#60)', () => {
  function countTmpWrites(spy: ReturnType<typeof vi.spyOn>): number {
    return spy.mock.calls.filter((c: unknown[]) => c[0] === testTmpPath).length;
  }

  it('collapses saves made while one is in flight into a single follow-up', async () => {
    const realWriteFile = fs.promises.writeFile.bind(fs.promises);
    const gate = deferred();
    let gated = false;
    const writeSpy = vi.spyOn(fs.promises, 'writeFile').mockImplementation(
      (async (...args: Parameters<typeof fs.promises.writeFile>) => {
        if (args[0] === testTmpPath && !gated) {
          gated = true;
          await gate.promise;
        }
        return realWriteFile(...args);
      }) as typeof fs.promises.writeFile,
    );

    const db = makeDb();
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3' });

    const first = saveLibraryDb(db);
    const rest: Promise<void>[] = [];
    for (let i = 1; i <= 5; i++) {
      db.tracks['/music/a.mp3'].playCount = i;
      rest.push(saveLibraryDb(db));
    }

    gate.resolve();
    await Promise.all([first, ...rest]);

    expect(countTmpWrites(writeSpy)).toBeLessThanOrEqual(2);
    const loaded = JSON.parse(await fs.promises.readFile(testDbPath, 'utf-8')) as LibraryDatabase;
    expect(loaded.tracks['/music/a.mp3'].playCount).toBe(5);
  });

  it('runs the queued follow-up even when the in-flight save fails', async () => {
    const realWriteFile = fs.promises.writeFile.bind(fs.promises);
    const gate = deferred();
    let failed = false;
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(
      (async (...args: Parameters<typeof fs.promises.writeFile>) => {
        if (args[0] === testTmpPath && !failed) {
          failed = true;
          await gate.promise;
          throw new Error('disk full');
        }
        return realWriteFile(...args);
      }) as typeof fs.promises.writeFile,
    );

    const db = makeDb();
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3' });

    const first = saveLibraryDb(db);
    db.tracks['/music/a.mp3'].rating = 4;
    const second = saveLibraryDb(db);

    gate.resolve();
    await expect(first).rejects.toThrow('disk full');
    await expect(second).resolves.toBeUndefined();

    const loaded = JSON.parse(await fs.promises.readFile(testDbPath, 'utf-8')) as LibraryDatabase;
    expect(loaded.tracks['/music/a.mp3'].rating).toBe(4);
  });

  it('sequential awaited saves each perform a real write', async () => {
    const writeSpy = vi.spyOn(fs.promises, 'writeFile');
    const db = makeDb();
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3' });

    await saveLibraryDb(db);
    await saveLibraryDb(db);
    await saveLibraryDb(db);

    expect(countTmpWrites(writeSpy)).toBe(3);
  });
});

describe('saveLibraryDb cover art pass (#60)', () => {
  function countCoverMkdirs(spy: ReturnType<typeof vi.spyOn>): number {
    return spy.mock.calls.filter((c: unknown[]) => c[0] === testCoversDir).length;
  }

  it('does not re-run extraction for an already-processed record object', async () => {
    const mkdirSpy = vi.spyOn(fs.promises, 'mkdir');
    // Malformed data URI: saveCoverArt returns it as-is, so before #60 it was
    // re-processed on every save.
    const malformed = 'data:image/jpeg,not-base64';
    const db = makeDb();
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3', coverArt: malformed });

    await saveLibraryDb(db);
    expect(countCoverMkdirs(mkdirSpy)).toBe(1);
    expect(db.tracks['/music/a.mp3'].coverArt).toBe(malformed);

    await saveLibraryDb(db);
    expect(countCoverMkdirs(mkdirSpy)).toBe(1);

    // A replaced record (as after a metadata re-read) is processed again.
    db.tracks['/music/a.mp3'] = makeTrack({ filePath: '/music/a.mp3', coverArt: malformed });
    await saveLibraryDb(db);
    expect(countCoverMkdirs(mkdirSpy)).toBe(2);
  });

  it('still extracts a valid data URI to a cover file', async () => {
    const db = makeDb();
    const base64 = Buffer.from('fake-jpeg-bytes').toString('base64');
    db.tracks['/music/a.mp3'] = makeTrack({
      filePath: '/music/a.mp3',
      coverArt: `data:image/jpeg;base64,${base64}`,
    });

    await saveLibraryDb(db);

    const coverPath = db.tracks['/music/a.mp3'].coverArt!;
    expect(coverPath.startsWith(testCoversDir)).toBe(true);
    expect((await fs.promises.readFile(coverPath)).toString()).toBe('fake-jpeg-bytes');
  });
});
