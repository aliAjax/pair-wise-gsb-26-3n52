export type RiskLevel = "稳定" | "关注" | "中风险" | "高风险";
export const RISK_LEVELS: RiskLevel[] = ["稳定", "关注", "中风险", "高风险"];
export const HIGH_RISK: RiskLevel = "高风险";

export type EntryStatus = "scheduled" | "completed";
export type HandoffStatus = "pending" | "confirmed" | "rejected";

export interface Staff {
  id: string;
  name: string;
  role: "咨询师" | "督导";
}

export interface Room {
  id: string;
  name: string;
}

/** 个案登记：风险、随访截止、咨询师、督导、会谈室 */
export interface CaseRecord {
  id: string;
  clientCode: string;
  topic: string;
  risk: RiskLevel;
  counselorId: string;
  supervisorId: string;
  roomId: string;
  registeredAt: string;
  followUpDueAt: string;
}

/** 排期条目：提交即冻结，更正只能走留痕版本 */
export interface ScheduleEntry {
  id: string;
  caseId: string;
  counselorId: string;
  supervisorId: string;
  roomId: string;
  startAt: string;
  endAt: string;
  supervisorAcceptedAt: string | null;
  status: EntryStatus;
  frozen: boolean;
  version: number;
}

/** 批量排期草稿 */
export interface ScheduleDraft {
  caseId: string;
  startAt: string;
  endAt: string;
  supervisorAcceptedAt: string | null;
}

/** 危机/常规随访 */
export interface FollowUp {
  id: string;
  caseId: string;
  title: string;
  dueAt: string;
  assigneeId: string;
  done: boolean;
  doneAt: string | null;
}

/** 改派交接单：督导确认前原咨询师不释放 */
export interface HandoffOrder {
  id: string;
  caseId: string;
  fromCounselorId: string;
  toCounselorId: string;
  supervisorId: string;
  reason: string;
  status: HandoffStatus;
  createdAt: string;
  resolvedAt: string | null;
  carriedFollowUpIds: string[];
}

/** 冻结排期的更正版本，必须留原因 */
export interface CorrectionVersion {
  id: string;
  entryId: string;
  version: number;
  reason: string;
  changedAt: string;
  before: { startAt: string; endAt: string; roomId: string };
  after: { startAt: string; endAt: string; roomId: string };
}

export interface AppState {
  staff: Staff[];
  rooms: Room[];
  cases: CaseRecord[];
  schedule: ScheduleEntry[];
  followUps: FollowUp[];
  handoffs: HandoffOrder[];
  versions: CorrectionVersion[];
}
