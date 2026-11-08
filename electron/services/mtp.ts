/**
 * MTP デバイス検出・ファイル操作（OpenMTP / go-mtpx 由来の mtp-cli バイナリを利用）
 * バイナリが無い場合は MTP デバイスは検出されません。
 */

import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

const MTP_PROTOCOL_PREFIX = 'mtp://';

export interface MtpStorage {
  storageId: string;
  description: string;
  maxCapacity: number;
  freeSpaceInBytes: number;
}

export interface MtpDeviceInfo {
  name: string;
  /** 仮想パス（MTP 識別用）。例: "mtp://default" */
  mountPath: string;
  isWalkman: boolean;
  isMtp: true;
  storageId: string;
  storages: MtpStorage[];
}

export interface MtpFileInfo {
  objectId: number;
  name: string;
  fullPath: string;
  size: number;
  isDir: boolean;
}

let mtpCliPath: string | null = null;

/**
 * 実行中の mtp-cli プロセス。
 * mtp-cli は 1 プロセス = 1 MTP セッション（単発コマンドなら 1 コマンド、
 * MtpCliSession ならスキャン / 転送 1 回分）なので、
 * 「セッションの切断」= 実行中プロセスの終了（= デバイス側セッションの解放）となる。
 */
const activeProcesses = new Set<ChildProcess>();

/**
 * 同梱の mtp-cli または OpenMTP アプリ内の mtp-cli のパスを返す。
 * 見つからなければ null。
 */
export function getMtpCliPath(): string | null {
  if (mtpCliPath !== null) return mtpCliPath;

  const candidates: string[] = [];

  // 1. 本アプリの Resources/bin (electron-builder で extraResources に含める想定)
  if (app.isPackaged) {
    const resourcesBin = path.join(
      process.resourcesPath,
      'bin',
      'mtp-cli'
    );
    candidates.push(resourcesBin);
  } else {
    // 開発時: プロジェクトルートの native/mtp-cli または resources/bin
    const appPath = app.getAppPath();
    candidates.push(path.join(appPath, 'native', 'mtp-cli', 'mtp-cli'));
    candidates.push(path.join(appPath, 'resources', 'bin', 'mtp-cli'));
  }

  // 2. OpenMTP をインストールしている場合
  const openMtpPaths = [
    '/Applications/OpenMTP.app/Contents/Resources/bin/mtp-cli',
    path.join(process.env.HOME || '', 'Applications', 'OpenMTP.app', 'Contents', 'Resources', 'bin', 'mtp-cli'),
  ];
  candidates.push(...openMtpPaths);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        mtpCliPath = p;
        return p;
      }
    } catch {
      continue;
    }
  }

  mtpCliPath = null;
  return null;
}

/**
 * mtp-cli が利用可能か
 */
export function isMtpCliAvailable(): boolean {
  return getMtpCliPath() !== null;
}

/** mtp-cli 起動用の環境変数（同梱 dylib / Homebrew の libusb を解決させる） */
function mtpCliEnv(bin: string): NodeJS.ProcessEnv {
  const binDir = path.dirname(bin);
  const libPaths = [
    binDir,
    '/opt/homebrew/lib',  // Apple Silicon Homebrew
    '/usr/local/lib',     // Intel Homebrew
  ].filter((p) => p);
  const dyldPath = [...new Set(libPaths)].join(path.delimiter);
  return { ...process.env, DYLD_LIBRARY_PATH: dyldPath };
}

/** mtp-cli にコマンドを 1 つ送り、応答（失敗時 null）を返す関数 */
type MtpExecute = <T>(request: object) => Promise<T | null>;

const MTP_COMMAND_TIMEOUT_MS = 120000;
const MTP_SESSION_CLOSE_WAIT_MS = 5000;

/**
 * 1 つの mtp-cli プロセス（= 1 つのデバイス側 MTP セッション）上で
 * 複数コマンドを順番に実行する。
 *
 * - コマンドは厳密に 1 つずつ実行し、1 行 JSON 応答を順に対応付ける。
 * - タイムアウト・プロセス異常終了・応答の解析失敗のいずれでも、そのコマンドは
 *   null を返し、以後のコマンドもすべて null を返す（行の対応付けが信用できないため）。
 * - 例外は投げない（runMtpCommand と同じ null-on-failure 契約）。
 * - 生存中の子プロセスは activeProcesses に登録されるので mtpDisconnect() で切断できる。
 */
