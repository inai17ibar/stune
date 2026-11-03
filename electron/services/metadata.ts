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

export async function readTrackMetadata(filePath: string): Promise<any> {
  try {
    const stats = await fs.promises.stat(filePath);
    const mmLib = await getMusicMetadata();
    const metadata = await withTimeout(mmLib.parseFile(filePath), PARSE_TIMEOUT_MS, filePath);
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
