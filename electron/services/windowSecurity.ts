import type { WebContents } from 'electron';

export function isAppDocument(url: string, appUrl: string): boolean {
  try {
    const candidate = new URL(url);
    const expected = new URL(appUrl);
    candidate.hash = '';
    expected.hash = '';
    return candidate.href === expected.href;
  } catch { return false; }
}

export function secureWebContents(contents: WebContents, openExternal: (url: string) => Promise<void>) {
  // loadURL/loadFile are main-process initiated and do not emit these events.
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    try {
      if (['http:', 'https:'].includes(new URL(url).protocol)) {
        void openExternal(url).catch(() => {});
      }
    } catch { /* malformed URLs are denied too */ }
    return { action: 'deny' };
  });
}
