import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// mtp-cli の起動をモック（実バイナリ無しでも走る）
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}));

import { spawn } from 'child_process';
import * as fs from 'fs';

/** mtp-cli 1 コマンド分の応答 */
type CliResponse = {
  /** stdout に流す文字列（1行 JSON を想定） */
  stdout?: string;
  /** 非 0 なら応答の直後にプロセスが死ぬ（終了コード） */
  code?: number;
  /** spawn 自体の失敗（バイナリが壊れている等） */
  spawnError?: string;
  /** 応答を返さない（= タイムアウト相当。プロセスが閉じない） */
  hang?: boolean;
};

/**
 * spawn をモックし、送られてきたリクエストごとに応答を差し替える。
 * 常駐プロセスを模す: 1 プロセスが複数コマンドを受け付け、
 * - 'close' は stdin.end() 後（保留中の応答を流し終えてから code 0）、
 * - または非 0 の code を持つ応答の直後、
 * - hang 時は発火しない。
 * 戻り値の配列に、mtp-cli へ渡された JSON リクエストが順に積まれる。
 */
function mockMtpCli(
  responder: (request: any, callIndex: number) => CliResponse
): any[] {
  const requests: any[] = [];

  vi.mocked(spawn).mockImplementation((): any => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let closed = false;
    let hung = false;
    let pending = 0;
    let ended = false;
    const emitClose = (code: number | null) => {
      if (closed) return;
      closed = true;
      child.emit('close', code);
    };
    const maybeCloseAfterEnd = () => {
      if (ended && pending === 0 && !hung) emitClose(0);
    };
    child.kill = vi.fn(() => {
      setTimeout(() => emitClose(null), 0);
      return true;
    });
    child.stdin = new EventEmitter();
    child.stdin.end = () => {
      ended = true;
      setTimeout(maybeCloseAfterEnd, 0);
    };
    child.stdin.write = (data: string, cb?: (err?: Error) => void) => {
      cb?.();
      const request = JSON.parse(data);
      const index = requests.length;
      requests.push(request);
      const res = responder(request, index);
      if (res.hang) {
        hung = true;
        return true;
      }
      pending++;
      setTimeout(() => {
        pending--;
        if (closed) return;
        if (res.spawnError) {
          child.emit('error', new Error(res.spawnError));
          return;
        }
        if (res.stdout) child.stdout.emit('data', Buffer.from(res.stdout));
        if ((res.code ?? 0) !== 0) {
          emitClose(res.code!);
          return;
        }
        maybeCloseAfterEnd();
      }, 0);
      return true;
    };
    return child;
  });

  return requests;
}

/** モジュールキャッシュ（mtp-cli パスのメモ化）を毎回リセットして読み直す */
async function loadMtp() {
  vi.resetModules();
  return await import('../mtp');
}

const okLine = JSON.stringify({ ok: true }) + '\n';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.existsSync).mockReturnValue(true);
});

