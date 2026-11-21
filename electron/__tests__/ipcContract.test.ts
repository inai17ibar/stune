// IPC は main.ts / preload.ts / global.d.ts の3か所をそろえて追加する必要がある。
// 1か所でも漏れると実行時まで気づけないので、ここで機械的に突き合わせる。
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf-8');

const main = read('electron/main.ts');
const preload = read('electron/preload.ts');
const globalDts = read('src/global.d.ts');

const matchAll = (src: string, re: RegExp) => new Set([...src.matchAll(re)].map((m) => m[1]));

const handled = matchAll(main, /handleTrusted\(\s*'([^']+)'/g);
const invoked = matchAll(preload, /ipcRenderer\.invoke\(\s*'([^']+)'/g);
const listened = matchAll(preload, /ipcRenderer\.on\(\s*'([^']+)'/g);
const sent = matchAll(main, /webContents\.send\(\s*'([^']+)'/g);

const bridgeBody = preload.slice(preload.indexOf('exposeInMainWorld'));
const preloadKeys = matchAll(bridgeBody, /^\s{2}(\w+)\s*:/gm);
const apiBody = globalDts.slice(globalDts.indexOf('interface STuneAPI'), globalDts.indexOf('interface Window'));
const typedKeys = matchAll(apiBody, /^\s{2}(\w+)\s*:/gm);

describe('IPC contract', () => {
  it('parses something (guards against the regexes silently matching nothing)', () => {
    expect(handled.size).toBeGreaterThan(10);
    expect(invoked.size).toBeGreaterThan(10);
    expect(preloadKeys.size).toBeGreaterThan(10);
  });

  it('every channel invoked in preload.ts has a handleTrusted() handler in main.ts', () => {
    const missing = [...invoked].filter((c) => !handled.has(c));
    expect(missing, 'main.ts に handleTrusted(channel, ...) を追加してください').toEqual([]);
  });

  it('every handler in main.ts is exposed through preload.ts', () => {
    const unused = [...handled].filter((c) => !invoked.has(c));
    expect(unused, 'preload.ts で公開するか、不要なら main.ts から削除してください').toEqual([]);
  });

  it('every event listened to in preload.ts is sent from main.ts', () => {
    const missing = [...listened].filter((c) => !sent.has(c));
    expect(missing, 'main.ts から webContents.send(channel, ...) していないイベントです').toEqual([]);
  });

  it('window.stune in preload.ts and STuneAPI in global.d.ts have the same keys', () => {
    expect([...preloadKeys].sort(), 'src/global.d.ts の STuneAPI 型を preload.ts とそろえてください').toEqual(
      [...typedKeys].sort()
    );
  });
});
