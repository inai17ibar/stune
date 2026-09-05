import { describe, it, expect, vi, beforeEach } from 'vitest';

// diskutil / mount の実行をモック（テストは CI の Linux でも走る）
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => ''),
}));

vi.mock('../mtp', () => ({
  isMtpPath: (p: string) => p.startsWith('mtp://'),
  mtpDisconnect: vi.fn(() => 0),
}));

vi.mock('../device', () => ({
  markDeviceEjected: vi.fn(),
}));

import { ejectDevice } from '../eject';
import { execFile, execFileSync } from 'child_process';
import { mtpDisconnect } from '../mtp';
import { markDeviceEjected } from '../device';

type ExecResult = { error?: Error; stdout?: string; stderr?: string };

/** diskutil の呼び出し引数（"eject" / "info" など）ごとに応答を差し替える */
function mockDiskutil(
  responder: (args: string[]) => ExecResult
): { calls: string[][] } {
  const calls: string[][] = [];
  vi.mocked(execFile).mockImplementation((...params: any[]) => {
    const args = params[1] as string[];
    const callback = params[params.length - 1] as (
      err: Error | null,
      stdout: string,
      stderr: string
    ) => void;
    calls.push(args);
    const res = responder(args);
    callback(res.error ?? null, res.stdout ?? '', res.stderr ?? '');
    return {} as any;
  });
  return { calls };
}

const BUSY_OUTPUT =
  'Unmount failed for /Volumes/WALKMAN\nVolume WALKMAN on disk4s1 failed to unmount: dissented by PID 123 (Finder)';

/** `/sbin/mount` の出力をモックして、指定パスをネットワークマウントに見せる */
function mockNetworkMount(mountPoint: string, fsType = 'smbfs') {
  vi.mocked(execFileSync).mockReturnValue(
    `//guest@nas._smb._tcp.local/share on ${mountPoint} (${fsType}, nodev, nosuid)`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 既定ではローカルボリューム（mount の出力にマウントポイントが現れない）
  vi.mocked(execFileSync).mockReturnValue('');
});

describe('ejectDevice — USB volume', () => {
  it('ejects a mounted volume with diskutil eject', async () => {
    const { calls } = mockDiskutil((args) =>
      args[0] === 'info'
        ? { stdout: 'Part of Whole:  disk4\n' }
        : { stdout: 'Disk /Volumes/WALKMAN ejected\n' }
    );

    const result = await ejectDevice('/Volumes/WALKMAN');

    expect(result.success).toBe(true);
    expect(result.message).toContain('取り出しました');
    expect(calls).toContainEqual(['eject', '/Volumes/WALKMAN']);
    expect(markDeviceEjected).toHaveBeenCalledWith('/Volumes/WALKMAN');
  });

  it('normalizes a trailing slash before ejecting', async () => {
    const { calls } = mockDiskutil(() => ({ stdout: 'ok' }));

    const result = await ejectDevice('/Volumes/WALKMAN/');

    expect(result.success).toBe(true);
    expect(calls).toContainEqual(['eject', '/Volumes/WALKMAN']);
  });

  it('falls back to force unmount when the volume is busy', async () => {
    const { calls } = mockDiskutil((args) => {
      if (args[0] === 'info') return { stdout: 'Part of Whole:  disk4\n' };
      if (args[0] === 'unmount') return { stdout: 'Forced unmount ... successful' };
      if (args[1] === '/dev/disk4') return { stdout: 'ejected' };
      return { error: new Error('exit 1'), stdout: BUSY_OUTPUT };
    });

    const result = await ejectDevice('/Volumes/WALKMAN');

    expect(result.success).toBe(true);
    expect(result.message).toContain('強制的に取り出しました');
    expect(calls).toContainEqual(['unmount', 'force', '/Volumes/WALKMAN']);
    // 強制アンマウント後はマウントポイントが消えるので物理ディスクを取り出す
    expect(calls).toContainEqual(['eject', '/dev/disk4']);
    expect(markDeviceEjected).toHaveBeenCalledWith('/Volumes/WALKMAN');
  });

  it('reports a helpful message when even force unmount fails', async () => {
    mockDiskutil((args) => {
      if (args[0] === 'info') return { stdout: 'Part of Whole:  disk4\n' };
      return { error: new Error('exit 1'), stdout: BUSY_OUTPUT };
    });

    const result = await ejectDevice('/Volumes/WALKMAN');

    expect(result.success).toBe(false);
    expect(result.message).toContain('使用中');
    expect(markDeviceEjected).not.toHaveBeenCalled();
  });

  // 実機の diskutil 出力（macOS 15）を固定
  it.each([
    'Failed to find disk /Volumes/WALKMAN',
    'Could not find disk: /Volumes/WALKMAN',
  ])('treats an already-unmounted volume as success: %s', async (output) => {
    mockDiskutil(() => ({ error: new Error('exit 1'), stdout: output }));

    const result = await ejectDevice('/Volumes/WALKMAN');

    expect(result.success).toBe(true);
    expect(result.message).toContain('すでに取り出されています');
    expect(markDeviceEjected).toHaveBeenCalledWith('/Volumes/WALKMAN');
  });

  it('resolves the physical disk from real diskutil info output', async () => {
    const { calls } = mockDiskutil((args) => {
      if (args[0] === 'info') {
        return {
          stdout: [
            '   Device Identifier:         disk5s1',
            '   Device Node:               /dev/disk5s1',
            '   Part of Whole:             disk5',
            '   Mount Point:               /Volumes/WALKMAN',
          ].join('\n'),
        };
      }
      if (args[0] === 'unmount') return { stdout: 'Forced unmount ... successful' };
      if (args[1] === '/dev/disk5') return { stdout: 'ejected' };
      return { error: new Error('exit 1'), stdout: BUSY_OUTPUT };
    });

    const result = await ejectDevice('/Volumes/WALKMAN');

    expect(result.success).toBe(true);
    expect(calls).toContainEqual(['eject', '/dev/disk5']);
  });

  it('surfaces the first line of an unexpected diskutil error', async () => {
    mockDiskutil((args) =>
      args[0] === 'info'
        ? { stdout: 'Part of Whole:  disk4\n' }
        : { error: new Error('exit 1'), stderr: 'Ejection failed\nmore detail' }
    );

    const result = await ejectDevice('/Volumes/WALKMAN');

    expect(result.success).toBe(false);
    expect(result.message).toBe('取り出しに失敗しました: Ejection failed');
  });

  it('still succeeds when diskutil info cannot resolve the physical disk', async () => {
    const { calls } = mockDiskutil((args) => {
      if (args[0] === 'info') return { error: new Error('exit 1'), stdout: '' };
      if (args[0] === 'unmount') return { stdout: 'Forced unmount ... successful' };
      return { error: new Error('exit 1'), stdout: BUSY_OUTPUT };
    });

    const result = await ejectDevice('/Volumes/WALKMAN');

    expect(result.success).toBe(true);
    expect(calls.filter((c) => c[0] === 'eject')).toEqual([
      ['eject', '/Volumes/WALKMAN'],
    ]);
  });
});

