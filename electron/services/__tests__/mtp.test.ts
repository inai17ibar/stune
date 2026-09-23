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

/** mtp-cli 1 回分の応答 */
type CliResponse = {
  /** stdout に流す文字列（1行 JSON を想定） */
  stdout?: string;
  /** 終了コード。非 0 なら runMtpCommand は null を返す */
  code?: number;
  /** spawn 自体の失敗（バイナリが壊れている等） */
  spawnError?: string;
  /** 応答を返さない（= タイムアウト相当。プロセスが閉じない） */
  hang?: boolean;
};

/**
 * spawn をモックし、送られてきたリクエストごとに応答を差し替える。
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
    child.kill = vi.fn();
    child.stdin = {
      end: () => {},
      write: (data: string, cb?: (err?: Error) => void) => {
        cb?.();
        const request = JSON.parse(data);
        const index = requests.length;
        requests.push(request);
        const res = responder(request, index);
        if (res.hang) return true;
        setTimeout(() => {
          if (res.spawnError) {
            child.emit('error', new Error(res.spawnError));
            return;
          }
          if (res.stdout) child.stdout.emit('data', Buffer.from(res.stdout));
          child.emit('close', res.code ?? 0);
        }, 0);
        return true;
      },
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
