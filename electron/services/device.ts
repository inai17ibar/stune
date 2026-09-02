import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getMtpDevices, isMtpCliAvailable, isMtpPath } from './mtp';

// Known Walkman identifiers to detect
const WALKMAN_INDICATORS = ['WALKMAN', 'NW-A', 'NW-ZX', 'NW-WM', 'SONY'];
// SD card volume names commonly used with Walkman
const SD_CARD_INDICATORS = ['SD_CARD', 'SDCARD', 'SD CARD', 'MICROSD', 'WALKMAN_SD', 'NW_SD'];
// Network filesystem types to exclude
const NETWORK_FS_TYPES = ['smbfs', 'nfs', 'afpfs', 'cifs', 'webdavfs', 'acfs'];

export interface DetectedDevice {
  name: string;
  mountPath: string;
  isWalkman: boolean;
  /** true の場合は MTP デバイス（転送時は mtp サービスを使用） */
  isMtp?: boolean;
}

async function detectWalkmanVolumes(): Promise<DetectedDevice[]> {
  const volumesPath = '/Volumes';
  const devices: DetectedDevice[] = [];

  try {
    const entries = await fs.promises.readdir(volumesPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const mountPath = path.join(volumesPath, entry.name);

      // Check if it has a MUSIC folder (common Walkman indicator)
      const hasMusicFolder = await checkMusicFolder(mountPath);

      // Check if the volume name contains Walkman identifiers
      const upperName = entry.name.toUpperCase();
      const nameMatch = WALKMAN_INDICATORS.some((indicator) =>
        upperName.includes(indicator)
      );
      const isSdCard = SD_CARD_INDICATORS.some((indicator) =>
        upperName.includes(indicator)
      );

      // Name match or SD card pattern → always include
      // MUSIC folder only → include only if NOT a network volume
      const isWalkman = nameMatch || isSdCard
        || (hasMusicFolder && !isNetworkVolume(mountPath));

      if (isWalkman) {
        // Require name match or SD card for non-MUSIC-folder-only detections
        // Skip generic volumes that just happen to have a Music folder
        if (!nameMatch && !isSdCard && hasMusicFolder) {
          // Extra check: only include if it looks like a portable device
          // (has MUSIC folder AND is not the boot volume or a large disk)
          const isBootVolume = mountPath === '/Volumes/Macintosh HD'
            || mountPath === '/Volumes/Macintosh HD - Data';
          if (isBootVolume) continue;
        }

        const displayName = isSdCard && !nameMatch
          ? `${entry.name} (SD Card)`
          : entry.name;
        devices.push({
          name: displayName,
          mountPath,
          isWalkman: true,
        });
      }
    }
  } catch {
    // /Volumes not accessible (not on macOS or permission issue)
  }

  return devices;
}

