import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { copyTracks } from '../transfer';

const testDir = '/tmp/stunes-transfer-test';
const srcDir = path.join(testDir, 'src');
const destDir = path.join(testDir, 'dest');

beforeEach(async () => {
  await fs.promises.mkdir(srcDir, { recursive: true });
  await fs.promises.mkdir(destDir, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

async function createTestFile(dir: string, name: string, content = 'test'): Promise<string> {
  const fp = path.join(dir, name);
  await fs.promises.writeFile(fp, content);
  return fp;
}

describe('copyTracks', () => {
  it('copies a single file to destination', async () => {
    const src = await createTestFile(srcDir, 'song.mp3');
    const progress = vi.fn();

    const result = await copyTracks([src], destDir, progress);

    expect(result.success).toBe(true);
    expect(result.copiedCount).toBe(1);
    expect(result.errors).toHaveLength(0);

    const destFile = path.join(destDir, 'song.mp3');
    const exists = await fs.promises.access(destFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('copies multiple files', async () => {
    const src1 = await createTestFile(srcDir, 'a.mp3');
    const src2 = await createTestFile(srcDir, 'b.flac');
    const progress = vi.fn();

    const result = await copyTracks([src1, src2], destDir, progress);

    expect(result.success).toBe(true);
    expect(result.copiedCount).toBe(2);
  });

  it('handles duplicate filenames by appending counter', async () => {
    const src = await createTestFile(srcDir, 'song.mp3', 'original');
    // Pre-create the file in destination
    await createTestFile(destDir, 'song.mp3', 'existing');
    const progress = vi.fn();

    const result = await copyTracks([src], destDir, progress);

    expect(result.success).toBe(true);
    // Original file should still exist
    const orig = await fs.promises.readFile(path.join(destDir, 'song.mp3'), 'utf-8');
    expect(orig).toBe('existing');
    // Copy should be song (1).mp3
    const copy = await fs.promises.readFile(path.join(destDir, 'song (1).mp3'), 'utf-8');
    expect(copy).toBe('original');
  });

  it('reports progress during transfer', async () => {
    const src1 = await createTestFile(srcDir, 'a.mp3');
    const src2 = await createTestFile(srcDir, 'b.mp3');
    const progress = vi.fn();

    await copyTracks([src1, src2], destDir, progress);

    // Should be called for each file + final
    expect(progress).toHaveBeenCalledTimes(3);
    // First call: transferring file 1
    expect(progress.mock.calls[0][0]).toMatchObject({
      totalFiles: 2,
      completedFiles: 0,
      currentFile: 'a.mp3',
      status: 'transferring',
    });
    // Last call: completed
    expect(progress.mock.calls[2][0]).toMatchObject({
      totalFiles: 2,
      completedFiles: 2,
      percentage: 100,
      status: 'completed',
    });
  });

  it('reports errors for missing source files', async () => {
    const progress = vi.fn();

    const result = await copyTracks(['/nonexistent/file.mp3'], destDir, progress);

    expect(result.success).toBe(false);
    expect(result.copiedCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    // Final progress should indicate error
    const lastCall = progress.mock.calls[progress.mock.calls.length - 1][0];
    expect(lastCall.status).toBe('error');
  });

  it('continues copying remaining files after an error', async () => {
    const src = await createTestFile(srcDir, 'good.mp3');
    const progress = vi.fn();

    const result = await copyTracks(
      ['/nonexistent/bad.mp3', src],
      destDir,
      progress
    );

    expect(result.copiedCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    const destFile = path.join(destDir, 'good.mp3');
    const exists = await fs.promises.access(destFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('creates destination directory if it does not exist', async () => {
    const src = await createTestFile(srcDir, 'song.mp3');
    const newDest = path.join(testDir, 'new', 'nested', 'dir');
    const progress = vi.fn();

    const result = await copyTracks([src], newDest, progress);

    expect(result.success).toBe(true);
    const exists = await fs.promises.access(path.join(newDest, 'song.mp3')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});

// ===== Transfer filename prefix logic (extracted from main.ts) =====

describe('transfer filename prefix logic', () => {
  function buildPrefixedFilename(
    origFileName: string,
    trackNumber: number | undefined,
    discNumber: number | undefined
  ): string {
    const disc = discNumber || 1;
    const trackNum = trackNumber || 0;
    const prefix = trackNum > 0
      ? (disc > 1 ? `${disc}-${String(trackNum).padStart(2, '0')}` : String(trackNum).padStart(2, '0'))
      : '';
    const alreadyPrefixed = prefix && origFileName.match(/^\d+[-.\s]/);
    return (!alreadyPrefixed && prefix)
      ? `${prefix} ${origFileName}`
      : origFileName;
  }

  it('prefixes single-disc track with zero-padded number', () => {
    expect(buildPrefixedFilename('song.flac', 3, 1)).toBe('03 song.flac');
  });

  it('prefixes multi-disc track with disc-track format', () => {
    expect(buildPrefixedFilename('song.flac', 5, 2)).toBe('2-05 song.flac');
  });

  it('does not prefix when track number is 0 or undefined', () => {
    expect(buildPrefixedFilename('song.flac', 0, 1)).toBe('song.flac');
    expect(buildPrefixedFilename('song.flac', undefined, 1)).toBe('song.flac');
  });

  it('does not double-prefix already numbered files', () => {
    expect(buildPrefixedFilename('03 song.flac', 3, 1)).toBe('03 song.flac');
    expect(buildPrefixedFilename('3-05 song.flac', 5, 3)).toBe('3-05 song.flac');
  });

  it('prefixes track 1 of disc 1 correctly', () => {
    expect(buildPrefixedFilename('intro.mp3', 1, 1)).toBe('01 intro.mp3');
  });

  it('handles high track numbers', () => {
    expect(buildPrefixedFilename('song.mp3', 99, 1)).toBe('99 song.mp3');
  });

  it('handles disc number with track 1', () => {
    expect(buildPrefixedFilename('song.mp3', 1, 3)).toBe('3-01 song.mp3');
  });

  it('builds correct Artist/Album directory path', () => {
    const artist = 'Led Zeppelin'.replace(/[/\\:*?"<>|]/g, '_');
    const album = 'Led Zeppelin IV'.replace(/[/\\:*?"<>|]/g, '_');
    const destDir = path.join('/Volumes/WALKMAN', 'MUSIC', artist, album);
    expect(destDir).toBe('/Volumes/WALKMAN/MUSIC/Led Zeppelin/Led Zeppelin IV');
  });

  it('sanitizes artist/album names with special characters', () => {
    const artist = 'AC/DC'.replace(/[/\\:*?"<>|]/g, '_');
    const album = 'Who Made Who?'.replace(/[/\\:*?"<>|]/g, '_');
    const destDir = path.join('/Volumes/WALKMAN', 'MUSIC', artist, album);
    expect(destDir).toBe('/Volumes/WALKMAN/MUSIC/AC_DC/Who Made Who_');
  });

  it('complete transfer path example: disc 2 track 5', () => {
    const artist = 'Pink Floyd'.replace(/[/\\:*?"<>|]/g, '_');
    const album = 'The Wall'.replace(/[/\\:*?"<>|]/g, '_');
    const destDir = path.join('/Volumes/WALKMAN', 'MUSIC', artist, album);
    const destFileName = buildPrefixedFilename('comfortably_numb.flac', 5, 2);
    const fullPath = path.join(destDir, destFileName);
    expect(fullPath).toBe('/Volumes/WALKMAN/MUSIC/Pink Floyd/The Wall/2-05 comfortably_numb.flac');
  });
});
