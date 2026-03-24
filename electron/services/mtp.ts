/**
 * MTP デバイス検出・ファイル操作（OpenMTP / go-mtpx 由来の mtp-cli バイナリを利用）
 * バイナリが無い場合は MTP デバイスは検出されません。
 */

import { spawn } from 'child_process';
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

/**
 * mtp-cli に JSON コマンドを送り、1行 JSON 応答を取得する。
 * バイナリが無い・失敗時は null を返す。
 */
function runMtpCommand<T = unknown>(request: object): Promise<T | null> {
  const bin = getMtpCliPath();
  if (!bin) return Promise.resolve(null);

  const binDir = path.dirname(bin);
  const libPaths = [
    binDir,
    '/opt/homebrew/lib',  // Apple Silicon Homebrew
    '/usr/local/lib',     // Intel Homebrew
  ].filter((p) => p);
  const dyldPath = [...new Set(libPaths)].join(path.delimiter);
  const env = { ...process.env, DYLD_LIBRARY_PATH: dyldPath };

  return new Promise((resolve) => {
    const child = spawn(bin, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 15000);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        const line = stdout.trim().split('\n').find((l) => l.startsWith('{'));
        if (line) resolve(JSON.parse(line) as T);
        else resolve(null);
      } catch {
        resolve(null);
      }
    });

    child.stdin?.write(JSON.stringify(request) + '\n', (err) => {
      if (err) resolve(null);
      child.stdin?.end();
    });
  });
}

/**
 * MTP デバイスを 1 台検出し、ストレージ一覧を返す。
 * 複数台は現状未対応（1台のみ選択される前提）。
 */
export async function getMtpDevices(): Promise<MtpDeviceInfo[]> {
  const res = await runMtpCommand<{ storages?: MtpStorage[]; deviceName?: string; error?: string }>({
    cmd: 'list_storages',
  });
  if (!res || res.error || !res.storages?.length) return [];

  const storageId = String(res.storages[0].storageId ?? 0);
  const name = res.deviceName || 'MTP Device';

  return [
    {
      name,
      mountPath: `${MTP_PROTOCOL_PREFIX}${storageId}`,
      isWalkman: /WALKMAN|NW-|SONY/i.test(name),
      isMtp: true,
      storageId,
      storages: res.storages,
    },
  ];
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
  if (!isMtpPath(mountPath)) return [];
  const storageId = getStorageIdFromMtpPath(mountPath);
  const res = await runMtpCommand<{ files?: MtpFileInfo[]; error?: string }>({
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
  const devices = await getMtpDevices();
  const storageId = getStorageIdFromMtpPath(mountPath);
  const dev = devices.find((d) => getStorageIdFromMtpPath(d.mountPath) === storageId);
  if (!dev) throw new Error('MTP device not found');
  const storage = dev.storages[0];
  const totalSpace = storage?.maxCapacity ?? 0;
  const freeSpace = storage?.freeSpaceInBytes ?? 0;
  const usedSpace = totalSpace - freeSpace;

  const musicPath = mountPath + '/MUSIC';
  const allFiles: MtpFileInfo[] = [];
  async function walk(dir: string) {
    const files = await mtpListFiles(mountPath, dir);
    for (const f of files) {
      if (f.isDir) await walk(f.fullPath);
      else if (isAudioFile(f.name)) allFiles.push(f);
    }
  }
  const musicFiles = await mtpListFiles(mountPath, '/MUSIC');
  if (musicFiles.length > 0) await walk('/MUSIC');
  else await walk('/');

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
 * ローカルファイルを MTP デバイスの指定パスへアップロードする。
 */
export async function mtpUpload(
  mountPath: string,
  localPaths: string[],
  destinationDir: string,
  onProgress?: (current: number, total: number, currentFile: string) => void
): Promise<{ success: boolean; error?: string }> {
  if (!isMtpPath(mountPath)) return { success: false, error: 'Not MTP path' };
  const storageId = getStorageIdFromMtpPath(mountPath);
  const total = localPaths.length;
  for (let i = 0; i < localPaths.length; i++) {
    onProgress?.(i + 1, total, localPaths[i]);
    const res = await runMtpCommand<{ error?: string }>({
      cmd: 'upload',
      storageId,
      source: localPaths[i],
      destination: destinationDir,
    });
    if (res?.error) return { success: false, error: res.error };
  }
  return { success: true };
}