async function checkMusicFolder(mountPath: string): Promise<boolean> {
  const musicPaths = ['MUSIC', 'Music'];
  for (const mp of musicPaths) {
    try {
      const fullPath = path.join(mountPath, mp);
      const stat = await fs.promises.stat(fullPath);
      if (stat.isDirectory()) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Check if a mount path is a network volume (SMB, NFS, AFP, etc.).
 * Uses `stat -f %T` to get the filesystem type on macOS.
 */
function isNetworkVolume(mountPath: string): boolean {
  try {
    const fsType = execSync(`stat -f '%T' ${JSON.stringify(mountPath)}`, {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim().toLowerCase();
    return NETWORK_FS_TYPES.some((nfs) => fsType.includes(nfs));
  } catch {
    return false;
  }
}

// ===== 取り出し（イジェクト）済みデバイスの抑制 =====
// 取り出したデバイスがポーリングで再び一覧に現れないようにする。
// USB は eject 後にアンマウントされるので基本的に自然に消えるが、eject 完了直前の
// ポーリングで復活しないよう保険をかける。MTP はケーブルを抜くまで mtp-cli から
// 見え続けるため、この抑制が「一覧から消える」唯一の手段になる。
const ejectedVolumePaths = new Set<string>();
let mtpEjected = false;

/** デバイスを取り出し済みとしてマークし、一覧に出さないようにする */
export function markDeviceEjected(mountPath: string): void {
  if (isMtpPath(mountPath)) {
    // MTP は 1 台のデバイスが複数ストレージ（内蔵/SD）として見えるため、まとめて抑制する
    mtpEjected = true;
  } else {
    ejectedVolumePaths.add(mountPath);
  }
}

/** 取り出し済み状態をすべて解除する（テスト用） */
export function resetEjectedDevices(): void {
  ejectedVolumePaths.clear();
  mtpEjected = false;
}

/** USB マウント + MTP デバイスをまとめて返す（取り出し済みデバイスは除外） */
export async function getConnectedWalkman(): Promise<DetectedDevice[]> {
  const usb = await detectWalkmanVolumes();

  // アンマウントされたボリュームは抑制を解除 → 再接続時にまた表示される
  for (const ejectedPath of [...ejectedVolumePaths]) {
    if (!usb.some((d) => d.mountPath === ejectedPath)) {
      ejectedVolumePaths.delete(ejectedPath);
    }
  }
  const visibleUsb = usb.filter((d) => !ejectedVolumePaths.has(d.mountPath));

  if (!isMtpCliAvailable()) return visibleUsb;
  try {
    const mtpList = await getMtpDevices();
    // ケーブルが抜かれて MTP デバイスが消えたら抑制を解除 → 再接続時にまた表示される
    if (mtpList.length === 0) mtpEjected = false;
    if (mtpEjected) return visibleUsb;

    const mtpDevices: DetectedDevice[] = mtpList.map((d) => ({
      name: d.name,
      mountPath: d.mountPath,
      isWalkman: d.isWalkman,
      isMtp: true,
    }));
    return [...visibleUsb, ...mtpDevices];
  } catch {
    return visibleUsb;
  }
}

// ===== デバイス監視 =====
const POLL_INTERVAL_MS = 3000;

let deviceListener: ((devices: DetectedDevice[]) => void) | null = null;
let previousPaths: string[] | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
/** 遅い検出結果が新しい結果を上書きしないようにするための連番 */
let requestSeq = 0;
let appliedSeq = 0;

/**
 * デバイス一覧を取得し、前回から変化していれば（または force 指定時は必ず）通知する。
 */
async function check(force = false): Promise<DetectedDevice[]> {
  const seq = ++requestSeq;
  const devices = await getConnectedWalkman();

  // MTP 検出は数秒かかることがあり、その間に届いた新しい結果を古い結果で上書きしない
  if (seq < appliedSeq) return devices;
  appliedSeq = seq;

  const currentPaths = devices.map((d) => d.mountPath).sort();
  const changed =
    previousPaths === null ||
    JSON.stringify(currentPaths) !== JSON.stringify(previousPaths);
  previousPaths = currentPaths;
  if (changed || force) deviceListener?.(devices);
  return devices;
}

/**
 * 即座にデバイス一覧を再取得し、リスナーへ通知する。
 * 取り出し直後に呼ぶことで、ポーリング間隔を待たずに一覧から消える。
 */
export async function refreshDevices(): Promise<DetectedDevice[]> {
  return await check(true);
}

export function watchDevices(
  callback: (devices: DetectedDevice[]) => void
): void {
  deviceListener = callback;
  previousPaths = null;

  if (pollTimer) clearInterval(pollTimer);

  // Initial check
  void check();

  // Poll /Volumes (+ MTP) periodically for device changes.
  // 前回の検出が終わっていない間はスキップして、mtp-cli の多重起動を避ける
  pollTimer = setInterval(() => {
    if (pollInFlight) return;
    pollInFlight = true;
    void check().finally(() => {
      pollInFlight = false;
    });
  }, POLL_INTERVAL_MS);
}

/** ポーリングを停止する（アプリ終了時・テスト用） */
export function stopWatchingDevices(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  deviceListener = null;
}
