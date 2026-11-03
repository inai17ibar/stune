import { describe, expect, it } from 'vitest';
import { assertPathInside, isDevicePathInside, isPathInside } from '../pathGuard';
import { buildExpectedDevicePath, sanitizePathSegment } from '../syncDiff';

describe('write destination boundaries', () => {
  it.each([
    ['/MUSIC/Artist/Album', true],
    ['/MUSIC/song.mp3', true],
    ['/MUSIC', false],
    ['/MUSIC/./.', false],
    ['/MUSIC/Artist/..', false],
    ['/MUSIC/../../song.mp3', false],
    ['/MUSIC-other/song.mp3', false],
    ['/song.mp3', false],
  ])('agrees for local and MTP destination %s', (candidate, expected) => {
    expect(isPathInside('/MUSIC', candidate)).toBe(expected);
    expect(isDevicePathInside('/MUSIC', candidate)).toBe(expected);
    if (expected) expect(() => assertPathInside('/MUSIC', candidate)).not.toThrow();
    else expect(() => assertPathInside('/MUSIC', candidate)).toThrow('refusing to write outside');
  });

  it('handles trailing separators and filesystem roots', () => {
    expect(isPathInside('/MUSIC/', '/MUSIC/a')).toBe(true);
    expect(isDevicePathInside('/MUSIC/', '/MUSIC/a')).toBe(true);
    expect(isPathInside('/', '/')).toBe(false);
    expect(isDevicePathInside('/', '/')).toBe(false);
    expect(isPathInside('/', '/a')).toBe(true);
    expect(isDevicePathInside('/', '/a')).toBe(true);
  });

  it.each(['', ' ', '.', '..', '...', ' .. ', '\t.\n'])('neutralizes unsafe tag %j for import and transfer', (tag) => {
    expect(sanitizePathSegment(tag)).toBe('_');
    const relative = buildExpectedDevicePath({ filePath: '/source/song.mp3', fileName: 'song.mp3', title: 'Song', artist: tag, album: tag });
    expect(relative).not.toContain('..');
    expect(isPathInside('/MUSIC', `/MUSIC/${relative}`)).toBe(true);
    expect(isDevicePathInside('/MUSIC', `/MUSIC/${relative}`)).toBe(true);
  });
});