class MtpCliSession {
  private child: ChildProcess | null = null;
  /** プロセスが死んだ / 応答が信用できない */
  private dead = false;
  /** close() が呼ばれた */
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private stdoutBuf = '';
  private stderrBuf = '';
  /** 実行中コマンドの応答待ち。null を渡すと失敗 */
  private waiter: ((line: string | null) => void) | null = null;
  private exited: Promise<void>;
  private markExited: () => void = () => {};

  constructor(bin: string) {
    this.exited = new Promise((resolve) => {
      this.markExited = resolve;
    });

    let child: ChildProcess;
    try {
      child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'], env: mtpCliEnv(bin) });
    } catch (err: any) {
      console.error('[mtp-cli] spawn error:', err?.message);
      this.handleExit();
      return;
    }
    this.child = child;
    activeProcesses.add(child);

    child.stdout?.on('data', (chunk) => this.onStdout(chunk.toString()));
    child.stderr?.on('data', (chunk) => {
      this.stderrBuf += chunk.toString();
    });
    // 死んだプロセスの stdin への書き込みは EPIPE を 'error' で投げる。未処理だと main が落ちる。
    child.stdin?.on('error', (err) => {
      console.error('[mtp-cli] stdin error:', err.message);
      this.kill();
    });
    child.on('error', (err) => {
      console.error('[mtp-cli] spawn error:', err.message);
      this.handleExit();
    });
    child.on('close', (code) => {
      if (this.stderrBuf) console.error('[mtp-cli] stderr:', this.stderrBuf.trim());
      if (code !== 0 || this.waiter) {
        console.error('[mtp-cli] session exited with code', code, this.waiter ? '(command pending)' : '');
      }
      this.handleExit();
    });
  }

  /** コマンドを 1 つ実行する。前のコマンドの完了を待ってから送る。 */
  execute<T>(request: object): Promise<T | null> {
    const result = this.queue.then(() => this.runOne<T>(request));
    this.queue = result;
    return result;
  }

  /**
   * stdin を閉じて（mtp-cli は EOF でデバイスを Dispose して終了する）終了を少し待つ。
   * 待っても終わらなければ SIGKILL。2 回呼んでも安全。
   */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      try {
        this.child?.stdin?.end();
      } catch {
        // すでに閉じている
      }
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      this.exited.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), MTP_SESSION_CLOSE_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (timedOut) {
      console.error('[mtp-cli] session did not exit after stdin EOF; killing');
      this.kill();
    }
  }

  private runOne<T>(request: object): Promise<T | null> {
    const child = this.child;
    if (this.dead || this.closed || !child?.stdin) return Promise.resolve(null);

    return new Promise<T | null>((resolve) => {
      const timeout = setTimeout(() => {
        console.error(
          `[mtp-cli] timeout after ${MTP_COMMAND_TIMEOUT_MS / 1000}s, request:`,
          JSON.stringify(request).slice(0, 200)
        );
        this.kill();
      }, MTP_COMMAND_TIMEOUT_MS);

      this.waiter = (line) => {
        clearTimeout(timeout);
        this.waiter = null;
        if (line === null) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(line) as T);
        } catch {
          // 応答行が壊れていると以後の行の対応付けが信用できないのでセッションごと捨てる
          console.error('[mtp-cli] JSON parse error, line:', line);
          resolve(null);
          this.kill();
        }
      };

      try {
        child.stdin!.write(JSON.stringify(request) + '\n', (err) => {
          if (err) {
            console.error('[mtp-cli] stdin write error:', err.message);
            this.kill();
          }
        });
      } catch (err: any) {
        console.error('[mtp-cli] stdin write error:', err?.message);
        this.kill();
      }
    });
  }

  private onStdout(text: string) {
    this.stdoutBuf += text;
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      if (this.waiter) this.waiter(line);
      else console.error('[mtp-cli] unexpected output:', line);
    }
  }

  /** プロセスを強制終了し、実行中・以後のコマンドを null にする */
  private kill() {
    this.dead = true;
    this.waiter?.(null);
    try {
      this.child?.kill('SIGKILL');
    } catch {
      // すでに終了している
    }
  }

  private handleExit() {
    this.dead = true;
    if (this.child) activeProcesses.delete(this.child);
    this.waiter?.(null);
    this.markExited();
  }
}

/** バイナリがあればセッションを開く。無ければ null */
function createMtpSession(): MtpCliSession | null {
  const bin = getMtpCliPath();
  return bin ? new MtpCliSession(bin) : null;
}

