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
}));

import { getConnectedWalkman } from '../device';
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
