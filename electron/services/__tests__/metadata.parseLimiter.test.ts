// runWithParseSlot: parseFile の同時実行数を 4 に制限し、スロットは
// タスクの Promise が settle するまで保持される（タイムアウトでは解放されない）ことを検証する。
// 実タイマーも music-metadata も使わず、手動で解決する deferred で決定的に検証する。
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// マイクロタスクキューを掃き出す
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let runWithParseSlot: typeof import('../metadata').runWithParseSlot;

beforeEach(async () => {
  // リミッタはモジュールレベルの状態を持つので、テストごとに読み直す
  vi.resetModules();
  ({ runWithParseSlot } = await import('../metadata'));
});

describe('runWithParseSlot', () => {
  it('never runs more than 4 tasks at once and starts queued tasks FIFO', async () => {
    const defs = Array.from({ length: 6 }, () => deferred<number>());
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const results = defs.map((d, i) =>
      runWithParseSlot(() => {
        started.push(i);
        active++;
        maxActive = Math.max(maxActive, active);
        return d.promise.finally(() => {
          active--;
        });
      })
    );

    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(active).toBe(4);

    // 2 番目を settle させると、待機中の先頭 (4) が始まる
    defs[1].resolve(1);
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    // reject でもスロットは解放され、次 (5) が始まる
    defs[0].reject(new Error('boom'));
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);

    defs[2].resolve(2);
    defs[3].resolve(3);
    defs[4].resolve(4);
    defs[5].resolve(5);

    await expect(results[0]).rejects.toThrow('boom');
    await expect(Promise.all(results.slice(1))).resolves.toEqual([1, 2, 3, 4, 5]);
    expect(maxActive).toBe(4);
    expect(active).toBe(0);
  });

  it('a never-settling task holds its slot, so a 5th task does not start', async () => {
    const started: number[] = [];
    for (let i = 0; i < 4; i++) {
      // 決して settle しない（タイムアウトした呼び出し側が手放したパースに相当）
      void runWithParseSlot(() => {
        started.push(i);
        return new Promise<never>(() => {});
      });
    }

    let fifthStarted = false;
    void runWithParseSlot(async () => {
      fifthStarted = true;
    });

    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(fifthStarted).toBe(false);
  });
});
