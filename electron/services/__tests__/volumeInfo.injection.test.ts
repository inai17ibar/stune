// 再現テスト: ボリューム名に $(...) / `...` を含むボリュームがマウントされていると
// isNetworkVolume() → isNetworkByDiskutil() の execSync（シェル経由）で
// コマンド置換が実行される。
// child_process は意図的にモックしない（実際にシェルが走るかどうかを見るため）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parseMountTable, isNetworkVolume } from '../volumeInfo';

let marker: string;

function cleanup() {
  try {
    fs.unlinkSync(marker);
  } catch {
    /* ignore */
  }
}

beforeEach(() => {
  marker = path.join(
    os.tmpdir(),
    `stune-injection-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  cleanup();
});

afterEach(cleanup);

describe('volume name is passed to a shell', () => {
  it('does not execute command substitution embedded in a volume name', () => {
    // 攻撃者が用意した dmg / USB のボリューム名。
    const volumeName = `WALKMAN ($(touch ${marker}))`;
    const mountPath = `/Volumes/${volumeName}`;

    // mount の一覧に現れないパス（= diskutil フォールバックに落ちる経路）。
    // 外付けディスクが mount(8) に出ない状況は実際に起こるので、
    // ここはそのケースを再現している。
    const table = parseMountTable(
      '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)'
    );
    // 前提: テーブル照合が外れて diskutil フォールバックに落ちる
    expect(table.get(mountPath)).toBeUndefined();

    isNetworkVolume(mountPath, table);

    expect(fs.existsSync(marker)).toBe(false);
  });

  it('does not execute backquoted commands embedded in a volume name', () => {
    const mountPath = `/Volumes/WALKMAN \`touch ${marker}\``;
    const table = new Map<string, string>();

    isNetworkVolume(mountPath, table);

    expect(fs.existsSync(marker)).toBe(false);
  });

  it('matches a mount point containing " (" so the fallback is not taken', () => {
    // 本来の防御線: " (" を含むボリューム名でもマウントテーブル照合が当たるので、
    // そもそも diskutil フォールバック（= 外部入力を子プロセスに渡す経路）に落ちない。
    const volumeName = `WALKMAN ($(touch ${marker}))`;
    const mountPath = `/Volumes/${volumeName}`;
    const table = parseMountTable(
      `/dev/disk5s1 on ${mountPath} (msdos, local, nodev, nosuid, noowners)`
    );

    expect(table.get(mountPath)).toBe('msdos');
    expect(isNetworkVolume(mountPath, table)).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
