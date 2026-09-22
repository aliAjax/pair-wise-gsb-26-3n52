import type {
  AppState,
  CaseRecord,
  CorrectionVersion,
  FollowUp,
  HandoffOrder,
  RiskLevel,
  ScheduleDraft,
  ScheduleEntry,
} from "../data/types";

let seq = 0;
export const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ValidationIssue {
  draftIndex: number;
  message: string;
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string };
export type BatchResult =
  | { ok: true; state: AppState }
  | { ok: false; issues: ValidationIssue[] };

const overlaps = (aS: number, aE: number, bS: number, bE: number) =>
  aS < bE && bS < aE;

const dedupe = (list: string[]) => [...new Set(list)];

interface SlotLike {
  counselorId: string;
  supervisorId: string;
  roomId: string;
  startAt: string;
  endAt: string;
}

/** 人员时段重叠（咨询师/督导）与会谈室冲突检测 */
function conflictMessages(slot: SlotLike, others: ScheduleEntry[], selfId: string | null): string[] {
  const msgs: string[] = [];
  const s = Date.parse(slot.startAt);
  const e = Date.parse(slot.endAt);
  for (const o of others) {
    if (selfId !== null && o.id === selfId) continue;
    if (!overlaps(s, e, Date.parse(o.startAt), Date.parse(o.endAt))) continue;
    if (o.counselorId === slot.counselorId) msgs.push("咨询师时段重叠");
    if (o.supervisorId === slot.supervisorId) msgs.push("督导时段重叠");
    if (o.roomId === slot.roomId) msgs.push("会谈室冲突");
  }
  return dedupe(msgs);
}

/** 高风险个案：登记后 24 小时内必须有督导接单 */
function highRiskAcceptanceIssue(kase: CaseRecord, acceptedAt: string | null): string | null {
  if (kase.risk !== "高风险") return null;
  if (!acceptedAt) return "高风险个案须督导接单后方可排期";
  const a = Date.parse(acceptedAt);
  const r = Date.parse(kase.registeredAt);
  if (!Number.isFinite(a) || a < r || a - r > DAY_MS) {
    return "高风险个案督导接单超出登记后24小时";
  }
  return null;
}

/** 校验整批草稿：任一笔违规则整笔拒绝，原计划保留 */
export function validateBatch(state: AppState, drafts: ScheduleDraft[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const placed: ScheduleEntry[] = [...state.schedule];

  drafts.forEach((draft, i) => {
    const push = (message: string) => issues.push({ draftIndex: i, message });
    const kase = state.cases.find((c) => c.id === draft.caseId);
    if (!kase) {
      push("个案不存在");
      return;
    }
    const s = Date.parse(draft.startAt);
    const e = Date.parse(draft.endAt);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e) {
      push("会谈时段无效");
      return;
    }
    conflictMessages(
      {
        counselorId: kase.counselorId,
        supervisorId: kase.supervisorId,
        roomId: kase.roomId,
        startAt: draft.startAt,
        endAt: draft.endAt,
      },
      placed,
      null
    ).forEach(push);

    const riskIssue = highRiskAcceptanceIssue(kase, draft.supervisorAcceptedAt);
    if (riskIssue) push(riskIssue);

    placed.push({
      id: `draft-${i}`,
      caseId: kase.id,
      counselorId: kase.counselorId,
      supervisorId: kase.supervisorId,
      roomId: kase.roomId,
      startAt: draft.startAt,
      endAt: draft.endAt,
      supervisorAcceptedAt: draft.supervisorAcceptedAt,
      status: "scheduled",
      frozen: true,
      version: 1,
    });
  });

  return issues;
}

