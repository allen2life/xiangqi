/**
 * Corner version watermark — only visible in debug mode (?debug=1).
 * Click to fetch /deploys.json and log build info + deploy history to console.
 */
import { formatBuildLabel, getBuildInfo } from './buildInfo';

export function initVersionWatermark(): void {
  if (!new URLSearchParams(window.location.search).has('debug')) return;

  const el = document.createElement('div');
  el.id = 'version-watermark';
  el.classList.add('debug');
  el.textContent = formatBuildLabel();
  el.addEventListener('click', () => { void logAll(); });
  document.body.appendChild(el);
}

async function logAll(): Promise<void> {
  const info = getBuildInfo();
  console.log(
    '%c🚀 ChessBlast Build Info',
    'color:#c9a050;font-size:14px;font-weight:bold',
  );
  console.log(`  frontend: ${info.hash}`);
  console.log(`  built:    ${new Date(info.time).toLocaleString('zh-CN', { hour12: false })}`);
  console.log(`  engine:   ${info.engineVersion ?? '—'}`);

  try {
    const res = await fetch('/deploys.json');
    if (!res.ok) throw new Error(`${res.status}`);
    const data: DeployEntry[] = await res.json();
    if (!data.length) { console.log('  deploys:  (empty)'); return; }
    console.log(
      '%c  Recent deploys (%d)',
      'color:#c9a050',
      Math.min(data.length, 5),
    );
    console.table(
      data.slice(0, 5).map((d) => ({
        time: d.time.replace('T', ' ').slice(0, 16),
        commit: d.commit,
        mode: d.mode,
        msg: d.msg,
      })),
    );
  } catch {
    console.log('  deploys:  unavailable');
  }
}

interface DeployEntry {
  time: string;
  commit: string;
  msg: string;
  mode: string;
}
