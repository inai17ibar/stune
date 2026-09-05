import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => ''),
}));

import {
  getMountTable,
  isNetworkFsType,
  isNetworkVolume,
  parseMountLine,
  parseMountOutput,
} from '../mounts';
import { execFileSync } from 'child_process';

// 実機（macOS 15）の `/sbin/mount` 出力
const REAL_MOUNT_OUTPUT = [
  '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
  'devfs on /dev (devfs, local, nobrowse)',
  '/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)',
  'map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)',
  '/dev/disk4s1 on /Volumes/WALKMAN (exfat, local, nodev, nosuid, noowners)',
  '//guest@nas._smb._tcp.local/music on /Volumes/music (smbfs, nodev, nosuid, mounted by me)',
  'nas:/export/media on /Volumes/media (nfs, nodev, nosuid, mounted by me)',
].join('\n');

beforeEach(() => {
  vi.mocked(execFileSync).mockReturnValue(REAL_MOUNT_OUTPUT);
});

describe('parseMountLine', () => {
  it('extracts the mount point and filesystem type', () => {
    expect(
      parseMountLine('/dev/disk4s1 on /Volumes/WALKMAN (exfat, local, nodev)')
    ).toEqual({ mountPoint: '/Volumes/WALKMAN', fsType: 'exfat' });
  });

  it('handles an SMB URL as the device', () => {
    expect(
      parseMountLine(
        '//guest@nas._smb._tcp.local/music on /Volumes/music (smbfs, nodev, nosuid)'
      )
    ).toEqual({ mountPoint: '/Volumes/music', fsType: 'smbfs' });
  });

  it('handles a mount point containing " on "', () => {
    expect(
      parseMountLine('/dev/disk5s1 on /Volumes/Music on Tour (hfs, local)')
    ).toEqual({ mountPoint: '/Volumes/Music on Tour', fsType: 'hfs' });
  });

  it('handles a single-option line', () => {
    expect(parseMountLine('nas:/export on /Volumes/media (nfs)')).toEqual({
      mountPoint: '/Volumes/media',
      fsType: 'nfs',
    });
  });

  it('drops a trailing slash from the mount point', () => {
    expect(parseMountLine('/dev/disk4s1 on /Volumes/WALKMAN/ (exfat)')).toEqual({
      mountPoint: '/Volumes/WALKMAN',
      fsType: 'exfat',
    });
  });

  it.each(['', 'garbage', '/dev/disk1 on /Volumes/X', 'on (hfs)'])(
    'returns null for an unparsable line: %s',
    (line) => {
      expect(parseMountLine(line)).toBeNull();
    }
  );
});

describe('parseMountOutput', () => {
  it('maps every mount point to its filesystem type', () => {
    const table = parseMountOutput(REAL_MOUNT_OUTPUT);

    expect(table.get('/')).toBe('apfs');
    expect(table.get('/Volumes/WALKMAN')).toBe('exfat');
    expect(table.get('/Volumes/music')).toBe('smbfs');
    expect(table.get('/Volumes/media')).toBe('nfs');
  });

  it('returns an empty table for empty output', () => {
    expect(parseMountOutput('').size).toBe(0);
  });
});

describe('isNetworkFsType', () => {
  it.each([
    'smbfs',
    'nfs',
    'afpfs',
    'cifs',
    'webdav',
    'webdavfs',
    'ftp',
    'SMBFS',
    'nfsv4',
  ])('treats %s as a network filesystem', (fsType) => {
    expect(isNetworkFsType(fsType)).toBe(true);
  });

  it.each(['apfs', 'hfs', 'exfat', 'msdos', 'ufsd_exfat', 'devfs', ''])(
    'treats %s as a local filesystem',
    (fsType) => {
      expect(isNetworkFsType(fsType)).toBe(false);
    }
  );
});

describe('isNetworkVolume', () => {
  it('detects an SMB mount', () => {
    expect(isNetworkVolume('/Volumes/music')).toBe(true);
  });

  it('detects an NFS mount', () => {
    expect(isNetworkVolume('/Volumes/media')).toBe(true);
  });

  it('does not flag a local USB volume', () => {
    expect(isNetworkVolume('/Volumes/WALKMAN')).toBe(false);
  });

  it('ignores a trailing slash', () => {
    expect(isNetworkVolume('/Volumes/music/')).toBe(true);
  });

  it('returns false for an unknown mount point', () => {
    expect(isNetworkVolume('/Volumes/NotMounted')).toBe(false);
  });

  it('returns false for an empty path without running mount', () => {
    vi.mocked(execFileSync).mockClear();

    expect(isNetworkVolume('')).toBe(false);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('reuses a pre-built mount table instead of running mount', () => {
    const table = getMountTable();
    vi.mocked(execFileSync).mockClear();

    expect(isNetworkVolume('/Volumes/music', table)).toBe(true);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('falls back to local when mount cannot be executed', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('spawn /sbin/mount ENOENT');
    });

    expect(isNetworkVolume('/Volumes/music')).toBe(false);
    expect(getMountTable().size).toBe(0);
  });
});