/** 提交整批排期：全部通过才落库，否则原状态原样返回 */
export function commitBatch(state: AppState, drafts: ScheduleDraft[]): BatchResult {
  const issues = validateBatch(state, drafts);
  if (issues.length > 0) return { ok: false, issues };

  const entries: ScheduleEntry[] = drafts.map((d) => {
    const kase = state.cases.find((c) => c.id === d.caseId)!;
    return {
      id: makeId("E"),
      caseId: kase.id,
      counselorId: kase.counselorId,
      supervisorId: kase.supervisorId,
      roomId: kase.roomId,
      startAt: d.startAt,
      endAt: d.endAt,
      supervisorAcceptedAt: d.supervisorAcceptedAt,
      status: "scheduled",
      frozen: true,
      version: 1,
    };
  });
  return { ok: true, state: { ...state, schedule: [...state.schedule, ...entries] } };
}

/** 高风险未接单不得完成会谈 */
export function completionBlock(entry: ScheduleEntry, kase: CaseRecord): string | null {
  if (entry.status === "completed") return "会谈已完成";
  if (kase.risk === "高风险" && !entry.supervisorAcceptedAt) {
    return "高风险个案督导未接单，不得完成会谈";
  }
  return null;
}

export function completeEntry(state: AppState, entryId: string): Result<AppState> {
  const entry = state.schedule.find((e) => e.id === entryId);
  if (!entry) return { ok: false, reason: "排期不存在" };
  const kase = state.cases.find((c) => c.id === entry.caseId);
  if (!kase) return { ok: false, reason: "个案不存在" };
  const block = completionBlock(entry, kase);
  if (block) return { ok: false, reason: block };
  const schedule = state.schedule.map((e) =>
    e.id === entryId ? { ...e, status: "completed" as const } : e
  );
  return { ok: true, state: { ...state, schedule } };
}

export interface CorrectionPatch {
  startAt: string;
  endAt: string;
  roomId: string;
}

/** 排期冻结：更正不改原记录语义，追加一条留原因的版本 */
export function correctEntry(
  state: AppState,
  entryId: string,
  patch: CorrectionPatch,
  reason: string,
  changedAt: string
): Result<AppState> {
  const entry = state.schedule.find((e) => e.id === entryId);
  if (!entry) return { ok: false, reason: "排期不存在" };
  if (!reason.trim()) return { ok: false, reason: "更正必须填写原因" };
  const s = Date.parse(patch.startAt);
  const e = Date.parse(patch.endAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e) {
    return { ok: false, reason: "会谈时段无效" };
  }
  const conflicts = conflictMessages({ ...entry, ...patch }, state.schedule, entryId);
  if (conflicts.length > 0) {
    return { ok: false, reason: `更正被驳回：${conflicts.join("、")}` };
  }
  const version: CorrectionVersion = {
    id: makeId("V"),
    entryId,
    version: entry.version + 1,
    reason: reason.trim(),
    changedAt,
    before: { startAt: entry.startAt, endAt: entry.endAt, roomId: entry.roomId },
    after: { ...patch },
  };
  const schedule = state.schedule.map((x) =>
    x.id === entryId ? { ...x, ...patch, version: x.version + 1 } : x
  );
  return { ok: true, state: { ...state, schedule, versions: [...state.versions, version] } };
}

/** 登记个案：同步生成随访任务（高风险为危机随访） */
export function registerCase(
  state: AppState,
  input: {
    clientCode: string;
    topic: string;
    risk: RiskLevel;
    counselorId: string;
    supervisorId: string;
    roomId: string;
    followUpDueAt: string;
  },
  registeredAt: string
): Result<AppState> {
  if (!input.clientCode.trim() || !input.topic.trim()) {
    return { ok: false, reason: "来访者代号与咨询主题必填" };
  }
  if (state.cases.some((c) => c.clientCode === input.clientCode.trim())) {
    return { ok: false, reason: "来访者代号已存在" };
  }
  if (!Number.isFinite(Date.parse(input.followUpDueAt))) {
    return { ok: false, reason: "随访截止时间无效" };
  }
  const id = makeId("C");
  const kase: CaseRecord = {
    id,
    clientCode: input.clientCode.trim(),
    topic: input.topic.trim(),
    risk: input.risk,
    counselorId: input.counselorId,
    supervisorId: input.supervisorId,
    roomId: input.roomId,
    registeredAt,
    followUpDueAt: input.followUpDueAt,
  };
  const followUp: FollowUp = {
    id: makeId("F"),
    caseId: id,
    title: input.risk === "高风险" ? "危机随访" : "常规随访",
    dueAt: input.followUpDueAt,
    assigneeId: input.counselorId,
    done: false,
    doneAt: null,
  };
  return {
    ok: true,
    state: { ...state, cases: [...state.cases, kase], followUps: [...state.followUps, followUp] },
  };
}

