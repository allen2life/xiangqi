const SPEED_KEY = 'xiangqi-battle-speed';
export const SPEED_OPTIONS = [1, 1.5, 2] as const;
export type BattleSpeed = typeof SPEED_OPTIONS[number];

let currentSpeed: BattleSpeed = 1;

try {
  const stored = localStorage.getItem(SPEED_KEY);
  if (stored) {
    const val = parseFloat(stored);
    if (SPEED_OPTIONS.includes(val as BattleSpeed)) {
      currentSpeed = val as BattleSpeed;
    }
  }
} catch { /* ignore */ }

export function getBattleSpeed(): BattleSpeed {
  return currentSpeed;
}

const listeners = new Set<(speed: BattleSpeed) => void>();

export function setBattleSpeed(speed: BattleSpeed): void {
  currentSpeed = speed;
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch { /* ignore */ }
  listeners.forEach(fn => fn(speed));
}

export function onBattleSpeedChange(fn: (speed: BattleSpeed) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
