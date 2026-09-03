/**
 * Build-time injected constants — see vite.config.ts `define`.
 * `engineVersion` is set at runtime once the WASM engine boots.
 */
const info = {
  hash: __BUILD_HASH__,
  time: __BUILD_TIME__,
  engineVersion: null as string | null,
};

export function setEngineVersion(v: string): void {
  info.engineVersion = v;
}

/** Readonly snapshot — engineVersion may be null until engine boots. */
export function getBuildInfo(): Readonly<typeof info> {
  return info;
}

/** Compact display string for the corner watermark. */
export function formatBuildLabel(): string {
  const d = new Date(info.time);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${info.hash} | ${time}`;
}