/** MTP の 1 セッション上でアップロードを行うハンドル */
export interface MtpUploadSession {
  /** 1 ファイルをアップロードする。応答なし（プロセス異常等）は null */
  uploadOne(source: string, destinationDir: string): Promise<{ ok?: boolean; error?: string } | null>;
  close(): Promise<void>;
}

/**
 * 1 つの mtp-cli プロセス / MTP セッションを開き、複数ファイルのアップロードに使い回す。
 * MTP パスでない・バイナリが無い場合は null。使い終わったら必ず close() すること。
 */
export async function openMtpSession(mountPath: string): Promise<MtpUploadSession | null> {
  if (!isMtpPath(mountPath)) return null;
  const session = createMtpSession();
  if (!session) return null;
  const storageId = getStorageIdFromMtpPath(mountPath);
  return {
    uploadOne: (source, destinationDir) =>
      session.execute<{ ok?: boolean; error?: string }>({
        cmd: 'upload',
        storageId,
        source,
        destination: destinationDir,
      }),
    close: () => session.close(),
  };
}

/**
 * mtp-cli に JSON コマンドを送り、1行 JSON 応答を取得する。
 * バイナリが無い・失敗時は null を返す。
 */
function runMtpCommand<T = unknown>(request: object): Promise<T | null> {
  const bin = getMtpCliPath();
  if (!bin) return Promise.resolve(null);

  const env = mtpCliEnv(bin);

  return new Promise((resolve) => {
    const child = spawn(bin, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    activeProcesses.add(child);
    const done = (value: T | null) => {
      activeProcesses.delete(child);
      resolve(value);
    };

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      console.error('[mtp-cli] timeout after 120s, request:', JSON.stringify(request).slice(0, 200));
      child.kill('SIGKILL');
      done(null);
    }, 120000);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[mtp-cli] spawn error:', err.message);
      done(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (stderr) console.error('[mtp-cli] stderr:', stderr.trim());
      if (code !== 0) {
        console.error('[mtp-cli] exited with code', code, 'stdout:', stdout.trim());
        done(null);
        return;
      }
      try {
        const line = stdout.trim().split('\n').find((l) => l.startsWith('{'));
        if (line) done(JSON.parse(line) as T);
        else {
          console.error('[mtp-cli] no JSON in output:', stdout.trim());
          done(null);
        }
      } catch {
        console.error('[mtp-cli] JSON parse error, stdout:', stdout.trim());
        done(null);
      }
    });

    child.stdin?.write(JSON.stringify(request) + '\n', (err) => {
      if (err) done(null);
      child.stdin?.end();
    });
  });
}

/**
 * MTP デバイスを 1 台検出し、ストレージ一覧を返す。
 * 複数台は現状未対応（1台のみ選択される前提）。
 */
export function getMtpDevices(): Promise<MtpDeviceInfo[]> {
  return listMtpDevices(runMtpCommand);
}

/** getMtpDevices の本体。コマンドの実行方法（単発 / セッション）を差し替えられる */
async function listMtpDevices(execute: MtpExecute): Promise<MtpDeviceInfo[]> {
  const res = await execute<{ storages?: MtpStorage[]; deviceName?: string; error?: string }>({
    cmd: 'list_storages',
  });
  if (!res || res.error || !res.storages?.length) return [];

  const name = res.deviceName || 'MTP Device';
  const isWalkman = /WALKMAN|NW-|SONY/i.test(name);

  // Return one entry per storage so internal and SD card appear as separate targets
  return res.storages.map((s, i) => {
    const sid = String(s.storageId ?? i);
    const storageSuffix = res.storages!.length > 1
      ? (i === 0 ? ' (内蔵)' : ' (SDカード)')
      : '';
    return {
      name: `${name}${storageSuffix}`,
      mountPath: `${MTP_PROTOCOL_PREFIX}${sid}`,
      isWalkman,
      isMtp: true,
      storageId: sid,
      storages: res.storages!,
    };
  });
}

/**
 * MTP セッションをクリーンに切断する。
 * mtp-cli はプロセスごとに MTP セッションを開閉するので、実行中のプロセスを
 * 終了させればデバイス側のセッションが解放され、ケーブルを抜いても
 * Walkman がデータベース再構築に進める状態になる。
 * @returns 終了させたプロセス数
 */
export function mtpDisconnect(): number {
  const running = [...activeProcesses];
  activeProcesses.clear();
  for (const child of running) {
    try {
      // SIGTERM で終わらないケース（libusb の転送待ち）に備えて SIGKILL
      child.kill('SIGKILL');
    } catch {
      // すでに終了している
    }
  }
  return running.length;
}

/**
 * パスが MTP 仮想パスか
 */