describe('mtpUpload', () => {
  it('uploads every file and reports success', async () => {
    const { mtpUpload } = await loadMtp();
    const requests = mockMtpCli(() => ({ stdout: okLine }));

    const result = await mtpUpload('mtp://default', ['/a.flac', '/b.flac'], '/MUSIC');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ cmd: 'upload', source: '/a.flac', destination: '/MUSIC' });
    expect(requests[1]).toMatchObject({ cmd: 'upload', source: '/b.flac' });
    // 全ファイルを 1 プロセス / 1 セッションで送る
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('fails when mtp-cli binary is not installed (runMtpCommand returns null)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { mtpUpload } = await loadMtp();
    mockMtpCli(() => ({ stdout: okLine }));

    const result = await mtpUpload('mtp://default', ['/a.flac'], '/MUSIC');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails when mtp-cli exits with a non-zero code', async () => {
    const { mtpUpload } = await loadMtp();
    mockMtpCli(() => ({ stdout: '', code: 1 }));

    const result = await mtpUpload('mtp://default', ['/a.flac'], '/MUSIC');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('fails when spawning mtp-cli errors', async () => {
    const { mtpUpload } = await loadMtp();
    mockMtpCli(() => ({ spawnError: 'EACCES' }));

    const result = await mtpUpload('mtp://default', ['/a.flac'], '/MUSIC');

    expect(result.success).toBe(false);
  });

  it('fails when mtp-cli emits unparsable output', async () => {
    const { mtpUpload } = await loadMtp();
    mockMtpCli(() => ({ stdout: 'not json at all\n' }));

    const result = await mtpUpload('mtp://default', ['/a.flac'], '/MUSIC');

    expect(result.success).toBe(false);
  });

  it('stops at the first failure and does not upload the remaining files', async () => {
    const { mtpUpload } = await loadMtp();
    // 2 ファイル目で mtp-cli がクラッシュ（終了コード非 0 → null）
    const requests = mockMtpCli((_req, i) =>
      i === 1 ? { stdout: '', code: 2 } : { stdout: okLine }
    );

    const result = await mtpUpload(
      'mtp://default',
      ['/a.flac', '/b.flac', '/c.flac'],
      '/MUSIC'
    );

    expect(result.success).toBe(false);
    expect(requests).toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('fails a file whose upload never answers (timeout) and kills the session', async () => {
    vi.useFakeTimers();
    try {
      const { mtpUpload } = await loadMtp();
      const requests = mockMtpCli((_req, i) => (i === 1 ? { hang: true } : { stdout: okLine }));

      const pending = mtpUpload('mtp://default', ['/a.flac', '/b.flac', '/c.flac'], '/MUSIC');
      await vi.advanceTimersByTimeAsync(130000);
      const result = await pending;

      expect(result.success).toBe(false);
      expect(result.error).toContain('b.flac');
      expect(requests).toHaveLength(2);
      const child = vi.mocked(spawn).mock.results[0].value;
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates an error reported in the JSON response', async () => {
    const { mtpUpload } = await loadMtp();
    mockMtpCli(() => ({ stdout: JSON.stringify({ error: 'device full' }) + '\n' }));

    const result = await mtpUpload('mtp://default', ['/a.flac'], '/MUSIC');

    expect(result).toEqual({ success: false, error: 'device full' });
  });

  it('rejects a non-MTP destination', async () => {
    const { mtpUpload } = await loadMtp();
    mockMtpCli(() => ({ stdout: okLine }));

    const result = await mtpUpload('/Volumes/WALKMAN', ['/a.flac'], '/MUSIC');

    expect(result.success).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('openMtpSession', () => {
  it('sends every upload over one process and closes it', async () => {
    const { openMtpSession, mtpDisconnect } = await loadMtp();
    const requests = mockMtpCli(() => ({ stdout: okLine }));

    const session = await openMtpSession('mtp://65537');
    expect(session).not.toBeNull();
    expect(await session!.uploadOne('/a.flac', '/MUSIC/A/X')).toEqual({ ok: true });
    expect(await session!.uploadOne('/b.flac', '/MUSIC/B/Y')).toEqual({ ok: true });
    await session!.close();
    await session!.close(); // 2 回目も安全

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([
      { cmd: 'upload', storageId: '65537', source: '/a.flac', destination: '/MUSIC/A/X' },
      { cmd: 'upload', storageId: '65537', source: '/b.flac', destination: '/MUSIC/B/Y' },
    ]);
    // close 後は何も送らず null
    expect(await session!.uploadOne('/c.flac', '/MUSIC')).toBeNull();
    expect(requests).toHaveLength(2);
    // 終了したプロセスは activeProcesses から外れている
    expect(mtpDisconnect()).toBe(0);
  });

  it('resolves null for the failing and all later commands after the process dies', async () => {
    const { openMtpSession } = await loadMtp();
    const requests = mockMtpCli((_req, i) => (i === 0 ? { stdout: '', code: 1 } : { stdout: okLine }));

    const session = await openMtpSession('mtp://1');
    const [first, second] = await Promise.all([
      session!.uploadOne('/a.flac', '/MUSIC'),
      session!.uploadOne('/b.flac', '/MUSIC'),
    ]);
    await session!.close();

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('is killable via mtpDisconnect while open', async () => {
    const { openMtpSession, mtpDisconnect } = await loadMtp();
    mockMtpCli(() => ({ hang: true }));

    const session = await openMtpSession('mtp://1');
    const pending = session!.uploadOne('/a.flac', '/MUSIC');
    await new Promise((r) => setTimeout(r, 0));

    expect(mtpDisconnect()).toBe(1);
    expect(await pending).toBeNull();
    await session!.close();
  });

  it('returns null for non-MTP paths or a missing binary', async () => {
    const { openMtpSession } = await loadMtp();
    expect(await openMtpSession('/Volumes/WALKMAN')).toBeNull();

    vi.mocked(fs.existsSync).mockReturnValue(false);
    const reloaded = await loadMtp();
    expect(await reloaded.openMtpSession('mtp://1')).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('scanMtpDevice', () => {
  it('scans storages and the whole tree over a single process', async () => {
    const { scanMtpDevice } = await loadMtp();
    const dir = (fullPath: string) => ({
      objectId: 1, name: fullPath.split('/').pop(), fullPath, size: 0, isDir: true,
    });
    const file = (fullPath: string, size = 100) => ({
      objectId: 2, name: fullPath.split('/').pop(), fullPath, size, isDir: false,
    });
    const tree: Record<string, any[]> = {
      // /MUSIC が空 → '/' から辿る
      '/MUSIC': [],
      '/': [dir('/A'), dir('/B'), file('/readme.txt')],
      '/A': [file('/A/one.flac', 10), file('/A/cover.jpg')],
      '/B': [file('/B/two.mp3', 20)],
    };
    const requests = mockMtpCli((req) => {
      if (req.cmd === 'list_storages') {
        return {
          stdout: JSON.stringify({
            deviceName: 'NW-A306',
            storages: [{ storageId: '65537', description: '', maxCapacity: 1000, freeSpaceInBytes: 400 }],
          }) + '\n',
        };
      }
      return { stdout: JSON.stringify({ files: tree[req.path] ?? [] }) + '\n' };
    });

    const result = await scanMtpDevice('mtp://65537');

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(requests.map((r) => r.cmd === 'list_storages' ? r.cmd : r.path)).toEqual([
      'list_storages', '/MUSIC', '/', '/A', '/B',
    ]);
    expect(requests.slice(1).every((r) => r.storageId === '65537')).toBe(true);
    expect(result).toMatchObject({
      name: 'NW-A306',
      mountPath: 'mtp://65537',
      musicPath: 'mtp://65537/MUSIC',
      totalSpace: 1000,
      freeSpace: 400,
      usedSpace: 600,
    });
    expect(result.tracks.map((t) => [t.filePath, t.title, t.format, t.fileSize])).toEqual([
      ['mtp://65537/A/one.flac', 'one', 'flac', 10],
      ['mtp://65537/B/two.mp3', 'two', 'mp3', 20],
    ]);
    expect(result.albums).toHaveLength(1);
    expect(result.albums[0]).toMatchObject({ name: 'Unknown Album' });
    expect(result.albums[0].tracks).toHaveLength(2);
  });

  it('throws when the storage is not found, and still closes the session', async () => {
    const { scanMtpDevice, mtpDisconnect } = await loadMtp();
    mockMtpCli(() => ({ stdout: JSON.stringify({ storages: [] }) + '\n' }));

    await expect(scanMtpDevice('mtp://9')).rejects.toThrow('MTP device not found');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(mtpDisconnect()).toBe(0);
  });
});

describe('mtpUpload progress reporting', () => {
  it('never reports 100% before the last upload finished', async () => {
    const { mtpUpload } = await loadMtp();
    const timeline: string[] = [];
    const total = 3;

    mockMtpCli((req) => {
      timeline.push(`upload-start:${req.source}`);
      return { stdout: okLine };
    });

    await mtpUpload(
      'mtp://default',
      ['/a.flac', '/b.flac', '/c.flac'],
      '/MUSIC',
      (current, tot, file) => {
        expect(tot).toBe(total);
        timeline.push(`progress:${current}:${file}`);
      }
    );

    // 完了通知 (current === total) は最後のアップロード開始より後に来ること
    const completeIndex = timeline.indexOf(`progress:${total}:/c.flac`);
    const lastStartIndex = timeline.lastIndexOf('upload-start:/c.flac');
    expect(completeIndex).toBeGreaterThan(-1);
    expect(lastStartIndex).toBeGreaterThan(-1);
    expect(completeIndex).toBeGreaterThan(lastStartIndex);
  });

  it('does not report progress for a file whose upload failed', async () => {
    const { mtpUpload } = await loadMtp();
    const progress = vi.fn();

    mockMtpCli((_req, i) => (i === 0 ? { stdout: '', code: 1 } : { stdout: okLine }));

    const result = await mtpUpload('mtp://default', ['/a.flac', '/b.flac'], '/MUSIC', progress);

    expect(result.success).toBe(false);
    const reported = progress.mock.calls.map((c) => c[0]);
    expect(reported).not.toContain(2);
    // 失敗したファイルを「転送済み」として数えない
    expect(reported.filter((n) => n === 1)).toHaveLength(0);
  });
});
