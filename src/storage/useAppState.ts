// 存储层：状态 hook。封装 load/save，对外暴露 apply() ——
// 只有判定通过（result.state 存在）才落库；失败保持原状态（保留原计划）。
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "../domain/types";
import { buildSeed } from "../domain/seed";
import { loadState, saveState } from "./repo";
import type { MutateResult, Violation } from "../rules/helpers";

export interface Notice {
  ok: boolean;
  violations: Violation[];
  at: number;
}

export function useAppState() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const apply = useCallback((result: MutateResult): boolean => {
    if (result.ok && result.state) {
      setState(result.state);
      setNotice({ ok: true, violations: [], at: Date.now() });
      return true;
    }
    // 整笔拒绝：不更新 state -> 原计划保留
    setNotice({ ok: false, violations: result.violations, at: Date.now() });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 9000);
    return false;
  }, []);

  const dismiss = useCallback(() => setNotice(null), []);

  const reset = useCallback(() => {
    setState(buildSeed());
    setNotice({ ok: true, violations: [], at: Date.now() });
  }, []);

  return { state, notice, apply, dismiss, reset };
}