/** 改派先建交接单：督导确认前原咨询师不释放 */
export function createHandoff(
  state: AppState,
  input: { caseId: string; toCounselorId: string; reason: string },
  now: string
): Result<AppState> {
  const kase = state.cases.find((c) => c.id === input.caseId);
  if (!kase) return { ok: false, reason: "个案不存在" };
  if (state.handoffs.some((h) => h.caseId === input.caseId && h.status === "pending")) {
    return { ok: false, reason: "该个案已有待确认交接单" };
  }
  if (input.toCounselorId === kase.counselorId) {
    return { ok: false, reason: "改派对象须为其他咨询师" };
  }
  const target = state.staff.find((s) => s.id === input.toCounselorId);
  if (!target || target.role !== "咨询师") return { ok: false, reason: "改派对象须为咨询师" };
  const order: HandoffOrder = {
    id: makeId("H"),
    caseId: input.caseId,
    fromCounselorId: kase.counselorId,
    toCounselorId: input.toCounselorId,
    supervisorId: kase.supervisorId,
    reason: input.reason.trim() || "个案改派",
    status: "pending",
    createdAt: now,
    resolvedAt: null,
    carriedFollowUpIds: [],
  };
  return { ok: true, state: { ...state, handoffs: [...state.handoffs, order] } };
}

/** 督导确认：个案改派生效，未完成随访随交接承接，原咨询师释放 */
export function confirmHandoff(state: AppState, handoffId: string, now: string): Result<AppState> {
  const order = state.handoffs.find((h) => h.id === handoffId);
  if (!order || order.status !== "pending") {
    return { ok: false, reason: "交接单不存在或已处理" };
  }
  const carried = state.followUps
    .filter((f) => f.caseId === order.caseId && !f.done)
    .map((f) => f.id);
  const followUps = state.followUps.map((f) =>
    carried.includes(f.id) ? { ...f, assigneeId: order.toCounselorId } : f
  );
  const cases = state.cases.map((c) =>
    c.id === order.caseId ? { ...c, counselorId: order.toCounselorId } : c
  );
  const handoffs = state.handoffs.map((h) =>
    h.id === handoffId
      ? { ...h, status: "confirmed" as const, resolvedAt: now, carriedFollowUpIds: carried }
      : h
  );
  return { ok: true, state: { ...state, cases, followUps, handoffs } };
}

/** 督导拒绝：个案仍归原咨询师，随访不转移 */
export function rejectHandoff(state: AppState, handoffId: string, now: string): Result<AppState> {
  const order = state.handoffs.find((h) => h.id === handoffId);
  if (!order || order.status !== "pending") {
    return { ok: false, reason: "交接单不存在或已处理" };
  }
  const handoffs = state.handoffs.map((h) =>
    h.id === handoffId ? { ...h, status: "rejected" as const, resolvedAt: now } : h
  );
  return { ok: true, state: { ...state, handoffs } };
}

export function completeFollowUp(state: AppState, followUpId: string, now: string): AppState {
  const followUps = state.followUps.map((f) =>
    f.id === followUpId && !f.done ? { ...f, done: true, doneAt: now } : f
  );
  return { ...state, followUps };
}
