import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { deleteLibraryTracks, validateMtpDeletion } from './fileDeletion';
import type { LibraryDatabase, TrackRecord } from './libraryDb';

let dir: string;
let root: string;
let db: LibraryDatabase;
const register = (file: string) => { db.tracks[file] = { filePath: file } as TrackRecord; };
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stune-delete-'));
  root = path.join(dir, 'music');
  await fs.mkdir(root);
  db = { version: 1, libraryPaths: [root], masterFolder: path.join(dir, 'master'), lastScanned: '', tracks: {} };
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('library deletion trust boundary', () => {
  it('keeps unregistered audio and documents, even inside the library folder', async () => {
    for (const file of [path.join(dir, 'private.txt'), path.join(root, 'unknown.mp3')]) {
      await fs.writeFile(file, 'keep');
      expect((await deleteLibraryTracks(db, [file], true)).deletedCount).toBe(0);
      expect(await fs.readFile(file, 'utf8')).toBe('keep');
    }
  });
  it('rejects registered files outside roots, prefix siblings, traversal and non-audio', async () => {
    await fs.mkdir(root + '-other');
    for (const file of [path.join(dir, 'secret.mp3'), path.join(root + '-other', 'song.mp3'), path.join(root, 'notes.txt')]) {
      await fs.writeFile(file, 'keep'); register(file);
      expect((await deleteLibraryTracks(db, [file], true)).deletedCount).toBe(0);
      expect(await fs.readFile(file, 'utf8')).toBe('keep');
      expect(db.tracks[file]).toBeDefined();
    }
    const traversal = root + '/../secret.mp3'; register(traversal);
    expect((await deleteLibraryTracks(db, [traversal], true)).deletedCount).toBe(0);
  });
  it('rejects file symlinks and parent directory symlink escapes', async () => {
    const outside = path.join(dir, 'outside'); await fs.mkdir(outside);
    const victim = path.join(outside, 'song.mp3'); await fs.writeFile(victim, 'keep');
    await fs.symlink(victim, path.join(root, 'link.mp3'));
    await fs.symlink(outside, path.join(root, 'linked-dir'));
    for (const file of [path.join(root, 'link.mp3'), path.join(root, 'linked-dir/song.mp3')]) {
      register(file);
      expect((await deleteLibraryTracks(db, [file], true)).deletedCount).toBe(0);
    }
    expect(await fs.readFile(victim, 'utf8')).toBe('keep');
  });
  it('deletes registered music in library and master folders, counting duplicates once', async () => {
    await fs.mkdir(db.masterFolder);
    for (const base of [root, db.masterFolder]) {
      const file = path.join(base, 'song.flac'); await fs.writeFile(file, 'music'); register(file);
      expect(await deleteLibraryTracks(db, [file, file], true)).toEqual({ deletedCount: 1, errors: [] });
      await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(db.tracks[file]).toBeUndefined();
    }
  });
  it('removes DB-only entries without deleting files and cleans missing registered files', async () => {
    const file = path.join(root, 'song.mp3'); await fs.writeFile(file, 'music'); register(file);
    expect((await deleteLibraryTracks(db, [file], false)).deletedCount).toBe(1);
    expect(await fs.readFile(file, 'utf8')).toBe('music');
    await fs.unlink(file); register(file);
    expect((await deleteLibraryTracks(db, [file], true)).deletedCount).toBe(1);
  });
  it('cleans registered tracks after album or artist directories are removed', async () => {
    for (const removed of ['album', 'artist']) {
      const artist = path.join(root, removed);
      const album = path.join(artist, 'album');
      await fs.mkdir(album, { recursive: true });
      const file = path.join(album, 'song.mp3');
      await fs.writeFile(file, 'audio'); register(file);
      await fs.rm(removed === 'album' ? album : artist, { recursive: true });
      expect(await deleteLibraryTracks(db, [file], true)).toEqual({ deletedCount: 1, errors: [] });
      expect(db.tracks[file]).toBeUndefined();
    }
  });
  it('rejects missing descendants of escaping or dangling symlink ancestors', async () => {
    const outside = path.join(dir, 'outside'); await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, 'escape'));
    await fs.symlink(path.join(dir, 'gone'), path.join(root, 'dangling'));
    for (const name of ['escape', 'dangling']) {
      const file = path.join(root, name, 'missing', 'album', 'song.mp3'); register(file);
      expect((await deleteLibraryTracks(db, [file], true)).deletedCount).toBe(0);
      expect(db.tracks[file]).toBeDefined();
    }
  });
  it('rejects malformed payloads', async () => {
    await expect(deleteLibraryTracks(db, 'path', true)).rejects.toThrow();
    await expect(deleteLibraryTracks(db, [1], true)).rejects.toThrow();
    await expect(deleteLibraryTracks(db, [], 'yes')).rejects.toThrow();
  });
});

describe('MTP deletion paths', () => {
  it('accepts audio only in the selected storage music folder', () => {
    expect(validateMtpDeletion('mtp://0', 'mtp://0/MUSIC/song.mp3')).toBe('/MUSIC/song.mp3');
    expect(validateMtpDeletion('mtp://0', '/Music/song.flac')).toBe('/Music/song.flac');
    for (const file of ['mtp://1/MUSIC/song.mp3', '/MUSIC/../secret.mp3', '/Documents/song.mp3', '/MUSIC/notes.txt']) {
      expect(() => validateMtpDeletion('mtp://0', file)).toThrow();
    }
  });
});
