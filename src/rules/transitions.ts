// 判定层：状态流转。所有函数纯函数式：入 state -> 判定 -> 通过才返回新 state，
// 失败返回 violations 且不带 state（调用方据此"整笔拒绝、保留原计划"）。
import type {
  AppState,
  CaseRecord,
  FollowUp,
  RiskLevel,
  Session,
} from "../domain/types";
import { HOUR, overlaps } from "../domain/clock";
import {
  err,
  genId,
  pushVersion,
  reject,
  type MutateResult,
  type Violation,
} from "./helpers";
import { canCompleteSession, validateScheduling } from "./schedule";

const fail = (violations: Violation[]): MutateResult => ({ ok: false, violations });
const pass = (state: AppState): MutateResult => ({ ok: true, violations: [], state });

// -------------------------------------------------------------
// 个案登记：风险、随访截止、咨询师
// -------------------------------------------------------------
export interface RegisterCaseInput {
  codeName: string;
  theme: string;
  risk: RiskLevel;
  counselorId: string | null;
  followUpDeadline: number;
  note: string;
}

export function registerCase(state: AppState, input: RegisterCaseInput): MutateResult {
  const v: Violation[] = [];
  if (!input.codeName.trim()) v.push(err("FIELD", "来访者代号必填"));
  if (!input.theme.trim()) v.push(err("FIELD", "咨询主题必填"));
  if (!Number.isFinite(input.followUpDeadline)) v.push(err("FIELD", "随访截止无效"));
  if (input.counselorId) {
    const t = state.staff.find(
      (s) => s.id === input.counselorId && s.role === "咨询师",
    );
    if (!t) v.push(err("COUNSELOR_INVALID", "所选咨询师不存在"));
  }
  if (v.length) return fail(v);

  const t = Date.now();
  const id = `C-${Math.max(0, ...state.cases.map((c) => Number(c.id.split("-")[1]) || 0)) + 1
    .toString()
    .padStart(3, "0")}`;

  const nc: CaseRecord = {
    id,
    codeName: input.codeName.trim(),
    theme: input.theme.trim(),
    risk: input.risk,
    riskFlaggedAt: input.risk === "高风险" ? t : null,
    counselorId: input.counselorId,
    supervisorId: null,
    followUpDeadline: input.followUpDeadline,
    note: input.note.trim(),
    createdAt: t,
  };
  // 登记即建立首次危机随访，纳入随访台与交接承接
  const fu: FollowUp = {
    id: genId("F"),
    caseId: id,
    title: "首次随访",
    dueAt: input.followUpDeadline,
    status: "待随访",
    createdAt: t,
  };

  let next: AppState = {
    ...state,
    cases: [...state.cases, nc],
    followUps: [...state.followUps, fu],
  };
  next = pushVersion(next, {
    type: "case",
    operator: "机构管理员",
    reason: `登记个案（${input.risk}）`,
    detail: `${id} · ${nc.theme} · 咨询师 ${input.counselorId ?? "待派"}`,
  });
  return pass(next);
}

// -------------------------------------------------------------
// 督导接单：高风险个案 24h 窗口内由督导承接
// -------------------------------------------------------------
export function acceptSupervision(
  state: AppState,
  caseId: string,
  supervisorId: string,
): MutateResult {
  const c = state.cases.find((x) => x.id === caseId);
  if (!c) return fail([err("NOT_FOUND", "个案不存在")]);
  const sup = state.staff.find((s) => s.id === supervisorId && s.role === "督导");
  if (!sup) return fail([err("SUPERVISOR_INVALID", "接单人员不是有效督导")]);
  if (c.risk !== "高风险")
    return fail([err("NOT_HIGH_RISK", "仅高风险个案需危机督导接单")]);

  if (c.riskFlaggedAt && Date.now() - c.riskFlaggedAt > 24 * HOUR) {
    return fail([
      err(
        "WINDOW_EXPIRED",
        `${caseId} 已逾 24 小时接单窗口，需先重评风险后再排期`,
      ),
    ]);
  }

  return pass({
    ...state,
    cases: state.cases.map((x) =>
      x.id === caseId ? { ...x, supervisorId } : x,
    ),
  });
}

// -------------------------------------------------------------
// 批量排班提交：任一冲突整笔拒绝，保留原计划
// -------------------------------------------------------------
export function submitBatch(state: AppState, drafts: Session[]): MutateResult {
  const check = validateScheduling(state, drafts);
  if (!check.ok) return fail(check.violations);
  const confirmed = drafts.map((d) => ({ ...d, status: "confirmed" as const }));
  return pass({ ...state, sessions: [...state.sessions, ...confirmed] });
}

