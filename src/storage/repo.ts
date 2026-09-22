// 存储层（storage）：localStorage 单一快照原子读写。
// 仅负责"怎么存/怎么取"，不含任何业务判定。
// 个案、排班、交接、版本同居于一个 state 快照 -> 刷新后天然一致。
import type { AppState } from "../domain/types";
import { buildSeed } from "../domain/seed";

const KEY = "hxwl-12-supervision-state-v1";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.cases) && Array.isArray(parsed.sessions)) {
        return parsed;
      }
    }
  } catch {
    // 损坏则回退种子
  }
  return buildSeed();
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function clearState(): void {
  localStorage.removeItem(KEY);
}
