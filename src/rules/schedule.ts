// 判定层：排班冲突与高风险接单规则。
// 规则（需求）：
//  1) 人员时段重叠：同一咨询师或同一督导时间重叠 -> 拒绝
//  2) 会谈室冲突：同一会谈室时间重叠 -> 拒绝
//  3) 高风险个案 24h 内无督导接单 -> 拒绝
// 任一冲突，整笔批次拒绝（调用方负责"保留原计划"，即不写入草稿）。
import type { AppState, Session } from "../domain/types";
import { HOUR, overlaps } from "../domain/clock";
import { err, ok, reject, type RuleResult, type Violation } from "./helpers";

/** 已占用计划：草稿仅与既有 confirmed/frozen/completed 及同批其他草稿比较 */
function occupied(state: AppState, drafts: Session[]): Session[] {
  return [
    ...state.sessions.filter((s) => s.status !== "draft"),
    ...drafts,
  ];
}

function nameOf(state: AppState, id: string | null): string {
  if (!id) return "未指派";
  return state.staff.find((s) => s.id === id)?.name ?? id;
}

function roomOf(state: AppState, id: string): string {
  return state.rooms.find((r) => r.id === id)?.name ?? id;
}

/** 高风险个案督导接单截止（标记后 24h） */
export function supervisionDeadline(state: AppState, caseId: string): number | null {
  const c = state.cases.find((x) => x.id === caseId);
  if (!c || c.risk !== "高风险" || !c.riskFlaggedAt) return null;
  return c.riskFlaggedAt + 24 * HOUR;
}

interface CheckCtx {
  state: AppState;
  drafts: Session[];
  at: number;
  violations: Violation[];
}

/** 校验单条草稿自身（时间、个案、高风险接单） */
function checkDraftSelf(ctx: CheckCtx, d: Session) {
  const c = ctx.state.cases.find((x) => x.id === d.caseId);
  if (!c) {
    ctx.violations.push(err("CASE_MISSING", `草稿 ${d.id}：关联个案不存在`, d.id));
    return;
  }
  if (!(d.startAt < d.endAt)) {
    ctx.violations.push(err("TIME_INVALID", `${c.id}：会谈起止时间无效`, d.id));
  }

  // 高风险 24h 内必须有督导接单
  if (c.risk === "高风险") {
    const deadline = c.riskFlaggedAt ? c.riskFlaggedAt + 24 * HOUR : null;
    const withinWindow = deadline !== null && ctx.at <= deadline;
    if (!d.supervisorId) {
      const tip =
        withinWindow && deadline
          ? `接单截止 ${new Date(deadline).toLocaleString("zh-CN")}`
          : "已逾 24 小时接单窗口";
      ctx.violations.push(
        err(
          "HIGHRISK_NO_SUPERVISOR",
          `高风险个案 ${c.id}：无督导接单，不得排期/会谈（${tip}）`,
          d.id,
        ),
      );
    } else {
      const sup = ctx.state.staff.find((x) => x.id === d.supervisorId);
      if (!sup || sup.role !== "督导") {
        ctx.violations.push(
          err("SUPERVISOR_INVALID", `${c.id}：接单督导身份无效`, d.id),
        );
      }
    }
  }
}

/** 交叉冲突：咨询师 / 督导时段重叠、会谈室冲突 */
function checkConflicts(ctx: CheckCtx, d: Session, others: Session[]) {
  const c = ctx.state.cases.find((x) => x.id === d.caseId);
  const label = c ? c.id : d.id;
  for (const o of others) {
    if (o.id === d.id || !overlaps(d.startAt, d.endAt, o.startAt, o.endAt)) continue;

    if (d.counselorId && d.counselorId === o.counselorId) {
      ctx.violations.push(
        err(
          "COUNSELOR_OVERLAP",
          `${label}：咨询师 ${nameOf(ctx.state, d.counselorId)} 时段与 ${o.id} 重叠`,
          d.id,
        ),
      );
    }
    if (d.supervisorId && d.supervisorId === o.supervisorId) {
      ctx.violations.push(
        err(
          "SUPERVISOR_OVERLAP",
          `${label}：督导 ${nameOf(ctx.state, d.supervisorId)} 时段与 ${o.id} 重叠`,
          d.id,
        ),
      );
    }
    if (d.roomId === o.roomId) {
      ctx.violations.push(
        err(
          "ROOM_CONFLICT",
          `${label}：会谈室 ${roomOf(ctx.state, d.roomId)} 与 ${o.id} 冲突`,
          d.id,
        ),
      );
    }
  }
}

function dedupe(violations: Violation[]): Violation[] {
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const v of violations) {
    const key = `${v.code}|${v.sessionId ?? ""}|${v.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/**
 * 校验一整批排班草稿。
 * 任一违规则整笔拒绝（返回全部违规原因），调用方不写入 -> 自动保留原计划。
 */
export function validateScheduling(
  state: AppState,
  drafts: Session[],
  at = Date.now(),
  excludeSessionIds: ReadonlySet<string> = new Set(),
): RuleResult {
  if (drafts.length === 0) {
    return reject([err("EMPTY_BATCH", "没有可提交的排班草稿")]);
  }
  const ctx: CheckCtx = { state, drafts, at, violations: [] };
  const all = occupied(state, drafts).filter((s) => !excludeSessionIds.has(s.id));

  for (const d of drafts) {
    checkDraftSelf(ctx, d);
    // 与既有计划及同批其他草稿比较
    checkConflicts(ctx, d, all);
  }

  const violations = dedupe(ctx.violations);
  return violations.length === 0 ? ok() : reject(violations);
}

/** 高风险未接单是否禁止完成会谈 */
export function canCompleteSession(state: AppState, sessionId: string): RuleResult {
  const s = state.sessions.find((x) => x.id === sessionId);
  if (!s) return reject([err("NOT_FOUND", "会谈不存在")]);
  if (s.status === "completed") return reject([err("ALREADY_DONE", "该会谈已完成")]);

  const c = state.cases.find((x) => x.id === s.caseId);
  if (c?.risk === "高风险") {
    const hasSupervisor =
      !!s.supervisorId &&
      state.staff.some((x) => x.id === s.supervisorId && x.role === "督导");
    if (!hasSupervisor) {
      return reject([
        err(
          "HIGHRISK_BLOCKED",
          `高风险个案 ${c.id} 督导尚未接单，不得完成会谈`,
          sessionId,
        ),
      ]);
    }
  }
  return ok();
}