// -------------------------------------------------------------
// 完成会谈：高风险未接单禁止
// -------------------------------------------------------------
export function completeSession(state: AppState, sessionId: string): MutateResult {
  const check = canCompleteSession(state, sessionId);
  if (!check.ok) return fail(check.violations);
  return pass({
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? { ...s, status: "completed" as const } : s,
    ),
  });
}

// -------------------------------------------------------------
// 排期冻结 + 更正留原因版本
// -------------------------------------------------------------
export function freezeSchedule(state: AppState, operator: string): MutateResult {
  const now = Date.now();
  const targets = state.sessions.filter(
    (s) => s.status === "confirmed" && s.endAt > now,
  );
  if (targets.length === 0)
    return fail([err("NOTHING_TO_FREEZE", "没有可冻结的已确认未来排班")]);

  const frozenIds = new Set(targets.map((s) => s.id));
  let next: AppState = {
    ...state,
    sessions: state.sessions.map((s) =>
      frozenIds.has(s.id) ? { ...s, status: "frozen" as const } : s,
    ),
  };
  next = pushVersion(next, {
    type: "freeze",
    operator,
    reason: "排期冻结",
    detail: `冻结 ${targets.length} 条未来会谈：${targets
      .map((s) => s.id)
      .join("、")}`,
  });
  return pass(next);
}

export interface CorrectInput {
  sessionId: string;
  startAt: number;
  endAt: number;
  roomId: string;
  supervisorId: string | null;
  reason: string;
  operator: string;
}

/** 更正只允许作用于已冻结排期；必须填写原因，并产生新版本 */
export function correctSession(state: AppState, input: CorrectInput): MutateResult {
  const s = state.sessions.find((x) => x.id === input.sessionId);
  if (!s) return fail([err("NOT_FOUND", "会谈不存在")]);
  if (s.status !== "frozen")
    return fail([err("NOT_FROZEN", "仅已冻结排期可更正（先冻结或排期已锁）")]);
  if (!input.reason.trim())
    return fail([err("REASON_REQUIRED", "更正必须留存原因")]);
  if (!(input.startAt < input.endAt))
    return fail([err("TIME_INVALID", "起止时间无效")]);

  const revised: Session = {
    ...s,
    startAt: input.startAt,
    endAt: input.endAt,
    roomId: input.roomId,
    supervisorId: input.supervisorId,
  };

  // 更正后仍须满足排班规则（排除被修订的原排期，避免自冲突）
  const check = validateScheduling(state, [revised], Date.now(), new Set([s.id]));
  if (!check.ok) return fail(check.violations);

  let next: AppState = {
    ...state,
    sessions: state.sessions.map((x) => (x.id === s.id ? revised : x)),
  };
  next = pushVersion(next, {
    type: "correct",
    operator: input.operator,
    reason: input.reason.trim(),
    detail: `${s.id}（${s.caseId}）时间/会谈室/督导更正`,
  });
  return pass(next);
}

// -------------------------------------------------------------
// 改派交接：先建交接单；督导确认前原咨询师不释放；未完成随访随交接承接
// -------------------------------------------------------------
export interface CreateHandoverInput {
  caseId: string;
  toCounselorId: string;
  supervisorId: string;
  reason: string;
}

export function createHandover(state: AppState, input: CreateHandoverInput): MutateResult {
  const c = state.cases.find((x) => x.id === input.caseId);
  if (!c) return fail([err("NOT_FOUND", "个案不存在")]);
  if (!c.counselorId) return fail([err("NO_OWNER", "该个案当前无承接咨询师")]);
  if (c.counselorId === input.toCounselorId)
    return fail([err("SAME_COUNSELOR", "新咨询师不能与原咨询师相同")]);
  const to = state.staff.find(
    (x) => x.id === input.toCounselorId && x.role === "咨询师",
  );
  if (!to) return fail([err("COUNSELOR_INVALID", "新咨询师无效")]);
  const sup = state.staff.find((x) => x.id === input.supervisorId && x.role === "督导");
  if (!sup) return fail([err("SUPERVISOR_INVALID", "审批督导无效")]);
  if (!input.reason.trim()) return fail([err("REASON_REQUIRED", "改派需填写原因")]);

  const pending = state.handovers.find(
    (h) => h.caseId === input.caseId && h.status === "pending",
  );
  if (pending)
    return fail([err("HANDOVER_OPEN", "该个案已有待确认交接单，不能重复发起")]);

  const carried = state.followUps
    .filter((f) => f.caseId === input.caseId && f.status === "待随访")
    .map((f) => f.id);

  const h = {
    id: genId("H"),
    caseId: input.caseId,
    fromCounselorId: c.counselorId,
    toCounselorId: input.toCounselorId,
    supervisorId: input.supervisorId,
    reason: input.reason.trim(),
    status: "pending" as const,
    carriedFollowUpIds: carried,
    createdAt: Date.now(),
  };
  return pass({ ...state, handovers: [...state.handovers, h] });
}

