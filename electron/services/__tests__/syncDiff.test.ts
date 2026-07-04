import { describe, it, expect } from 'vitest';

import {
  sanitizePathSegment,
  buildTransferFileName,
  buildExpectedDevicePath,
  getDeviceRelativePath,
  computeSyncPlan,
  SyncTrack,
} from '../syncDiff';

function track(overrides: Partial<SyncTrack> & { fileName: string }): SyncTrack {
  return {
    filePath: `/lib/${overrides.fileName}`,
    title: '',
    artist: '',
    album: '',
    ...overrides,
  };
}

describe('sanitizePathSegment', () => {
  it('replaces filesystem-unsafe characters with underscores', () => {
    expect(sanitizePathSegment('AC/DC')).toBe('AC_DC');
    expect(sanitizePathSegment('What?: "Best" <Hits>|*')).toBe('What__ _Best_ _Hits___');
    expect(sanitizePathSegment('a\\b')).toBe('a_b');
  });

  it('keeps safe names unchanged', () => {
    expect(sanitizePathSegment('Back in Black')).toBe('Back in Black');
    expect(sanitizePathSegment('宇多田ヒカル')).toBe('宇多田ヒカル');
  });
});

describe('buildTransferFileName', () => {
  it('prefixes with zero-padded track number', () => {
    expect(
      buildTransferFileName(track({ fileName: 'song.mp3', trackNumber: 5 }))
    ).toBe('05 song.mp3');
  });

  it('prefixes with disc and track number when disc > 1', () => {
    expect(
      buildTransferFileName(track({ fileName: 'song.mp3', trackNumber: 12, discNumber: 2 }))
    ).toBe('2-12 song.mp3');
  });

  it('returns original name when there is no track number', () => {
    expect(buildTransferFileName(track({ fileName: 'song.mp3' }))).toBe('song.mp3');
    expect(
      buildTransferFileName(track({ fileName: 'song.mp3', trackNumber: 0 }))
    ).toBe('song.mp3');
  });

  it('does not double-prefix already numbered filenames', () => {
    expect(
      buildTransferFileName(track({ fileName: '05 song.mp3', trackNumber: 5 }))
    ).toBe('05 song.mp3');
    expect(
      buildTransferFileName(track({ fileName: '05. song.mp3', trackNumber: 5 }))
    ).toBe('05. song.mp3');
    expect(
      buildTransferFileName(track({ fileName: '2-12 song.mp3', trackNumber: 12, discNumber: 2 }))
    ).toBe('2-12 song.mp3');
  });
});

describe('buildExpectedDevicePath', () => {
  it('builds Artist/Album/prefixed-filename with sanitized segments', () => {
    const t = track({
      fileName: 'Hells Bells.mp3',
      artist: 'AC/DC',
      album: 'Back in Black',
      trackNumber: 1,
    });
    expect(buildExpectedDevicePath(t)).toBe('AC_DC/Back in Black/01 Hells Bells.mp3');
  });

  it('falls back to Unknown Artist / Unknown Album', () => {
    const t = track({ fileName: 'mystery.mp3' });
    expect(buildExpectedDevicePath(t)).toBe('Unknown Artist/Unknown Album/mystery.mp3');
  });
});

describe('getDeviceRelativePath', () => {
  it('strips a USB mount prefix up to the MUSIC folder', () => {
    expect(
      getDeviceRelativePath('/Volumes/WALKMAN/MUSIC/AC_DC/Back in Black/01 Hells Bells.mp3')
    ).toBe('AC_DC/Back in Black/01 Hells Bells.mp3');
  });

  it('strips an MTP path prefix up to the MUSIC folder', () => {
    expect(
      getDeviceRelativePath('mtp://65537/MUSIC/Artist/Album/song.flac')
    ).toBe('Artist/Album/song.flac');
  });

  it('matches the MUSIC folder case-insensitively', () => {
    expect(getDeviceRelativePath('/Volumes/WALKMAN/Music/Artist/Album/song.mp3')).toBe(
      'Artist/Album/song.mp3'
    );
  });

  it('uses an explicit music root when provided', () => {
    expect(
      getDeviceRelativePath('/Volumes/SD_CARD/tunes/Artist/song.mp3', '/Volumes/SD_CARD/tunes')
    ).toBe('Artist/song.mp3');
  });

  it('returns null when the path has no MUSIC folder and no root is given', () => {
    expect(getDeviceRelativePath('/Volumes/WALKMAN/random/song.mp3')).toBeNull();
  });
});

