// 再現テスト: ARTIST / ALBUM タグに ".." を入れた音楽ファイルをインポートすると
// sanitizePathSegment が ".." を通すため、マスターフォルダの外にコピーされる。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/stunes-traversal-userdata' },
}));

// ファイル内容 "Artist|Album|Title" をタグとして読む（既存テストと同じ方式）
vi.mock('../metadata', () => ({
  readTrackMetadata: vi.fn(async (filePath: string) => {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const [artist, album, title] = raw.split('|');
    return {
      filePath,
      fileName: path.basename(filePath),
      title: title || 'x',
      artist,
      album,
      albumArtist: artist,
      trackNumber: 1,
      discNumber: 1,
    };
  }),
  isSupportedAudioFile: () => true,
}));

import { importFilesIntoDb } from '../importFiles';
import type { LibraryDatabase } from '../libraryDb';

let tmpRoot: string;
let masterFolder: string;

beforeEach(async () => {
  tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stune-traversal-'));
  // 実運用と同じ入れ子の深さ: <root>/Music/sTunes
  masterFolder = path.join(tmpRoot, 'Music', 'sTunes');
  await fs.promises.mkdir(masterFolder, { recursive: true });
});

afterEach(async () => {
  await fs.promises.rm(tmpRoot, { recursive: true, force: true });
});

describe('importFilesIntoDb path traversal', () => {
  it('keeps imported files inside the master folder', async () => {
    const source = path.join(tmpRoot, 'evil.mp3');
    // ARTIST = "..", ALBUM = ".." （タグは任意の文字列を入れられる）
    await fs.promises.writeFile(source, '..|..|Evil');

    const db: LibraryDatabase = {
      version: 1,
      libraryPaths: [],
      masterFolder,
      lastScanned: new Date().toISOString(),
      tracks: {},
    };

    await importFilesIntoDb(db, [source]);

    const registered = Object.keys(db.tracks);
    expect(registered).toHaveLength(1);

    const dest = path.resolve(registered[0]);
    // マスターフォルダ配下に収まっていること
    expect(dest.startsWith(path.resolve(masterFolder) + path.sep)).toBe(true);
    expect(dest).not.toBe(path.join(tmpRoot, 'evil.mp3'));
  });

  it('keeps files with whitespace-padded dot tags inside the master folder', async () => {
    const source = path.join(tmpRoot, 'padded.mp3');
    // 前後の空白を落とすと ".." になるタグ
    await fs.promises.writeFile(source, ' .. | . |Padded');

    const db: LibraryDatabase = {
      version: 1,
      libraryPaths: [],
      masterFolder,
      lastScanned: new Date().toISOString(),
      tracks: {},
    };

    const result = await importFilesIntoDb(db, [source]);
    expect(result.errors).toEqual([]);

    const dest = path.resolve(Object.keys(db.tracks)[0]);
    expect(dest.startsWith(path.resolve(masterFolder) + path.sep)).toBe(true);
  });

  it('keeps files with separator-laden tags inside the master folder', async () => {
    const source = path.join(tmpRoot, 'sep.mp3');
    // path separator はサニタイズ済みだが、念のため脱出できないことを確認
    await fs.promises.writeFile(source, '../../etc|..\\..\\tmp|Sep');

    const db: LibraryDatabase = {
      version: 1,
      libraryPaths: [],
      masterFolder,
      lastScanned: new Date().toISOString(),
      tracks: {},
    };

    await importFilesIntoDb(db, [source]);

    const dest = path.resolve(Object.keys(db.tracks)[0]);
    expect(dest.startsWith(path.resolve(masterFolder) + path.sep)).toBe(true);
  });
});