export function isMtpPath(p: string): boolean {
  return p.startsWith(MTP_PROTOCOL_PREFIX);
}

/** "mtp://123" または "mtp://123/MUSIC" から storageId を取得 */
function getStorageIdFromMtpPath(mountPath: string): string {
  const rest = mountPath.slice(MTP_PROTOCOL_PREFIX.length);
  const firstSlash = rest.indexOf('/');
  return firstSlash >= 0 ? rest.slice(0, firstSlash) : rest;
}

const SUPPORTED_AUDIO_EXT = new Set([
  '.mp3', '.flac', '.wav', '.aac', '.m4a', '.alac', '.aiff', '.aif',
  '.ogg', '.wma', '.dsf', '.dff', '.opus',
]);

function isAudioFile(name: string): boolean {
  return SUPPORTED_AUDIO_EXT.has(name.slice(name.lastIndexOf('.')).toLowerCase());
}

/**
 * MTP デバイス上でディレクトリ内のファイル一覧を取得する。
 * mountPath は "mtp://<storageId>" 形式。
 */
export async function mtpListFiles(
  mountPath: string,
  dirPath: string
): Promise<MtpFileInfo[]> {
  return listFilesWith(runMtpCommand, mountPath, dirPath);
}

async function listFilesWith(
  execute: MtpExecute,
  mountPath: string,
  dirPath: string
): Promise<MtpFileInfo[]> {
  if (!isMtpPath(mountPath)) return [];
  const storageId = getStorageIdFromMtpPath(mountPath);
  const res = await execute<{ files?: MtpFileInfo[]; error?: string }>({
    cmd: 'list_files',
    storageId,
    path: dirPath || '/',
  });
  if (!res || res.error) return [];
  return res.files ?? [];
}

/**
 * MTP デバイスをスキャンし、USB 用 scanDevice と同じ形のオブジェクトを返す。
 * 音楽ファイルは MTP 上を再帰的に列挙し、メタデータはファイル名ベースの最小限のみ。
 */
