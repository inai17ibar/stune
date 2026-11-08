import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  frame: { url: 'http://localhost:5173/' },
  contents: null as any,
  db: { version: 1, libraryPaths: [] as string[], masterFolder: '', lastScanned: '', tracks: {} as Record<string, any> },
  devices: [] as any[],
  save: vi.fn(),
  upload: vi.fn(async (..._args: any[]) => ({ success: true })),
  uploadOne: vi.fn(async (..._args: any[]) => ({ ok: true })),
  openSession: vi.fn(),
  closeSession: vi.fn(async () => {}),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, whenReady: () => Promise.resolve(), on: vi.fn(), getPath: () => os.tmpdir() },
  BrowserWindow: class {
    webContents = state.contents = { mainFrame: state.frame, on: vi.fn(), setWindowOpenHandler: vi.fn(), send: vi.fn() };
    on = vi.fn(); loadURL = vi.fn(); loadFile = vi.fn();
  },
  ipcMain: { handle: (name: string, fn: any) => state.handlers.set(name, fn) },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  shell: { openExternal: vi.fn() }, dialog: {}, session: {}, net: {},
}));
vi.mock('../services/device', () => ({ watchDevices: vi.fn(), getConnectedWalkman: async () => state.devices, refreshDevices: vi.fn() }));
vi.mock('../services/libraryDb', () => ({
  loadLibraryDb: async () => state.db, saveLibraryDb: (...args: any[]) => state.save(...args),
  dbToLibrary: (db: any) => db, scanFolderIntoDb: vi.fn(), removeFolderFromDb: vi.fn(), updateTrackCustomMeta: vi.fn(),
}));
vi.mock('../services/mtp', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/mtp')>(),
  mtpUpload: (...args: any[]) => state.upload(...args),
  openMtpSession: async (...args: any[]) => {
    state.openSession(...args);
    return { uploadOne: (...a: any[]) => state.uploadOne(...a), close: () => state.closeSession() };
  },
}));
beforeAll(async () => { await import('../main'); });
const event = () => ({ sender: state.contents, senderFrame: state.frame });

describe('registered main IPC handlers', () => {
  it('does not expose unused privileged handlers', () => {
    for (const name of ['delete-tracks', 'read-metadata', 'scan-library', 'show-in-finder']) {
      expect(state.handlers.has(name)).toBe(false);
    }
  });
  it('rejects outside files and deletes normal registered music through actual IPC', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stune-ipc-'));
    try {
      const root = path.join(dir, 'music'); await fs.mkdir(root);
      const victim = path.join(dir, 'private.txt'); await fs.writeFile(victim, 'keep');
      const song = path.join(root, 'song.mp3'); await fs.writeFile(song, 'audio');
      state.db.libraryPaths = [root]; state.db.tracks[song] = { filePath: song };
      const handler = state.handlers.get('delete-library-tracks')!;
      const result = await handler(event(), { filePaths: [victim, song], fromDisk: true });
      expect(result.deletedCount).toBe(1); expect(result.errors).toHaveLength(1);
      expect(await fs.readFile(victim, 'utf8')).toBe('keep');
      await expect(fs.stat(song)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(state.save).toHaveBeenCalled();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('rejects another window, subframe and navigated app frame before privileged work', () => {
    const handler = state.handlers.get('delete-library-tracks')!;
    for (const candidate of [
      { sender: {}, senderFrame: state.frame },
      { sender: state.contents, senderFrame: { url: state.frame.url } },
    ]) expect(() => handler(candidate, { filePaths: [], fromDisk: true })).toThrow('Untrusted IPC sender');
    state.frame.url = 'file:///tmp/cover.html';
    try { expect(() => handler(event(), { filePaths: [], fromDisk: true })).toThrow('Untrusted IPC sender'); }
    finally { state.frame.url = 'http://localhost:5173/'; }
  });
  it('deletes lowercase USB music through IPC while rejecting traversal and symlink escapes', async () => {
    const mount = await fs.mkdtemp(path.join(os.tmpdir(), 'stune-usb-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'stune-outside-'));
    try {
      state.devices = [{ mountPath: mount }];
      const root = path.join(mount, 'music'); await fs.mkdir(root);
      const song = path.join(root, 'song.mp3'); await fs.writeFile(song, 'audio');
      const victim = path.join(outside, 'song.mp3'); await fs.writeFile(victim, 'keep');
      await fs.symlink(outside, path.join(root, 'escape'));
      await fs.symlink(victim, path.join(root, 'link.mp3'));
      const handler = state.handlers.get('delete-device-tracks')!;
      const result = await handler(event(), { mountPath: mount, filePaths: [song,
        path.join(root, 'escape', 'song.mp3'), path.join(root, 'link.mp3'), root + '/../secret.mp3'] });
      expect(result.deletedCount).toBe(1);
      expect(result.errors).toHaveLength(3);
      await expect(fs.stat(song)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(victim, 'utf8')).toBe('keep');
      await fs.rm(root, { recursive: true });
      await fs.symlink(outside, root);
      const escapedRoot = await handler(event(), { mountPath: mount, filePaths: [path.join(root, 'song.mp3')] });
      expect(escapedRoot.deletedCount).toBe(0);
      expect(await fs.readFile(victim, 'utf8')).toBe('keep');
    } finally {
      state.devices = [];
      await fs.rm(mount, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
  it.each(['..', ' .. ', '../../escape', 'Normal Artist'])('keeps USB and MTP structured transfers contained for %j tags', async (tag) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stune-transfer-'));
    try {
      const source = path.join(dir, 'song.mp3');
      await fs.writeFile(source, 'audio');
      state.db.tracks[source] = { filePath: source, artist: tag, album: tag };
      const handler = state.handlers.get('copy-tracks-structured')!;
      const usb = await handler(event(), { sourcePaths: [source], deviceMountPath: dir });
      expect(usb.errors).toEqual([]);
      const { buildExpectedDevicePath } = await import('../services/syncDiff');
      const relative = buildExpectedDevicePath({ ...state.db.tracks[source], fileName: 'song.mp3' });
      const destination = path.join(dir, 'MUSIC', relative);
      const fromRoot = path.relative(path.join(dir, 'MUSIC'), destination);
      expect(fromRoot === '..' || fromRoot.startsWith('..' + path.sep) || path.isAbsolute(fromRoot)).toBe(false);
      expect(await fs.readFile(destination, 'utf8')).toBe('audio');
      state.uploadOne.mockClear(); state.openSession.mockClear(); state.closeSession.mockClear();
      const mtp = await handler(event(), { sourcePaths: [source], deviceMountPath: 'mtp://storage' });
      expect(mtp.errors).toEqual([]);
      expect(state.openSession).toHaveBeenCalledTimes(1);
      expect(state.openSession).toHaveBeenCalledWith('mtp://storage');
      expect(state.uploadOne).toHaveBeenCalledTimes(1);
      expect(state.uploadOne.mock.calls[0][1]).toBe('/MUSIC/' + relative.split('/').slice(0, -1).join('/'));
      expect(state.closeSession).toHaveBeenCalledTimes(1);
      expect(await fs.readFile(source, 'utf8')).toBe('audio');
    } finally {
      delete state.db.tracks[path.join(dir, 'song.mp3')];
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  it('cannot use device deletion with an arbitrary filesystem root', async () => {
    await expect(state.handlers.get('delete-device-tracks')!(event(), { mountPath: '/', filePaths: ['/tmp/private.mp3'] }))
      .rejects.toThrow('Unknown device');
  });
});
