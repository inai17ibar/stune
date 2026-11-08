import * as fs from 'fs';
import * as path from 'path';

// Use Function constructor to prevent TypeScript from converting
// dynamic import() to require() — music-metadata v11+ is ESM-only.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<typeof import('music-metadata')>;

let mm: typeof import('music-metadata') | null = null;
async function getMusicMetadata() {
  if (!mm) {
    mm = await dynamicImport('music-metadata');
  }
  return mm;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.wav',
  '.aac',
  '.m4a',
  '.alac',
  '.aiff',
  '.aif',
  '.ogg',
  '.wma',
  '.dsf',
  '.dff',
  '.opus',
]);

export function isSupportedAudioFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

// 1 ファイルのメタデータ読み取りに許す上限時間。細工されたファイルでパーサが
// 非同期に止まっても、スキャン全体を巻き込まずに既定値へフォールバックする。
// 注: 同期的な無限ループはイベントループを塞ぐためこれでは中断できない。
// そこは music-metadata 側の修正（11.16.0+）に依存している。
const PARSE_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, filePath: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Metadata read timed out after ${ms}ms: ${filePath}`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// 同時に走らせる parseFile の上限（呼び出し側のバッチサイズ 4 と同じ）。
// タイムアウトしても parseFile 自体は止まらないため、スロットはタイムアウト時ではなく
// パース Promise が settle した時点で解放する。これがないとタイムアウトした
// パーサがバッチ枠を抜けたまま走り続け、同時実行数が際限なく増える。
const MAX_CONCURRENT_PARSES = 4;
let activeParses = 0;
const parseQueue: Array<() => void> = [];

function releaseParseSlot(): void {
  const next = parseQueue.shift();
  if (next) {
    // スロットをそのまま次のタスクへ引き渡す（activeParses は据え置き）
    next();
  } else {
    activeParses--;
  }
}

export function runWithParseSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      let p: Promise<T>;
      try {
        p = Promise.resolve(task());
      } catch (err) {
        p = Promise.reject(err);
      }
      p.then(resolve, reject).finally(releaseParseSlot);
    };
    if (activeParses < MAX_CONCURRENT_PARSES) {
      activeParses++;
      start();
    } else {
      parseQueue.push(start);
    }
  });
}

export async function readTrackMetadata(filePath: string): Promise<any> {
  try {
    const stats = await fs.promises.stat(filePath);
    const mmLib = await getMusicMetadata();
    // スロットは生の parse Promise が settle するまで保持され、
    // withTimeout は同じ Promise と競争する。
    const parsePromise = runWithParseSlot(() => mmLib.parseFile(filePath));
    // タイムアウト後に parse が reject しても unhandled rejection にしない
    parsePromise.catch(() => {});
    const metadata = await withTimeout(parsePromise, PARSE_TIMEOUT_MS, filePath);
    const { common, format } = metadata;

    let coverArt: string | null = null;
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      const base64 = Buffer.from(pic.data).toString('base64');
      coverArt = `data:${pic.format};base64,${base64}`;
    }

    return {
      filePath,
      fileName: path.basename(filePath),
      title: common.title || path.basename(filePath, path.extname(filePath)),
      artist: common.artist || 'Unknown Artist',
      album: common.album || 'Unknown Album',
      albumArtist: common.albumartist || common.artist || 'Unknown Artist',
      year: common.year,
      trackNumber: common.track?.no ?? undefined,
      discNumber: common.disk?.no ?? undefined,
      genre: common.genre?.[0] || '',
      duration: format.duration || 0,
      bitrate: format.bitrate,
      sampleRate: format.sampleRate,
      format: path.extname(filePath).slice(1).toUpperCase(),
      fileSize: stats.size,
      coverArt,
    };
  } catch (err: any) {
    console.error(`Failed to read metadata for ${filePath}:`, err.message);
    const stats = await fs.promises.stat(filePath).catch(() => ({ size: 0 }));
    return {
      filePath,
      fileName: path.basename(filePath),
      title: path.basename(filePath, path.extname(filePath)),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      albumArtist: 'Unknown Artist',
      year: undefined,
      trackNumber: undefined,
      discNumber: undefined,
      genre: '',
      duration: 0,
      bitrate: undefined,
      sampleRate: undefined,
      format: path.extname(filePath).slice(1).toUpperCase(),
      fileSize: (stats as any).size || 0,
      coverArt: null,
    };
  }
}
