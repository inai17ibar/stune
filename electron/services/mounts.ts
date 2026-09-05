/**
 * マウントテーブル（`/sbin/mount` の出力）の解析
 *
 * macOS の BSD stat には `%T` でファイルシステム種別を返す書式が無く、
 * `stat -f '%T'` ではネットワークボリュームを判別できない（ファイル種別を表す
 * 記号が返るだけ）。そのため `/sbin/mount` の出力からマウントポイントごとの
 * ファイルシステム種別を取り出して判定する。
 *
 * 出力例:
 *   /dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
 *   //user@nas._smb._tcp.local/music on /Volumes/music (smbfs, nodev, nosuid)
 *   nas:/export on /Volumes/nfs (nfs, nodev, nosuid)
 */

import { execFileSync } from 'child_process';

const MOUNT_ABSOLUTE = '/sbin/mount';
const EXEC_TIMEOUT_MS = 2000;

/** ネットワーク経由のファイルシステム種別（完全一致） */
const NETWORK_FS_TYPES = new Set([
  'smbfs',
  'cifs',
  'nfs',
  'afpfs',
  'ftp',
  'acfs',
  'sshfs',
  'davfs',
]);

/** ネットワークファイルシステムの前方一致パターン（webdav/webdavfs など） */
const NETWORK_FS_PREFIXES = ['webdav', 'smb', 'nfs', 'afp'];

/** マウントポイント → ファイルシステム種別（小文字） */
export type MountTable = Map<string, string>;

/** 末尾のスラッシュを落として比較できるようにする（"/" はそのまま） */
function normalize(mountPath: string): string {
  const trimmed = mountPath.replace(/\/+$/, '');
  return trimmed || '/';
}

/**
 * `mount` の 1 行を解析する。形式は `<device> on <mount point> (<type>, <opts>...)`。
 * マウントポイントに " on " が含まれても壊れないよう、device 側を最短一致にする。
 */
export function parseMountLine(
  line: string
): { mountPoint: string; fsType: string } | null {
  const match = line.match(/^(.+?) on (.+) \(([^)]*)\)\s*$/);
  if (!match) return null;

  const mountPoint = normalize(match[2]);
  const fsType = match[3].split(',')[0].trim().toLowerCase();
  if (!mountPoint || !fsType) return null;

  return { mountPoint, fsType };
}

/** `mount` の出力全体を解析してマウントポイント → 種別のマップにする */
export function parseMountOutput(output: string): MountTable {
  const table: MountTable = new Map();
  for (const line of output.split('\n')) {
    const entry = parseMountLine(line.trim());
    if (entry) table.set(entry.mountPoint, entry.fsType);
  }
  return table;
}

/**
 * 現在のマウントテーブルを取得する。
 * `mount` が使えない環境（macOS 以外など）では空のマップを返す。
 */
export function getMountTable(): MountTable {
  try {
    const output = execFileSync(MOUNT_ABSOLUTE, [], {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT_MS,
    });
    return parseMountOutput(String(output));
  } catch {
    return new Map();
  }
}

/** ファイルシステム種別がネットワーク経由かどうか */
export function isNetworkFsType(fsType: string): boolean {
  const type = fsType.trim().toLowerCase();
  if (!type) return false;
  if (NETWORK_FS_TYPES.has(type)) return true;
  return NETWORK_FS_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * マウントポイントがネットワークボリューム（SMB / NFS / AFP / WebDAV 等）かを判定する。
 * 判定できない場合は false（＝ローカル扱い）を返す。ローカルデバイスを
 * 誤って隠してしまうより、判定不能時は表示する方が実害が小さい。
 *
 * @param table 事前に取得したマウントテーブル（省略時はその場で `mount` を実行）
 */
export function isNetworkVolume(mountPath: string, table?: MountTable): boolean {
  if (!mountPath) return false;
  const mounts = table ?? getMountTable();
  const fsType = mounts.get(normalize(mountPath));
  return fsType ? isNetworkFsType(fsType) : false;
}
