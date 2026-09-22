// =============================================================
// 数据层（domain）：督导排班与危机随访交接台的领域模型
// 只描述"有什么数据"，不包含业务判定与持久化逻辑。
// =============================================================

export type RiskLevel = "稳定" | "关注" | "中风险" | "高风险";

export type StaffRole = "咨询师" | "督导";

export interface Staff {
  id: string;
  name: string;
  role: StaffRole;
}

export interface Room {
  id: string;
  name: string;
}

export type FollowUpStatus = "待随访" | "已完成";

/** 危机随访：随个案存在，改派时未完成项随交接单承接 */
export interface FollowUp {
  id: string;
  caseId: string;
  title: string;
  dueAt: number;
  status: FollowUpStatus;
  /** 完成时间；随交接承接后保留同一 id，仅随个案转移 */
  completedAt?: number;
  createdAt: number;
}

export interface CaseRecord {
  id: string; // 个案代号，如 C-042
  codeName: string; // 来访者代号
  theme: string; // 咨询主题
  risk: RiskLevel; // 风险等级
  /** 最近一次标记为高风险的时间，用于 24 小时督导接单窗口 */
  riskFlaggedAt: number | null;
  counselorId: string | null; // 当前承接咨询师（交接确认前不释放）
  supervisorId: string | null; // 已接单督导（接单后写入）
  followUpDeadline: number; // 随访截止
  note: string;
  createdAt: number;
}

export type SessionStatus = "draft" | "confirmed" | "frozen" | "completed";

/** 排班 / 会谈：咨询师 + 督导 + 会谈室 三元组 */
export interface Session {
  id: string;
  caseId: string;
  counselorId: string;
  supervisorId: string | null;
  roomId: string;
  startAt: number;
  endAt: number;
  status: SessionStatus;
  note: string;
  createdAt: number;
}

export type HandoverStatus = "pending" | "confirmed" | "rejected";

/** 改派交接单：督导确认前原咨询师不释放 */
export interface Handover {
  id: string;
  caseId: string;
  fromCounselorId: string;
  toCounselorId: string;
  supervisorId: string;
  reason: string;
  status: HandoverStatus;
  /** 承接的未完成随访 id 快照 */
  carriedFollowUpIds: string[];
  createdAt: number;
  decidedAt?: number;
  decisionNote?: string;
}

export type ChangeType =
  | "init"
  | "freeze"
  | "correct"
  | "handover"
  | "case";

/** 更正留原因版本：冻结/更正/交接等留痕 */
export interface VersionRecord {
  id: string;
  at: number;
  type: ChangeType;
  operator: string;
  reason: string;
  detail: string;
  /** 更正时的修订号 */
  revision?: number;
}

export interface AppState {
  staff: Staff[];
  rooms: Room[];
  cases: CaseRecord[];
  followUps: FollowUp[];
  sessions: Session[];
  handovers: Handover[];
  versions: VersionRecord[];
}