describe('computeSyncPlan', () => {
  const libTrack = track({
    filePath: '/lib/hells-bells.mp3',
    fileName: 'Hells Bells.mp3',
    title: 'Hells Bells',
    artist: 'AC/DC',
    album: 'Back in Black',
    trackNumber: 1,
  });

  function deviceTrack(devicePath: string, overrides: Partial<SyncTrack> = {}): SyncTrack {
    return {
      filePath: devicePath,
      fileName: devicePath.split('/').pop()!,
      title: '',
      artist: '',
      album: '',
      ...overrides,
    };
  }

  it('returns empty plan for empty inputs', () => {
    const plan = computeSyncPlan([], []);
    expect(plan.toTransfer).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.matched).toEqual([]);
  });

  it('marks library tracks missing from the device for transfer', () => {
    const plan = computeSyncPlan([libTrack], []);
    expect(plan.toTransfer).toEqual([libTrack]);
    expect(plan.toDelete).toEqual([]);
  });

  it('matches a device file at the expected transfer path', () => {
    const dev = deviceTrack('/Volumes/WALKMAN/MUSIC/AC_DC/Back in Black/01 Hells Bells.mp3');
    const plan = computeSyncPlan([libTrack], [dev]);
    expect(plan.toTransfer).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.matched).toEqual([{ library: libTrack, device: dev }]);
  });

  it('matches device files transferred without a track-number prefix (legacy)', () => {
    const dev = deviceTrack('/Volumes/WALKMAN/MUSIC/AC_DC/Back in Black/Hells Bells.mp3');
    const plan = computeSyncPlan([libTrack], [dev]);
    expect(plan.matched).toHaveLength(1);
    expect(plan.toTransfer).toEqual([]);
  });

  it('matches paths case-insensitively (FAT/exFAT volumes)', () => {
    const dev = deviceTrack('/Volumes/WALKMAN/MUSIC/ac_dc/back in black/01 hells bells.mp3');
    const plan = computeSyncPlan([libTrack], [dev]);
    expect(plan.matched).toHaveLength(1);
  });

  it('matches Unicode paths regardless of NFC/NFD normalization', () => {
    // macOS reports NFD ("ハ" + combining dakuten), tags are usually NFC
    const lib = track({
      filePath: '/lib/utada.flac',
      fileName: 'First Love.flac',
      title: 'First Love',
      artist: '宇多田ヒカル',
      album: 'First Love',
      trackNumber: 1,
    });
    const nfdArtist = '宇多田ヒカル'.normalize('NFD');
    const dev = deviceTrack(
      `/Volumes/WALKMAN/MUSIC/${nfdArtist}/First Love/01 First Love.flac`
    );
    const plan = computeSyncPlan([lib], [dev]);
    expect(plan.matched).toHaveLength(1);
  });

  it('marks device files not in the library for deletion', () => {
    const dev = deviceTrack('/Volumes/WALKMAN/MUSIC/Other/Album/other song.mp3');
    const plan = computeSyncPlan([libTrack], [dev]);
    expect(plan.toTransfer).toEqual([libTrack]);
    expect(plan.toDelete).toEqual([dev]);
  });

  it('falls back to tag matching when the device path differs', () => {
    // e.g. file placed on device by another tool, but USB scan read its tags
    const dev = deviceTrack('/Volumes/WALKMAN/MUSIC/misc/track01.mp3', {
      title: 'Hells Bells',
      artist: 'AC/DC',
      album: 'Back in Black',
    });
    const plan = computeSyncPlan([libTrack], [dev]);
    expect(plan.matched).toEqual([{ library: libTrack, device: dev }]);
    expect(plan.toDelete).toEqual([]);
  });

  it('does not tag-match when device tags are empty (MTP scan)', () => {
    const dev = deviceTrack('/Volumes/WALKMAN/MUSIC/misc/track01.mp3');
    const plan = computeSyncPlan([libTrack], [dev]);
    expect(plan.matched).toEqual([]);
    expect(plan.toDelete).toEqual([dev]);
  });

  it('never matches one device file to multiple library tracks', () => {
    const lib2 = track({
      filePath: '/lib/hells-bells-live.mp3',
      fileName: 'Hells Bells.mp3',
      title: 'Hells Bells',
      artist: 'AC/DC',
      album: 'Back in Black',
      trackNumber: 1,
    });
    const dev = deviceTrack('/Volumes/WALKMAN/MUSIC/AC_DC/Back in Black/01 Hells Bells.mp3');
    const plan = computeSyncPlan([libTrack, lib2], [dev]);
    expect(plan.matched).toHaveLength(1);
    expect(plan.toTransfer).toHaveLength(1);
  });

  it('handles a mixed realistic scenario', () => {
    const libOnDevice = libTrack;
    const libMissing = track({
      filePath: '/lib/shoot.mp3',
      fileName: 'Shoot to Thrill.mp3',
      title: 'Shoot to Thrill',
      artist: 'AC/DC',
      album: 'Back in Black',
      trackNumber: 2,
    });
    const devMatched = deviceTrack(
      '/Volumes/WALKMAN/MUSIC/AC_DC/Back in Black/01 Hells Bells.mp3'
    );
    const devStale = deviceTrack('/Volumes/WALKMAN/MUSIC/Old Artist/Old Album/gone.mp3');

    const plan = computeSyncPlan([libOnDevice, libMissing], [devMatched, devStale]);
    expect(plan.toTransfer).toEqual([libMissing]);
    expect(plan.toDelete).toEqual([devStale]);
    expect(plan.matched).toEqual([{ library: libOnDevice, device: devMatched }]);
  });
});
