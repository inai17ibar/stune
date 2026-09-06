import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

import {
  parseMountTable,
  isNetworkFsType,
  isNetworkProtocolOutput,
  isNetworkVolume,
  readMountTable,
} from '../volumeInfo';
import { execSync } from 'child_process';

// macOS 15 の実際の `/sbin/mount` 出力
const REAL_MOUNT_OUTPUT = [
  '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
  'devfs on /dev (devfs, local, nobrowse)',
  '/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)',
  'map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)',
  '/dev/disk4s1 on /Volumes/WALKMAN (msdos, local, nodev, nosuid, noowners)',
  '//guest@nas._smb._tcp.local/music on /Volumes/music (smbfs, nodev, nosuid, mounted by me)',
  'nas:/export/media on /Volumes/media (nfs, nodev, nosuid, mounted by me)',
  '',
].join('\n');

beforeEach(() => {
  vi.mocked(execSync).mockReturnValue('' as any);
});

describe('parseMountTable', () => {
  it('maps each mount point to its filesystem type', () => {
    const table = parseMountTable(REAL_MOUNT_OUTPUT);

    expect(table.get('/')).toBe('apfs');
    expect(table.get('/Volumes/WALKMAN')).toBe('msdos');
    expect(table.get('/Volumes/music')).toBe('smbfs');
    expect(table.get('/Volumes/media')).toBe('nfs');
  });

  it('handles mount points containing spaces', () => {
    const table = parseMountTable(
      '/dev/disk5s1 on /Volumes/SD CARD (exfat, local, nodev, nosuid)'
    );

    expect(table.get('/Volumes/SD CARD')).toBe('exfat');
  });

  it('ignores lines that are not mount entries', () => {
    const table = parseMountTable('mount: not superuser\n\n');

    expect(table.size).toBe(0);
  });

  it('returns an empty table for empty output', () => {
    expect(parseMountTable('').size).toBe(0);
  });
});

describe('isNetworkFsType', () => {
  it.each(['smbfs', 'nfs', 'afpfs', 'cifs', 'webdav', 'ftp', 'sshfs', 'autofs'])(
    'treats %s as a network filesystem',
    (fsType) => {
      expect(isNetworkFsType(fsType)).toBe(true);
    }
  );

  it.each(['apfs', 'hfs', 'msdos', 'exfat', 'ntfs', 'devfs'])(
    'treats %s as a local filesystem',
    (fsType) => {
      expect(isNetworkFsType(fsType)).toBe(false);
    }
  );

  it('is case-insensitive', () => {
    expect(isNetworkFsType('SMBFS')).toBe(true);
  });
});

describe('isNetworkProtocolOutput', () => {
  it.each(['SMB', 'AFP', 'NFS'])(
    'detects the %s protocol in diskutil info output',
    (protocol) => {
      const output = [
        '   Device Identifier:         disk4s1',
        `   Protocol:                  ${protocol}`,
        '   Mount Point:               /Volumes/share',
      ].join('\n');

      expect(isNetworkProtocolOutput(output)).toBe(true);
    }
  );

  it('does not flag a USB disk', () => {
    expect(isNetworkProtocolOutput('   Protocol:                  USB\n')).toBe(
      false
    );
  });

  it('returns false when there is no Protocol field', () => {
    expect(isNetworkProtocolOutput('Part of Whole: disk4\n')).toBe(false);
  });
});

describe('readMountTable', () => {
  it('runs /sbin/mount and parses its output', () => {
    vi.mocked(execSync).mockReturnValue(REAL_MOUNT_OUTPUT as any);

    const table = readMountTable();

    expect(vi.mocked(execSync).mock.calls[0][0]).toBe('/sbin/mount');
    expect(table.get('/Volumes/music')).toBe('smbfs');
  });

  it('returns an empty table when mount is unavailable', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(readMountTable().size).toBe(0);
  });
});

describe('isNetworkVolume', () => {
  const table = parseMountTable(REAL_MOUNT_OUTPUT);

  it('reports a network mount from the given mount table', () => {
    expect(isNetworkVolume('/Volumes/music', table)).toBe(true);
  });

  it('reports a local USB volume as not network', () => {
    expect(isNetworkVolume('/Volumes/WALKMAN', table)).toBe(false);
  });

  it('ignores a trailing slash', () => {
    expect(isNetworkVolume('/Volumes/music/', table)).toBe(true);
  });

  it('reads the mount table itself when none is given', () => {
    vi.mocked(execSync).mockReturnValue(REAL_MOUNT_OUTPUT as any);

    expect(isNetworkVolume('/Volumes/media')).toBe(true);
  });

  it('falls back to diskutil for a path missing from the mount table', () => {
    vi.mocked(execSync).mockImplementation(((cmd: string) =>
      cmd.includes('diskutil') ? '   Protocol:  SMB\n' : '') as any);

    expect(isNetworkVolume('/Volumes/ghost')).toBe(true);
  });

  it('does not exclude a volume when neither mount nor diskutil knows it', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(isNetworkVolume('/Volumes/ghost')).toBe(false);
  });
});
