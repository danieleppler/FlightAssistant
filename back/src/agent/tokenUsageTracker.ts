const MAX_TOKENS_PER_WINDOW = 50000;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

interface UsageWindow {
  tokensUsed: number;
  windowStart: number;
}

const usage = new Map<string, UsageWindow>();

function getWindow(key: string): UsageWindow {
  const existing = usage.get(key);
  const now = Date.now();

  if (!existing || now - existing.windowStart > WINDOW_MS) {
    const fresh: UsageWindow = { tokensUsed: 0, windowStart: now };
    usage.set(key, fresh);
    return fresh;
  }

  return existing;
}

export function isOverBudget(key: string): boolean {
  return getWindow(key).tokensUsed >= MAX_TOKENS_PER_WINDOW;
}

export function getWindowResetAt(key: string): number {
  return getWindow(key).windowStart + WINDOW_MS;
}

export function recordUsage(key: string, tokens: number): void {
  getWindow(key).tokensUsed += tokens;
}

function sweep(): void {
  const now = Date.now();
  for (const [key, window] of usage) {
    if (now - window.windowStart > WINDOW_MS) {
      usage.delete(key);
    }
  }
}

setInterval(sweep, SWEEP_INTERVAL_MS).unref();
