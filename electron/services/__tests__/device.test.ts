import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(() => 'hfs\n'),
}));

// Mock MTP service
vi.mock('../mtp', () => ({
  getMtpDevices: vi.fn(async () => []),
  isMtpCliAvailable: vi.fn(() => false),
  isMtpPath: (p: string) => p.startsWith('mtp://'),
}));

import {
  getConnectedWalkman,
  markDeviceEjected,
  refreshDevices,
  resetEjectedDevices,
  watchDevices,
  stopWatchingDevices,
} from '../device';
import { execSync } from 'child_process';
import { isMtpCliAvailable, getMtpDevices } from '../mtp';

// Helper to mock /Volumes directory listing
function mockVolumes(
  entries: Array<{ name: string; isDir: boolean; hasMusicFolder?: boolean }>
) {
  // Mock readdir
  vi.spyOn(fs.promises, 'readdir').mockResolvedValue(
    entries.map((e) => ({
      name: e.name,
      isDirectory: () => e.isDir,
      isSymbolicLink: () => false,
      isFile: () => !e.isDir,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      parentPath: '/Volumes',
      path: '/Volumes',
    })) as any
  );

  // Mock stat for MUSIC folder check
  vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
    const pathStr = p.toString();
    for (const entry of entries) {
      const musicPath1 = path.join('/Volumes', entry.name, 'MUSIC');
      const musicPath2 = path.join('/Volumes', entry.name, 'Music');
      if ((pathStr === musicPath1 || pathStr === musicPath2) && entry.hasMusicFolder) {
        return { isDirectory: () => true } as any;
      }
    }
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: stat returns hfs (not network)
  vi.mocked(execSync).mockReturnValue('hfs\n');
  vi.mocked(isMtpCliAvailable).mockReturnValue(false);
  resetEjectedDevices();
  stopWatchingDevices();
});