describe('ejectDevice — network volume', () => {
  it('unmounts instead of ejecting (diskutil eject fails on SMB)', async () => {
    mockNetworkMount('/Volumes/NAS_Music');
    const { calls } = mockDiskutil(() => ({
      stdout: 'Volume NAS_Music on disk0s0 unmounted',
    }));

    const result = await ejectDevice('/Volumes/NAS_Music');

    expect(result.success).toBe(true);
    expect(result.message).toContain('ネットワークボリュームを切断しました');
    expect(calls).toContainEqual(['unmount', '/Volumes/NAS_Music']);
    expect(calls.some((c) => c[0] === 'eject')).toBe(false);
    expect(markDeviceEjected).toHaveBeenCalledWith('/Volumes/NAS_Music');
  });

  it('treats an already-unmounted network volume as success', async () => {
    mockNetworkMount('/Volumes/NAS_Music', 'nfs');
    mockDiskutil(() => ({
      error: new Error('exit 1'),
      stdout: 'Could not find disk: /Volumes/NAS_Music',
    }));

    const result = await ejectDevice('/Volumes/NAS_Music');

    expect(result.success).toBe(true);
    expect(markDeviceEjected).toHaveBeenCalledWith('/Volumes/NAS_Music');
  });

  it('reports an unmount failure', async () => {
    mockNetworkMount('/Volumes/NAS_Music');
    mockDiskutil(() => ({
      error: new Error('exit 1'),
      stderr: 'Unmount failed\nmore detail',
    }));

    const result = await ejectDevice('/Volumes/NAS_Music');

    expect(result.success).toBe(false);
    expect(result.message).toBe(
      'ネットワークボリュームの切断に失敗しました: Unmount failed'
    );
    expect(markDeviceEjected).not.toHaveBeenCalled();
  });
});

describe('ejectDevice — path validation', () => {
  it.each([
    ['/', 'root'],
    ['/Users/me/Music', 'home folder'],
    ['/Volumes', '/Volumes itself'],
    ['/Volumes/WALKMAN/MUSIC', 'subfolder of a volume'],
    ['', 'empty path'],
  ])('refuses to eject %s (%s)', async (mountPath) => {
    mockDiskutil(() => ({ stdout: 'ok' }));

    const result = await ejectDevice(mountPath);

    expect(result.success).toBe(false);
    expect(execFile).not.toHaveBeenCalled();
    expect(markDeviceEjected).not.toHaveBeenCalled();
  });

  it('names the rejected path in the error message', async () => {
    mockDiskutil(() => ({ stdout: 'ok' }));

    const result = await ejectDevice('/');

    expect(result.message).toBe(
      '取り出せるのは /Volumes 以下のボリュームのみです: /'
    );
  });
});

describe('ejectDevice — MTP device', () => {
  it('disconnects the MTP session and asks the user to unplug the cable', async () => {
    mockDiskutil(() => ({ stdout: 'ok' }));

    const result = await ejectDevice('mtp://65537');

    expect(result.success).toBe(true);
    expect(result.requiresManualDisconnect).toBe(true);
    expect(result.message).toContain('USB ケーブルを抜いてください');
    expect(mtpDisconnect).toHaveBeenCalled();
    // MTP はケーブルを抜くまで検出され続けるので、一覧から抑制する必要がある
    expect(markDeviceEjected).toHaveBeenCalledWith('mtp://65537');
    // diskutil は MTP には使わない
    expect(execFile).not.toHaveBeenCalled();
  });
});
