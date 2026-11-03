import { describe, expect, it, vi } from 'vitest';
import { isAppDocument, secureWebContents } from './windowSecurity';
import type { WebContents } from 'electron';

describe('window navigation boundary', () => {
  it('cancels navigation, frame navigation, redirects, webviews and every popup', async () => {
    const handlers = new Map<string, any>();
    let popup: any;
    const open = vi.fn().mockResolvedValue(undefined);
    secureWebContents({
      on: (event: string, callback: any) => handlers.set(event, callback),
      setWindowOpenHandler: (callback: any) => { popup = callback; },
    } as unknown as WebContents, open);
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
      const preventDefault = vi.fn(); handlers.get(name)({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    }
    for (const url of ['file:///tmp/cover.html', 'javascript:alert(1)', 'data:text/html,test', 'stune-audio://test', 'invalid']) {
      expect(popup({ url })).toEqual({ action: 'deny' });
    }
    expect(open).not.toHaveBeenCalled();
    for (const url of ['https://example.com', 'http://example.com']) {
      expect(popup({ url })).toEqual({ action: 'deny' });
      expect(open).toHaveBeenCalledWith(url);
    }
  });
  it('trusts only the app document (optional hash), never arbitrary same-origin pages', () => {
    for (const app of ['http://localhost:5173/', 'file:///app/dist/index.html']) {
      expect(isAppDocument(app + '#albums', app)).toBe(true);
      for (const url of ['file:///tmp/cover.html', 'http://localhost:5173/cover.html', app + '?other=1', 'https://evil.example']) {
        expect(isAppDocument(url, app)).toBe(false);
      }
    }
  });
});
