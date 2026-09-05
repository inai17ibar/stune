import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock child_process（`/sbin/mount` の実行）
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => ''),
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
import { execFileSync } from 'child_process';
import { isMtpCliAvailable, getMtpDevices } from '../mtp';

const ROOT_MOUNT_LINE =
  '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)';

/**
 * `/sbin/mount` の出力をモックする。
 * 例: mockMountTable({ '/Volumes/NAS': 'smbfs' })
 */
function mockMountTable(fsTypeByMountPoint: Record<string, string>) {
  const lines = Object.entries(fsTypeByMountPoint).map(
    ([mountPoint, fsType]) =>
      `//guest@nas._smb._tcp.local/share on ${mountPoint} (${fsType}, nodev, nosuid, mounted by me)`
  );
  vi.mocked(execFileSync).mockReturnValue(
    [ROOT_MOUNT_LINE, ...lines].join('\n')
  );
}

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
  // Default: /Volumes 配下にネットワークマウントは無い
  mockMountTable({});
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
    mockMountTable({ '/Volumes/MyDevice': 'msdos' });

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('MyDevice');
  });

  it('excludes network volume with MUSIC folder', async () => {
    mockVolumes([
      { name: 'NAS_Share', isDir: true, hasMusicFolder: true },
    ]);
    mockMountTable({ '/Volumes/NAS_Share': 'smbfs' });

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });

  it.each(['nfs', 'afpfs', 'cifs', 'webdav', 'webdavfs', 'ftp'])(
    'excludes %s network volumes',
    async (fsType) => {
      mockVolumes([
        { name: 'NetworkDrive', isDir: true, hasMusicFolder: true },
      ]);
      mockMountTable({ '/Volumes/NetworkDrive': fsType });

      const devices = await getConnectedWalkman();
      expect(devices).toHaveLength(0);
    }
  );

  it('excludes a network share even when its name matches a Walkman', async () => {
    // NAS 上の共有フォルダを "WALKMAN" という名前でマウントしているケース
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    mockMountTable({ '/Volumes/WALKMAN': 'smbfs' });

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });

  it('excludes a network share whose name looks like an SD card', async () => {
    mockVolumes([{ name: 'SD_CARD', isDir: true, hasMusicFolder: true }]);
    mockMountTable({ '/Volumes/SD_CARD': 'nfs' });

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });

  it('keeps a local volume mounted next to a network share', async () => {
    mockVolumes([
      { name: 'WALKMAN', isDir: true, hasMusicFolder: true },
      { name: 'NAS_Music', isDir: true, hasMusicFolder: true },
    ]);
    mockMountTable({
      '/Volumes/WALKMAN': 'exfat',
      '/Volumes/NAS_Music': 'smbfs',
    });

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
    expect(devices[0].mountPath).toBe('/Volumes/WALKMAN');
  });

  it('handles volume names containing spaces', async () => {
    mockVolumes([{ name: 'My NAS on Air', isDir: true, hasMusicFolder: true }]);
    mockMountTable({ '/Volumes/My NAS on Air': 'smbfs' });

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(0);
  });

  it('keeps the device visible when the mount table is unavailable', async () => {
    // macOS 以外や mount が実行できない環境では判定不能 → 隠さない
    mockVolumes([{ name: 'WALKMAN', isDir: true, hasMusicFolder: true }]);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const devices = await getConnectedWalkman();
    expect(devices).toHaveLength(1);
  });

  it('runs mount only once per scan', async () => {
    mockVolumes([
      { name: 'WALKMAN', isDir: true, hasMusicFolder: true },
      { name: 'SD_CARD', isDir: true, hasMusicFolder: false },
      { name: 'NAS_Music', isDir: true, hasMusicFolder: true },
    ]);
    mockMountTable({ '/Volumes/NAS_Music': 'smbfs' });
    vi.mocked(execFileSync).mockClear();

    await getConnectedWalkman();

    expect(execFileSync).toHaveBeenCalledTimes(1);
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
