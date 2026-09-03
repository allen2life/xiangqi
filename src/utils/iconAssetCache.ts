/**
 * 图标 Blob URL 缓存——单一数据源。
 *
 * 启动时 fetch 图标为 blob → createObjectURL，得到 blob: URL。
 * PIXI（new Image(blobUrl) → Texture）与 DOM（<img src=blobUrl>）共用同一份 blob，
 * 单次 fetch、加载后零网络、Network 面板零条目。
 *
 * 调用顺序：startup 阶段 preloadPieceIcons / preloadIconBlobs → 渲染时 resolveIconSrc。
 * 未命中时回退原始 URL（仍可显示，仅发一次请求）。
 */
const blobUrlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

export function resolveIconSrc(url: string): string {
  return blobUrlCache.get(url) ?? url;
}

/** fetch 一次 → blob URL，缓存并返回；并发同 URL 去重。失败抛出，由调用方容错。 */
export function fetchIconBlobUrl(url: string): Promise<string> {
  const cached = blobUrlCache.get(url);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(url, blobUrl);
      return blobUrl;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

export async function preloadIconBlobs(urls: readonly string[]): Promise<void> {
  await Promise.all([...new Set(urls)].map(async (url) => {
    try { await fetchIconBlobUrl(url); } catch { /* resolveIconSrc 回退原 URL */ }
  }));
}