export async function scanMtpDevice(mountPath: string): Promise<{
  name: string;
  mountPath: string;
  musicPath: string;
  totalSpace: number;
  usedSpace: number;
  freeSpace: number;
  tracks: any[];
  albums: any[];
}> {
  if (!isMtpPath(mountPath)) throw new Error('Not MTP path');
  // スキャン全体（デバイス検索 + 全ディレクトリ列挙）を 1 プロセス / 1 MTP セッションで行う
  const session = createMtpSession();
  const execute: MtpExecute = session
    ? (request) => session.execute(request)
    : () => Promise.resolve(null);
  let dev: MtpDeviceInfo | undefined;
  const allFiles: MtpFileInfo[] = [];
  try {
    const devices = await listMtpDevices(execute);
    const storageId = getStorageIdFromMtpPath(mountPath);
    dev = devices.find((d) => getStorageIdFromMtpPath(d.mountPath) === storageId);
    if (!dev) throw new Error('MTP device not found');

    const walk = async (dir: string) => {
      const files = await listFilesWith(execute, mountPath, dir);
      for (const f of files) {
        if (f.isDir) await walk(f.fullPath);
        else if (isAudioFile(f.name)) allFiles.push(f);
      }
    };
    const musicFiles = await listFilesWith(execute, mountPath, '/MUSIC');
    if (musicFiles.length > 0) await walk('/MUSIC');
    else await walk('/');
  } finally {
    await session?.close();
  }

  const storage = dev.storages[0];
  const totalSpace = storage?.maxCapacity ?? 0;
  const freeSpace = storage?.freeSpaceInBytes ?? 0;
  const usedSpace = totalSpace - freeSpace;
  const musicPath = mountPath + '/MUSIC';

  const tracks = allFiles.map((f) => ({
    filePath: mountPath + '/' + f.fullPath.replace(/^\//, ''),
    fileName: f.name,
    title: f.name.replace(/\.[^.]+$/, ''),
    artist: '',
    album: '',
    albumArtist: '',
    year: undefined,
    trackNumber: undefined,
    discNumber: undefined,
    genre: '',
    duration: 0,
    bitrate: undefined,
    sampleRate: undefined,
    format: f.name.split('.').pop() || '',
    fileSize: f.size,
    coverArt: null,
  }));

  const albumMap = new Map<string, any[]>();
  for (const t of tracks) {
    const key = t.album || 'Unknown Album';
    if (!albumMap.has(key)) albumMap.set(key, []);
    albumMap.get(key)!.push(t);
  }
  const albums = Array.from(albumMap.entries()).map(([name, albumTracks]) => ({
    name,
    artist: albumTracks[0]?.artist || '',
    year: undefined,
    tracks: albumTracks,
    coverArt: null,
  }));

  return {
    name: dev.name,
    mountPath,
    musicPath,
    totalSpace,
    usedSpace,
    freeSpace,
    tracks,
    albums,
  };
}

/**
 * MTP デバイス上のフォルダ内容を取得（隠しファイル・ゴミファイルを除外）。
 */
export async function mtpBrowse(
  storageId: string,
  dirPath: string
): Promise<MtpFileInfo[]> {
  const res = await runMtpCommand<{ files?: MtpFileInfo[]; error?: string }>({
    cmd: 'list_files',
    storageId,
    path: dirPath || '/',
  });
  if (!res || res.error) return [];
  const files = res.files ?? [];
  // 隠しファイル・ゴミファイルを除外
  return files.filter((f) => {
    const name = f.name;
    if (name.startsWith('.')) return false;
    if (name.startsWith('.trashed-')) return false;
    if (name === 'default-capability.xml') return false;
    if (name === 'DevIcon.fil') return false;
    if (name === 'DevLogo.fil') return false;
    if (name === 'Android') return false;
    return true;
  });
}

/**
 * MTP デバイスからファイルをローカルにダウンロードする。
 * 一時ディレクトリにコピーし、ローカルパスを返す。
 */
export async function mtpDownloadFile(
  storageId: string,
  remotePath: string,
  destDir: string
): Promise<string | null> {
  const res = await runMtpCommand<{ ok?: boolean; error?: string }>({
    cmd: 'download',
    storageId,
    source: remotePath,
    destination: destDir,
  });
  if (!res || res.error || !res.ok) return null;
  // ダウンロードされたファイルのローカルパス
  const fileName = remotePath.split('/').pop() || '';
  return path.join(destDir, fileName);
}

/**
 * MTP デバイス上のファイルを削除する。
 * paths は MTP 上のフルパス（例: "/MUSIC/Artist/Album/track.flac"）。
 */
export async function mtpDeleteFiles(
  storageId: string,
  paths: string[]
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  if (paths.length === 0) return { success: true, deletedCount: 0 };
  const res = await runMtpCommand<{ ok?: boolean; deletedCount?: number; error?: string; errors?: string[] }>({
    cmd: 'delete',
    storageId,
    paths,
  });
  if (!res) return { success: false, deletedCount: 0, error: 'MTP delete failed: no response' };
  // New response: { ok, deletedCount, errors[] } — error field set only when ALL fail
  if (res.error && (res.deletedCount ?? 0) === 0) {
    return { success: false, deletedCount: 0, error: res.error };
  }
  const deletedCount = res.deletedCount ?? 0;
  const errorMsg = res.errors?.length ? res.errors.join('; ') : undefined;
  if (errorMsg) console.error('[mtp] Delete partial errors:', errorMsg);
  return { success: deletedCount > 0, deletedCount, error: errorMsg };
}

/**
 * ローカルファイルを MTP デバイスの指定パスへアップロードする。
 */
export async function mtpUpload(
  mountPath: string,
  localPaths: string[],
  destinationDir: string,
  onProgress?: (current: number, total: number, currentFile: string) => void
): Promise<{ success: boolean; error?: string }> {
  if (!isMtpPath(mountPath)) return { success: false, error: 'Not MTP path' };
  const total = localPaths.length;
  if (total === 0) return { success: true };
  // 全ファイルを 1 プロセス / 1 MTP セッションで送る
  const session = await openMtpSession(mountPath);
  try {
    for (let i = 0; i < localPaths.length; i++) {
      // 転送「開始」の通知は完了数 i のまま送る。i + 1 を送ると最後のファイルの
      // 開始時点で 100% = completed と表示され、転送中にケーブルを抜かれかねない。
      onProgress?.(i, total, localPaths[i]);
      const res = session ? await session.uploadOne(localPaths[i], destinationDir) : null;
      // バイナリ未検出・spawn 失敗・プロセス異常終了・タイムアウト・JSON 解析失敗の
      // いずれでも null になる。null を無視すると 1 バイトも転送していないのに
      // success: true を返してしまう。
      if (!res) {
        return { success: false, error: `MTP upload failed: no response (${path.basename(localPaths[i])})` };
      }
      if (res.error) return { success: false, error: res.error };
      onProgress?.(i + 1, total, localPaths[i]);
    }
    return { success: true };
  } finally {
    await session?.close();
  }
}
