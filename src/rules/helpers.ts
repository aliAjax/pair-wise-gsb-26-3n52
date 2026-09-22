// 判定层公共工具：结果封装、id 生成、版本追加。纯函数，不依赖存储。
import type { AppState, VersionRecord } from "../domain/types";

export interface Violation {
  code: string;
  message: string;
  sessionId?: string;
}

export interface RuleResult {
  ok: boolean;
  violations: Violation[];
}

/** 判定通过时返回新状态；失败时不带 state（调用方保留原计划） */
export interface MutateResult {
  ok: boolean;
  violations: Violation[];
  state?: AppState;
}

export function ok(): RuleResult {
  return { ok: true, violations: [] };
}

export function reject(violations: Violation[]): RuleResult {
  return { ok: false, violations };
}

export function err(code: string, message: string, sessionId?: string): Violation {
  return { code, message, sessionId };
}

let seq = 0;
export function genId(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

/** 追加一条留痕版本，revision 自增 */
export function pushVersion(
  state: AppState,
  entry: Omit<VersionRecord, "id" | "at" | "revision">,
): AppState {
  const revision = state.versions.reduce((m, v) => Math.max(m, v.revision ?? 0), 0) + 1;
  const record: VersionRecord = {
    id: genId("V"),
    at: Date.now(),
    revision,
    ...entry,
  };
  return { ...state, versions: [record, ...state.versions] };
}
