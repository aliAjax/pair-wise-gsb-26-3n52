import type { AppState } from "../data/types";
import { buildSeed } from "../data/seed";

const KEY = "hxwl-12-handoff-desk-v1";

/** 读取本地持久化状态；为空或损坏时回落到示例数据 */
export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch {
    // 忽略损坏数据，重新播种
  }
  const seed = buildSeed();
  saveState(seed);
  return seed;
}

/** 每次判定通过后的整体落库，保证刷新后个案、排班、交接、版本一致 */
export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时保持内存态
  }
}

export function resetState(): AppState {
  const seed = buildSeed();
  saveState(seed);
  return seed;
}
