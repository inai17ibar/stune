/**
 * ボリュームのファイルシステム種別の判定
 *
 * ネットワークマウント（SMB / NFS / AFP など）は Walkman ではありえないので、
 * デバイス検出から除外する必要がある。
 *
 * macOS の BSD stat にはファイルシステム種別を返す書式がない
 * （`stat -f '%T'` はファイル種別のサフィックスであってマウント種別ではない）ため、
 * `/sbin/mount` の出力をパースして判定する。mount の一覧に現れないパスについては
 * `diskutil info` の Protocol フィールドをフォールバックとして使う。
 */

import { execSync } from 'child_process';

/** mount(8) が報告するネットワークファイルシステムの種別 */
const NETWORK_FS_TYPES = [
  'smbfs',
  'nfs',
  'afpfs',
  'cifs',
  'webdav',
  'ftp',
  'sshfs',
  'acfs',
  'autofs',
];

/** diskutil info の Protocol フィールドがネットワーク接続を示す値 */
const NETWORK_PROTOCOLS = ['smb', 'afp', 'nfs', 'webdav', 'ftp', 'network'];

/** GUI 起動の Electron は PATH が最小限なので絶対パスで叩く */
const MOUNT_BINARY = '/sbin/mount';
const DISKUTIL_BINARY = '/usr/sbin/diskutil';
const EXEC_TIMEOUT_MS = 2000;

/**
 * `/sbin/mount` の出力を「マウントポイント → ファイルシステム種別」に変換する。
 *
 * 出力例:
 * ```
 * /dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
 * /dev/disk4s1 on /Volumes/WALKMAN (msdos, local, nodev, nosuid, noowners)
 * //guest@nas._smb._tcp.local/music on /Volumes/music (smbfs, nodev, nosuid, mounted by me)
 * ```
 */
export function parseMountTable(output: string): Map<string, string> {
  const table = new Map<string, string>();
  for (const line of output.split('\n')) {
    // "<device> on <mount point> (<fstype>, <option>, ...)"
    const match = line.match(/\son\s(.+?)\s\(([^,)\s]+)/);
    if (!match) continue;
    table.set(normalizePath(match[1]), match[2].trim().toLowerCase());
  }
  return table;
}

/** ファイルシステム種別がネットワーク越しのものかを判定する */
export function isNetworkFsType(fsType: string): boolean {
  const normalized = fsType.trim().toLowerCase();
  return NETWORK_FS_TYPES.some(
    (nfs) => normalized === nfs || normalized.startsWith(`${nfs}_`)
  );
}

/** diskutil info の出力から Protocol を読み、ネットワーク接続かを判定する */
export function isNetworkProtocolOutput(output: string): boolean {
  const match = output.match(/^\s*Protocol:\s*(.+)$/im);
  if (!match) return false;
  const protocol = match[1].trim().toLowerCase();
  return NETWORK_PROTOCOLS.some((p) => protocol.includes(p));
}

function normalizePath(p: string): string {
  const trimmed = p.trim().replace(/\/+$/, '');
  return trimmed || '/';
}

/** 現在のマウント一覧を取得する。取得できなければ空の Map を返す */
export function readMountTable(): Map<string, string> {
  try {
    const output = execSync(MOUNT_BINARY, {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseMountTable(output);
  } catch {
    // macOS 以外、または mount が使えない環境
    return new Map();
  }
}

/** mount の一覧にないパスを diskutil info の Protocol で判定する */
function isNetworkByDiskutil(mountPath: string): boolean {
  try {
    const output = execSync(
      `${DISKUTIL_BINARY} info ${JSON.stringify(mountPath)}`,
      {
        encoding: 'utf-8',
        timeout: EXEC_TIMEOUT_MS,
        // マウントされていないパスでは失敗するので、その旨をログに垂れ流さない
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    return isNetworkProtocolOutput(output);
  } catch {
    // diskutil が扱えない = そもそもディスクではない可能性が高いが、
    // 判断材料がないので除外はしない
    return false;
  }
}

/**
 * マウントパスがネットワークボリューム（SMB, NFS, AFP 等）かを判定する。
 * `mountTable` を渡すと mount の再実行を省ける（検出ループ用）。
 */
export function isNetworkVolume(
  mountPath: string,
  mountTable?: Map<string, string>
): boolean {
  const normalized = normalizePath(mountPath);
  const table = mountTable ?? readMountTable();
  const fsType = table.get(normalized);
  if (fsType) return isNetworkFsType(fsType);
  return isNetworkByDiskutil(normalized);
}
