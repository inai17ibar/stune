// 再現テスト: music-metadata 11.12.1 (CVE-2026-107388 / GHSA-jjpr-9cvf-cq55) は
// ID3v2 ヘッダのタグサイズを検証せずに確保するため、10 バイトのファイル 1 つで
// 256MB を割り当てる。metadata.ts:43 の parseFile がこの経路。
//
// 注: metadata.ts の readTrackMetadata 経由では検証できない。
// metadata.ts は ESM 回避のため `new Function('s','return import(s)')` で
// music-metadata を読み込むが、vitest では
// "A dynamic import callback was not specified" になり、
// readTrackMetadata の try/catch がそれを飲み込んで既定値を返してしまう。
// そのため scanFolderIntoDb が各ファイルに対して呼ぶのと同じ parseFile を直接叩く。
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFile } from 'music-metadata';

describe('music-metadata ID3v2 allocation', () => {
  it('does not allocate hundreds of MB for a 10-byte mp3', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stune-id3-'));
    const file = path.join(dir, 'tiny.mp3');
    // "ID3" + v2.4.0 + flags=0 + syncsafe タグサイズ最大 (0x7F7F7F7F = 268435455)
    await fs.promises.writeFile(
      file,
      Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x7f, 0x7f, 0x7f, 0x7f])
    );

    const before = process.memoryUsage();
    // 修正前 (11.12.1): エラーを投げずに 256MB 確保して正常終了する。
    //   = readTrackMetadata の try/catch では防げない。
    // 修正後 (11.16.0+): 確保前にサイズを検証し UnexpectedFileContentError を投げる。
    //   = 確保されず、かつ try/catch で捕まえられる。
    // どちらでも測れるように例外を受け止めてからメモリを比較する。
    let threw: unknown = null;
    try {
      await parseFile(file);
    } catch (err) {
      threw = err;
    }
    const after = process.memoryUsage();

    const grownMb = (after.external - before.external) / 1024 / 1024;
    expect(Math.round(grownMb)).toBeLessThan(50);

    // パースが失敗する分には問題ないが、捕まえられる例外でなければならない
    if (threw !== null) {
      expect(threw).toBeInstanceOf(Error);
    }

    await fs.promises.rm(dir, { recursive: true, force: true });
  }, 60000);
});