/** 督导确认：冲突则拒绝并保留原咨询师/原计划 */
export function confirmHandover(state: AppState, handoverId: string): MutateResult {
  const h = state.handovers.find((x) => x.id === handoverId);
  if (!h) return fail([err("NOT_FOUND", "交接单不存在")]);
  if (h.status !== "pending") return fail([err("NOT_PENDING", "交接单已处理")]);

  const now = Date.now();

  // 校验：新咨询师在"将转入的未来会谈"上不得时段重叠（保留原有其它计划）
  const incoming = state.sessions.filter(
    (s) => s.caseId === h.caseId && s.status !== "completed" && s.endAt > now,
  );
  const otherPlans = state.sessions.filter(
    (s) =>
      s.caseId !== h.caseId &&
      s.status !== "draft" &&
      s.counselorId === h.toCounselorId,
  );
  const v: Violation[] = [];
  for (const inc of incoming) {
    for (const o of otherPlans) {
      if (overlaps(inc.startAt, inc.endAt, o.startAt, o.endAt)) {
        v.push(
          err(
            "TARGET_OVERLAP",
            `新咨询师时段冲突：${inc.id} 与 ${o.id} 重叠，拒绝确认`,
            inc.id,
          ),
        );
      }
    }
  }
  if (v.length) return fail(v);

  const incomingIds = new Set(incoming.map((s) => s.id));

  let next: AppState = {
    ...state,
    cases: state.cases.map((c) =>
      c.id === h.caseId ? { ...c, counselorId: h.toCounselorId } : c,
    ),
    sessions: state.sessions.map((s) =>
      incomingIds.has(s.id) ? { ...s, counselorId: h.toCounselorId } : s,
    ),
    handovers: state.handovers.map((x) =>
      x.id === h.id
        ? { ...x, status: "confirmed" as const, decidedAt: now, decisionNote: "督导确认，原咨询师释放" }
        : x,
    ),
    // 随访随个案转移（followUp.caseId 不变即已随案承接，carriedFollowUpIds 已在单上留痕）
  };
  next = pushVersion(next, {
    type: "handover",
    operator: state.staff.find((s) => s.id === h.supervisorId)?.name ?? "督导",
    reason: `改派确认：${h.reason}`,
    detail: `${h.caseId} 咨询师 ${h.fromCounselorId} → ${h.toCounselorId}，承接随访 ${h.carriedFollowUpIds.length} 项`,
  });
  return pass(next);
}

/** 督导驳回：原咨询师继续保留（状态本未释放），交接单关闭 */
export function rejectHandover(state: AppState, handoverId: string, note: string): MutateResult {
  const h = state.handovers.find((x) => x.id === handoverId);
  if (!h) return fail([err("NOT_FOUND", "交接单不存在")]);
  if (h.status !== "pending") return fail([err("NOT_PENDING", "交接单已处理")]);

  let next: AppState = {
    ...state,
    handovers: state.handovers.map((x) =>
      x.id === h.id
        ? { ...x, status: "rejected" as const, decidedAt: Date.now(), decisionNote: note }
        : x,
    ),
  };
  next = pushVersion(next, {
    type: "handover",
    operator: state.staff.find((s) => s.id === h.supervisorId)?.name ?? "督导",
    reason: `改派驳回：${note || "未说明"}`,
    detail: `${h.caseId} 保留原咨询师 ${h.fromCounselorId}`,
  });
  return pass(next);
}

// -------------------------------------------------------------
// 随访：完成 / 新增
// -------------------------------------------------------------
export function completeFollowUp(state: AppState, followUpId: string): MutateResult {
  const f = state.followUps.find((x) => x.id === followUpId);
  if (!f) return fail([err("NOT_FOUND", "随访不存在")]);
  if (f.status === "已完成") return fail([err("ALREADY_DONE", "随访已完成")]);
  return pass({
    ...state,
    followUps: state.followUps.map((x) =>
      x.id === followUpId ? { ...x, status: "已完成" as const, completedAt: Date.now() } : x,
    ),
  });
}

export function addFollowUp(
  state: AppState,
  caseId: string,
  title: string,
  dueAt: number,
): MutateResult {
  const c = state.cases.find((x) => x.id === caseId);
  if (!c) return fail([err("NOT_FOUND", "个案不存在")]);
  if (!title.trim()) return fail([err("FIELD", "随访事项必填")]);
  const fu: FollowUp = {
    id: genId("F"),
    caseId,
    title: title.trim(),
    dueAt,
    status: "待随访",
    createdAt: Date.now(),
  };
  return pass({ ...state, followUps: [...state.followUps, fu] });
}

export function resetToSeed(seed: AppState): MutateResult {
  return pass(seed);
}
