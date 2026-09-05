/**
 * デバイスの取り出し（イジェクト）
 *
 * - USB マウント: `diskutil eject` で安全に取り出す。使用中で失敗した場合は
 *   強制アンマウントにフォールバックする。
 * - MTP: ソフトウェアからは取り出せないので、MTP セッションを切断して一覧から隠し、
 *   USB ケーブルを抜くよう案内する（抜いた時点で Walkman がデータベースを再構築する）。
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import { isMtpPath, mtpDisconnect } from './mtp';
import { markDeviceEjected } from './device';
import { isNetworkVolume } from './mounts';

/**
 * diskutil の絶対パス。GUI から起動された Electron アプリの PATH は最小限で
 * /usr/sbin を含まないことがあるため、存在すれば絶対パスを使う。
 * （この PATH 問題が「eject-device が動かない」主要因のひとつ）
 */
const DISKUTIL_ABSOLUTE = '/usr/sbin/diskutil';
const EXEC_TIMEOUT_MS = 30_000;
const VOLUMES_PREFIX = '/Volumes/';

export interface EjectResult {
  success: boolean;
  message: string;
  /** MTP のように、ユーザーが物理的にケーブルを抜く必要がある場合 true */
  requiresManualDisconnect?: boolean;
}

interface CommandResult {
  ok: boolean;
  /** stdout + stderr（空なら実行エラーのメッセージ） */
  output: string;
}

function diskutilBinary(): string {
  try {
    return fs.existsSync(DISKUTIL_ABSOLUTE) ? DISKUTIL_ABSOLUTE : 'diskutil';
  } catch {
    return 'diskutil';
  }
}

/** diskutil を実行する。失敗しても reject せず結果を返す */
function runDiskutil(args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      diskutilBinary(),
      args,
      { timeout: EXEC_TIMEOUT_MS },
      (err, stdout, stderr) => {
        const combined = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
        resolve({
          ok: !err,
          output: combined || (err ? err.message : ''),
        });
      }
    );
  });
}

/** 末尾のスラッシュを落として比較しやすくする */
function normalizeMountPath(mountPath: string): string {
  return mountPath.replace(/\/+$/, '');
}

/**
 * 取り出し対象として安全なパスかを検証する。
 * 問題があればユーザー向けメッセージを、問題なければ null を返す。
 * `original` はエラー表示用（正規化前のユーザー入力）。
 */
function validateVolumePath(mountPath: string, original: string): string | null {
  if (!mountPath.startsWith(VOLUMES_PREFIX)) {
    return `取り出せるのは /Volumes 以下のボリュームのみです: ${original}`;
  }
  const volumeName = mountPath.slice(VOLUMES_PREFIX.length);
  if (!volumeName || volumeName.includes('/')) {
    return `ボリュームのマウントポイントではありません: ${original}`;
  }
  return null;
}

function isBusyError(output: string): boolean {
  return /busy|in use|dissent|couldn't unmount|could not be unmounted|unmount failed/i.test(
    output
  );
}

function isMissingVolumeError(output: string): boolean {
  // 実際の diskutil の文言: "Failed to find disk /Volumes/WALKMAN"
  return /failed to find|could not find|unable to find|no such file|not a valid|ENOENT/i.test(
    output
  );
}

function firstLine(output: string): string {
  const line = output
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? '不明なエラー';
}

/**
 * マウントポイントから物理ディスク（例: /dev/disk4）を解決する。
 * 強制アンマウント後はマウントポイントが消えるため、先に取得しておく必要がある。
 */
async function resolveWholeDisk(mountPath: string): Promise<string | null> {
  const info = await runDiskutil(['info', mountPath]);
  if (!info.ok) return null;
  const match = info.output.match(/Part of Whole:\s*(disk\d+)/i);
  return match ? `/dev/${match[1]}` : null;
}

/**
 * ネットワークボリュームを切断する。
 * `diskutil eject` は物理ディスクを対象とするため SMB / NFS 等では失敗する
 * （"Failed to find disk"）。アンマウントが正しい操作。
 */
async function disconnectNetworkVolume(
  normalized: string
): Promise<EjectResult> {
  const unmounted = await runDiskutil(['unmount', normalized]);
  if (!unmounted.ok && !isMissingVolumeError(unmounted.output)) {
    return {
      success: false,
      message: `ネットワークボリュームの切断に失敗しました: ${firstLine(unmounted.output)}`,
    };
  }

  markDeviceEjected(normalized);
  return {
    success: true,
    message: 'ネットワークボリュームを切断しました。',
  };
}

async function ejectUsbVolume(mountPath: string): Promise<EjectResult> {
  const normalized = normalizeMountPath(mountPath);
  const invalid = validateVolumePath(normalized, mountPath);
  if (invalid) return { success: false, message: invalid };

  if (isNetworkVolume(normalized)) {
    return await disconnectNetworkVolume(normalized);
  }

  const wholeDisk = await resolveWholeDisk(normalized);

  const ejected = await runDiskutil(['eject', normalized]);
  if (ejected.ok) {
    markDeviceEjected(normalized);
    return {
      success: true,
      message: 'デバイスを取り出しました。USB ケーブルを安全に抜けます。',
    };
  }

  // すでにアンマウントされている場合は成功として扱う（一覧から消えるのが目的）
  if (isMissingVolumeError(ejected.output)) {
    markDeviceEjected(normalized);
    return {
      success: true,
      message: 'デバイスはすでに取り出されています。',
    };
  }

  if (!isBusyError(ejected.output)) {
    return {
      success: false,
      message: `取り出しに失敗しました: ${firstLine(ejected.output)}`,
    };
  }

  // 使用中 → 強制アンマウントにフォールバック
  const forced = await runDiskutil(['unmount', 'force', normalized]);
  if (!forced.ok) {
    return {
      success: false,
      message:
        'デバイスが使用中のため取り出せませんでした。再生を停止し、Finder やターミナルでデバイス内のファイルを開いていないか確認してください。',
    };
  }

  markDeviceEjected(normalized);
  // マウントポイントは消えたので、物理ディスクの取り出しはベストエフォートで実行
  if (wholeDisk) await runDiskutil(['eject', wholeDisk]);
  return {
    success: true,
    message:
      '使用中のファイルがあったため強制的に取り出しました。USB ケーブルを抜けます。',
  };
}

function ejectMtpDevice(mountPath: string): EjectResult {
  // MTP セッションを解放してから一覧から隠す（隠さないとポーリングで復活する）
  mtpDisconnect();
  markDeviceEjected(mountPath);
  return {
    success: true,
    requiresManualDisconnect: true,
    message:
      'MTP セッションを切断しました。USB ケーブルを抜いてください（Walkman がデータベースの再構築を開始します）。',
  };
}

/** USB / MTP を判別してデバイスを取り出す */
export async function ejectDevice(mountPath: string): Promise<EjectResult> {
  if (!mountPath) {
    return { success: false, message: '取り出すデバイスが指定されていません。' };
  }
  if (isMtpPath(mountPath)) return ejectMtpDevice(mountPath);
  return await ejectUsbVolume(mountPath);
}
