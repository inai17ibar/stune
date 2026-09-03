import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getMtpDevices, isMtpCliAvailable, isMtpPath } from './mtp';

// Known Walkman identifiers to detect
const WALKMAN_INDICATORS = ['WALKMAN', 'NW-A', 'NW-ZX', 'NW-WM', 'SONY'];
// SD card volume names commonly used with Walkman
const SD_CARD_INDICATORS = ['SD_CARD', 'SDCARD', 'SD CARD', 'MICROSD', 'WALKMAN_SD', 'NW_SD'];
// Network filesystem types to exclude（`mount` / `diskutil info` が返す表記）
const NETWORK_FS_TYPES = [
  'smbfs',
  'nfs',
  'afpfs',
  'cifs',
  'webdav',
  'acfs',
  'ftp',
  'sshfs',
];
// `diskutil info` の Protocol フィールドがこれらならネットワーク越しのボリューム
const NETWORK_PROTOCOLS = ['smb', 'nfs', 'afp', 'cifs', 'webdav', 'network'];
// GUI から起動した Electron の PATH には /sbin が無いことがあるので絶対パスを使う
const MOUNT_BINARY = '/sbin/mount';
const DISKUTIL_BINARY = '/usr/sbin/diskutil';
const EXEC_TIMEOUT_MS = 2000;

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
    // ファイルシステム種別は 1 回の検出で一括取得する（ボリュームごとに mount を叩かない）
    const mountedFsTypes = getMountedFsTypes();

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const mountPath = path.join(volumesPath, entry.name);

      // ネットワークボリュームは名前が WALKMAN でも Walkman ではありえないので完全に除外する
      // （diskutil eject でも取り出せないため、一覧に出しても操作できない）
      if (isNetworkVolume(mountPath, mountedFsTypes)) continue;

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

      // ここに来る時点でネットワークボリュームは除外済み
      const isWalkman = nameMatch || isSdCard || hasMusicFolder;

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

/** ファイルシステム種別 / プロトコル名がネットワーク越しのものかを判定する */
function isNetworkFsType(fsType: string): boolean {
  const normalized = fsType.trim().toLowerCase();
  return NETWORK_FS_TYPES.some(
    (nfs) => normalized === nfs || normalized.startsWith(`${nfs}_`) ||
      normalized.includes(nfs)
  );
}

/**
 * `/sbin/mount` の 1 行をパースする。
 * 例: `//guest@nas._smb._tcp.local/Music on /Volumes/Music (smbfs, nodev, nosuid)`
 *
 * デバイス部分は最短一致（" on " を含まない前提）、マウントポイントは最長一致にして
 * `/Volumes/Music on Tour` のようなスペース入りボリューム名にも対応する。
 */
function parseMountLine(
  line: string
): { mountPath: string; fsType: string } | null {
  const match = line.match(/^(.+?) on (.+) \(([^()]*)\)\s*$/);
  if (!match) return null;
  const fsType = match[3].split(',')[0].trim().toLowerCase();
  if (!fsType) return null;
  return { mountPath: match[2], fsType };
}

/**
 * `/sbin/mount` の出力からマウントポイント → ファイルシステム種別のマップを作る。
 * macOS の BSD `stat` には `%T` でファイルシステム種別を返す機能が無く、
 * 旧実装（`stat -f '%T'`）ではネットワークボリュームを判別できなかった。
 */
function getMountedFsTypes(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const output = execSync(MOUNT_BINARY, {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT_MS,
    });
    for (const line of output.split('\n')) {
      const parsed = parseMountLine(line);
      if (parsed) map.set(parsed.mountPath, parsed.fsType);
    }
  } catch {
    // mount が使えない（macOS 以外など）→ 呼び出し側でフォールバックする
  }
  return map;
}

/**
 * `mount` でマウントポイントを特定できなかった場合のフォールバック。
 * `diskutil info` の Protocol フィールド（USB / SATA / SMB など）で判定する。
 */
function isNetworkVolumeViaDiskutil(mountPath: string): boolean {
  try {
    const output = execSync(
      `${DISKUTIL_BINARY} info ${JSON.stringify(mountPath)}`,
      { encoding: 'utf-8', timeout: EXEC_TIMEOUT_MS }
    ).toLowerCase();
    const protocol = output.match(/^\s*protocol:\s*(.+)$/m)?.[1];
    if (protocol) {
      return NETWORK_PROTOCOLS.some((p) => protocol.includes(p));
    }
    // Protocol 行が無い場合はファイルシステム種別の記載から判定する
    return isNetworkFsType(output);
  } catch {
    // diskutil がボリュームを認識しない = 物理ディスクではないが、
    // ネットワークとは断定できないので除外しない
    return false;
  }
}

/**
 * マウントパスがネットワークボリューム（SMB / NFS / AFP など）かを判定する。
 * `mountedFsTypes` は `getMountedFsTypes()` の結果（1 回の検出で使い回す）。
 */
function isNetworkVolume(
  mountPath: string,
  mountedFsTypes: Map<string, string>
): boolean {
  const fsType = mountedFsTypes.get(mountPath);
  if (fsType !== undefined) return isNetworkFsType(fsType);
  return isNetworkVolumeViaDiskutil(mountPath);
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