describe('getConnectedWalkman', () => {
  it('detects volume with WALKMAN in name', async () => {
    mockVolumes([
      { name: 'WALKMAN', isDir: true, hasMusicFolder: true },
    ]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('WALKMAN');
    expect(devices[0].mountPath).toBe('/Volumes/WALKMAN');
    expect(devices[0].isWalkman).toBe(true);
  });

  it('detects NW-A300 series by name', async () => {
    mockVolumes([
      { name: 'NW-A306', isDir: true, hasMusicFolder: false },
    ]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('NW-A306');
  });

  it('detects SD card by volume name', async () => {
    mockVolumes([
      { name: 'SD_CARD', isDir: true, hasMusicFolder: false },
    ]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('SD_CARD (SD Card)');
  });

  it('detects volume with MUSIC folder (non-network)', async () => {
    mockVolumes([
      { name: 'MyDevice', isDir: true, hasMusicFolder: true },
    ]);
    vi.mocked(execSync).mockReturnValue('hfs\n');

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('MyDevice');
  });

  it('excludes network volume with MUSIC folder', async () => {
    mockVolumes([
      { name: 'NAS_Share', isDir: true, hasMusicFolder: true },
    ]);
    vi.mocked(execSync).mockReturnValue('smbfs\n');

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });

  it('excludes NFS network volumes', async () => {
    mockVolumes([
      { name: 'NetworkDrive', isDir: true, hasMusicFolder: true },
    ]);
    vi.mocked(execSync).mockReturnValue('nfs\n');

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });

  it('excludes boot volume even with Music folder', async () => {
    mockVolumes([
      { name: 'Macintosh HD', isDir: true, hasMusicFolder: true },
    ]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });

  it('ignores non-directory entries', async () => {
    mockVolumes([
      { name: 'WALKMAN', isDir: false, hasMusicFolder: false },
    ]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });

  it('returns empty array when no devices found', async () => {
    mockVolumes([]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });

  it('detects multiple devices simultaneously', async () => {
    mockVolumes([
      { name: 'WALKMAN', isDir: true, hasMusicFolder: true },
      { name: 'SD_CARD', isDir: true, hasMusicFolder: false },
    ]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(2);
    expect(devices.map((d) => d.name)).toContain('WALKMAN');
    expect(devices.find((d) => d.name.includes('SD_CARD'))).toBeDefined();
  });

  it('includes MTP devices when mtp-cli is available', async () => {
    mockVolumes([]);
    vi.mocked(isMtpCliAvailable).mockReturnValue(true);
    vi.mocked(getMtpDevices).mockResolvedValue([
      { name: 'NW-A306 (MTP)', mountPath: 'mtp://0', isWalkman: true },
    ] as any);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('NW-A306 (MTP)');
    expect(devices[0].isMtp).toBe(true);
  });

  it('combines USB and MTP devices', async () => {
    mockVolumes([
      { name: 'WALKMAN', isDir: true, hasMusicFolder: true },
    ]);
    vi.mocked(isMtpCliAvailable).mockReturnValue(true);
    vi.mocked(getMtpDevices).mockResolvedValue([
      { name: 'NW-ZX707 (MTP)', mountPath: 'mtp://0', isWalkman: true },
    ] as any);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(2);
    const names = devices.map((d) => d.name);
    expect(names).toContain('WALKMAN');
    expect(names).toContain('NW-ZX707 (MTP)');
  });

  it('handles MTP error gracefully, still returns USB devices', async () => {
    mockVolumes([
      { name: 'WALKMAN', isDir: true, hasMusicFolder: true },
    ]);
    vi.mocked(isMtpCliAvailable).mockReturnValue(true);
    vi.mocked(getMtpDevices).mockRejectedValue(new Error('MTP failed'));

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('WALKMAN');
  });

  it('SONY volume name is detected as Walkman', async () => {
    mockVolumes([
      { name: 'SONY', isDir: true, hasMusicFolder: true },
    ]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
  });

  it('volume without MUSIC folder and no name match is ignored', async () => {
    mockVolumes([
      { name: 'MyUSBDrive', isDir: true, hasMusicFolder: false },
    ]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });
});

// `/sbin/mount` の出力を模す。それ以外のコマンド（diskutil info）は空を返す。
function mockMountOutput(lines: string[]) {
  vi.mocked(execSync).mockImplementation(((cmd: string) => {
    if (cmd.includes('mount')) return `${lines.join('\n')}\n`;
    return '';
  }) as any);
}

const LOCAL_USB_LINE =
  '/dev/disk4s1 on /Volumes/WALKMAN (msdos, local, nodev, nosuid, noowners)';

describe('network volume detection via /sbin/mount', () => {
  it('excludes an SMB share even when its name looks like a Walkman', async () => {
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    mockMountOutput([
      '//guest@nas._smb._tcp.local/Music on /Volumes/WALKMAN (smbfs, nodev, nosuid, read-only, mounted by me)',
    ]);

    expect(await getConnectedWalkman()).toHaveLength(0);
  });

  it.each([
    ['smbfs', '//guest@nas/Music on /Volumes/Share (smbfs, nodev, nosuid)'],
    ['nfs', 'nas:/export/music on /Volumes/Share (nfs, nodev, nosuid)'],
    ['afpfs', 'afp_x on /Volumes/Share (afpfs, nodev, nosuid)'],
    ['webdav', 'https://dav.example on /Volumes/Share (webdav, nodev, nosuid)'],
  ])('excludes %s mounts with a Music folder', async (_type, mountLine) => {
    mockVolumes([{ name: 'Share', isDir: true, hasMusicFolder: true }]);
    mockMountOutput([mountLine]);

    expect(await getConnectedWalkman()).toHaveLength(0);
  });

  it('keeps a local USB volume listed in mount output', async () => {
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    mockMountOutput([
      '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
      LOCAL_USB_LINE,
    ]);

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].mountPath).toBe('/Volumes/WALKMAN');
  });

  it('handles volume names containing spaces and " on "', async () => {
    mockVolumes([{ name: 'Music on Tour', isDir: true, hasMusicFolder: true }]);
    mockMountOutput([
      '//guest@nas/Music on /Volumes/Music on Tour (smbfs, nodev, nosuid)',
    ]);

    expect(await getConnectedWalkman()).toHaveLength(0);
  });

  it('keeps detecting devices when mount fails (falls back to diskutil)', async () => {
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    vi.mocked(execSync).mockImplementation(((cmd: string) => {
      if (cmd.includes('mount')) throw new Error('mount not found');
      return 'Protocol: USB\n';
    }) as any);

    expect(await getConnectedWalkman()).toHaveLength(1);
  });

  it('excludes a volume whose diskutil Protocol is SMB (mount unavailable)', async () => {
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    vi.mocked(execSync).mockImplementation(((cmd: string) => {
      if (cmd.includes('mount')) throw new Error('mount not found');
      return '   Protocol:                  SMB\n';
    }) as any);

    expect(await getConnectedWalkman()).toHaveLength(0);
  });

  it('runs mount only once per detection cycle', async () => {
    mockVolumes([
      { name: 'WALKMAN', isDir: true, hasMusicFolder: true },
      { name: 'SD_CARD', isDir: true, hasMusicFolder: false },
      { name: 'Share', isDir: true, hasMusicFolder: true },
    ]);
    mockMountOutput([
      LOCAL_USB_LINE,
      '/dev/disk5s1 on /Volumes/SD_CARD (msdos, local, nodev)',
      '//guest@nas/Music on /Volumes/Share (smbfs, nodev, nosuid)',
    ]);

    vi.mocked(execSync).mockClear();
    const devices = await getConnectedWalkman();

    expect(devices).toHaveLength(2);
    expect(vi.mocked(execSync)).toHaveBeenCalledTimes(1);
  });
});

describe('markDeviceEjected', () => {
  it('hides an ejected USB volume that is still mounted', async () => {
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);

    markDeviceEjected('/Volumes/WALKMAN');

    expect(await getConnectedWalkman()).toHaveLength(0);
  });

  it('keeps other volumes visible when one is ejected', async () => {
    mockVolumes([
      { name: 'WALKMAN', isDir: true, hasMusicFolder: true },
      { name: 'SD_CARD', isDir: true, hasMusicFolder: false },
    ]);

    markDeviceEjected('/Volumes/WALKMAN');

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].mountPath).toBe('/Volumes/SD_CARD');
  });

  it('shows the volume again after it is unmounted and reconnected', async () => {
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    markDeviceEjected('/Volumes/WALKMAN');
    expect(await getConnectedWalkman()).toHaveLength(0);

    // アンマウントされた（= 取り出し完了）
    mockVolumes([]);
    expect(await getConnectedWalkman()).toHaveLength(0);

    // 再接続
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    expect(await getConnectedWalkman()).toHaveLength(1);
  });

  it('hides every storage of an ejected MTP device', async () => {
    mockVolumes([]);
    vi.mocked(isMtpCliAvailable).mockReturnValue(true);
    vi.mocked(getMtpDevices).mockResolvedValue([
      { name: 'NW-A306 (内蔵)', mountPath: 'mtp://65537', isWalkman: true },
      { name: 'NW-A306 (SDカード)', mountPath: 'mtp://65538', isWalkman: true },
    ] as any);

    // 内蔵ストレージを取り出す → デバイスごと（SD カードも）一覧から消える
    markDeviceEjected('mtp://65537');

    expect(await getConnectedWalkman()).toHaveLength(0);
  });

  it('keeps an ejected MTP device hidden while the cable stays connected', async () => {
    mockVolumes([]);
    vi.mocked(isMtpCliAvailable).mockReturnValue(true);
    vi.mocked(getMtpDevices).mockResolvedValue([
      { name: 'NW-A306', mountPath: 'mtp://65537', isWalkman: true },
    ] as any);

    markDeviceEjected('mtp://65537');

    // ポーリングが何度走っても復活しない（旧実装のバグ）
    expect(await getConnectedWalkman()).toHaveLength(0);
    expect(await getConnectedWalkman()).toHaveLength(0);
  });

  it('shows an MTP device again after the cable is unplugged and reconnected', async () => {
    mockVolumes([]);
    vi.mocked(isMtpCliAvailable).mockReturnValue(true);
    vi.mocked(getMtpDevices).mockResolvedValue([
      { name: 'NW-A306', mountPath: 'mtp://65537', isWalkman: true },
    ] as any);
    markDeviceEjected('mtp://65537');
    expect(await getConnectedWalkman()).toHaveLength(0);

    // ケーブルを抜いた → MTP デバイスが検出されなくなる
    vi.mocked(getMtpDevices).mockResolvedValue([]);
    expect(await getConnectedWalkman()).toHaveLength(0);

    // 繋ぎ直した
    vi.mocked(getMtpDevices).mockResolvedValue([
      { name: 'NW-A306', mountPath: 'mtp://65537', isWalkman: true },
    ] as any);
    expect(await getConnectedWalkman()).toHaveLength(1);
  });

  it('does not hide USB volumes when an MTP device is ejected', async () => {
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    vi.mocked(isMtpCliAvailable).mockReturnValue(true);
    vi.mocked(getMtpDevices).mockResolvedValue([
      { name: 'NW-A306', mountPath: 'mtp://65537', isWalkman: true },
    ] as any);

    markDeviceEjected('mtp://65537');

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].mountPath).toBe('/Volumes/WALKMAN');
  });
});

describe('refreshDevices', () => {
  it('notifies the watcher immediately after an eject', async () => {
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    const callback = vi.fn();
    watchDevices(callback);
    // watchDevices の初回チェックを待つ
    await Promise.resolve();
    await Promise.resolve();
    callback.mockClear();

    markDeviceEjected('/Volumes/WALKMAN');
    const devices = await refreshDevices();

    expect(devices).toHaveLength(0);
    expect(callback).toHaveBeenCalledWith([]);
  });

  it('notifies even when the device list is unchanged', async () => {
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    const callback = vi.fn();
    watchDevices(callback);
    await refreshDevices();
    callback.mockClear();

    await refreshDevices();

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
