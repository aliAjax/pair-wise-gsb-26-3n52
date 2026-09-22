// 数据层：演示种子数据。刷新后按"今天"重新生成，保证倒计时与 24h 窗口有演示意义。
import type {
  AppState,
  CaseRecord,
  FollowUp,
  Handover,
  Room,
  Session,
  Staff,
  VersionRecord,
} from "./types";
import { DAY, HOUR, nowTs, todayAt } from "./clock";

export const staff: Staff[] = [
  { id: "T1", name: "林一咨询师", role: "咨询师" },
  { id: "T2", name: "陈默咨询师", role: "咨询师" },
  { id: "T3", name: "周予咨询师", role: "咨询师" },
  { id: "S1", name: "何督导", role: "督导" },
  { id: "S2", name: "赵督导", role: "督导" },
];

export const rooms: Room[] = [
  { id: "R1", name: "安心会谈室" },
  { id: "R2", name: "正念会谈室" },
  { id: "R3", name: "团体室" },
];

export function buildSeed(): AppState {
  const t = nowTs();

  // 个案
  const c042: CaseRecord = {
    id: "C-042",
    codeName: "来访者 A-042",
    theme: "焦虑",
    risk: "中风险",
    riskFlaggedAt: null,
    counselorId: "T1",
    supervisorId: "S1",
    followUpDeadline: todayAt(18, 2),
    note: "睡眠改善，练习呼吸放松",
    createdAt: t - 6 * DAY,
  };
  const c119: CaseRecord = {
    id: "C-119",
    codeName: "来访者 B-119",
    theme: "亲密关系",
    risk: "稳定",
    riskFlaggedAt: null,
    counselorId: "T2",
    supervisorId: null,
    followUpDeadline: todayAt(18, 4),
    note: "识别沟通中的回避模式",
    createdAt: t - 9 * DAY,
  };
  // 高风险：刚刚升级，24h 督导接单窗口进行中（尚未接单）
  const c203: CaseRecord = {
    id: "C-203",
    codeName: "来访者 C-203",
    theme: "职业压力 / 自伤意念",
    risk: "高风险",
    riskFlaggedAt: t - 2 * HOUR,
    counselorId: "T3",
    supervisorId: null,
    followUpDeadline: t + 10 * HOUR,
    note: "危机干预观察中，督导尚未接单",
    createdAt: t - 3 * DAY,
  };
  // 高风险但已接单（督导 S2），会谈可完成
  const c311: CaseRecord = {
    id: "C-311",
    codeName: "来访者 D-311",
    theme: "抑郁复发",
    risk: "高风险",
    riskFlaggedAt: t - 2 * DAY,
    counselorId: "T1",
    supervisorId: "S2",
    followUpDeadline: t + 30 * HOUR,
    note: "督导已接单，安全计划已建立",
    createdAt: t - 12 * DAY,
  };

  const cases = [c042, c119, c203, c311];

  // 随访（含待办、逾期、已完成；改派演示用）
  const followUps: FollowUp[] = [
    {
      id: "F1",
      caseId: "C-042",
      title: "呼吸放松练习回访",
      dueAt: todayAt(18, 2),
      status: "待随访",
      createdAt: t - 5 * DAY,
    },
    {
      id: "F2",
      caseId: "C-203",
      title: "危机首次随访（安全确认）",
      dueAt: t + 10 * HOUR,
      status: "待随访",
      createdAt: t - 2 * HOUR,
    },
    {
      id: "F3",
      caseId: "C-203",
      title: "夜间情绪稳定度复核",
      dueAt: t - 3 * HOUR, // 已逾期
      status: "待随访",
      createdAt: t - 8 * HOUR,
    },
    {
      id: "F4",
      caseId: "C-311",
      title: "安全计划落地确认",
      dueAt: t + 30 * HOUR,
      status: "待随访",
      createdAt: t - DAY,
    },
    {
      id: "F5",
      caseId: "C-119",
      title: "沟通回避模式作业检查",
      dueAt: t - DAY,
      status: "已完成",
      completedAt: t - 26 * HOUR,
      createdAt: t - 8 * DAY,
    },
  ];

  // 已有排班：confirmed / frozen / completed 混合
  const sessions: Session[] = [
    {
      id: "P1",
      caseId: "C-042",
      counselorId: "T1",
      supervisorId: "S1",
      roomId: "R1",
      startAt: todayAt(10),
      endAt: todayAt(11),
      status: "frozen",
      note: "冻结中的常规督导会谈",
      createdAt: t - 2 * DAY,
    },
    {
      id: "P2",
      caseId: "C-119",
      counselorId: "T2",
      supervisorId: "S1",
      roomId: "R2",
      startAt: todayAt(14),
      endAt: todayAt(15),
      status: "confirmed",
      note: "",
      createdAt: t - DAY,
    },
    {
      id: "P3",
      caseId: "C-311",
      counselorId: "T1",
      supervisorId: "S2",
      roomId: "R1",
      startAt: todayAt(16),
      endAt: todayAt(17),
      status: "confirmed",
      note: "高风险已接单，可完成",
      createdAt: t - DAY,
    },
    {
      id: "P4",
      caseId: "C-119",
      counselorId: "T2",
      supervisorId: "S1",
      roomId: "R2",
      startAt: todayAt(9, -1),
      endAt: todayAt(10, -1),
      status: "completed",
      note: "已完成会谈",
      createdAt: t - 3 * DAY,
    },
  ];

  // 待确认交接：C-203 由 T3 改派给 T2，督导 S2 审批；原咨询师 T3 暂不释放，
  // 未完成随访 F2/F3 随交接承接。
  const handover: Handover = {
    id: "H1",
    caseId: "C-203",
    fromCounselorId: "T3",
    toCounselorId: "T2",
    supervisorId: "S2",
    reason: "原咨询师值班调整，需转介危机随访承接",
    status: "pending",
    carriedFollowUpIds: ["F2", "F3"],
    createdAt: t - HOUR,
  };

  const initVersion: VersionRecord = {
    id: "V1",
    at: t - 12 * DAY,
    type: "init",
    operator: "系统",
    reason: "排班初始化",
    detail: "建立个案、人员与会谈室基线计划",
    revision: 1,
  };

  return {
    staff,
    rooms,
    cases,
    followUps,
    sessions,
    handovers: [handover],
    versions: [initVersion],
  };
}

/** 一键载入的"违规批量草稿"：含人员时段重叠、会谈室冲突、24h 无接单高风险。
 *  预期整笔拒绝并保留原计划。 */
export function buildViolatingDrafts(state: AppState): Session[] {
  const t = nowTs();
  const mk = (
    id: string,
    partial: Partial<Session> & Pick<Session, "caseId" | "counselorId" | "startAt">,
  ): Session => ({
    id,
    supervisorId: null,
    roomId: "R1",
    endAt: partial.startAt + HOUR,
    status: "draft",
    note: "",
    createdAt: t,
    ...partial,
  });

  return [
    // 与已冻结的 P1 抢同一咨询师 T1 与会谈室 R1（人员重叠 + 房间冲突）
    mk("D1", {
      caseId: "C-042",
      counselorId: "T1",
      supervisorId: "S1",
      roomId: "R1",
      startAt: todayAt(10),
    }),
    // 督导 S1 与 P2 时段重叠
    mk("D2", {
      caseId: "C-119",
      counselorId: "T3",
      supervisorId: "S1",
      roomId: "R3",
      startAt: todayAt(14),
    }),
    // 高风险 C-203：24h 内无督导接单（supervisorId=null）
    mk("D3", {
      caseId: "C-203",
      counselorId: "T3",
      supervisorId: null,
      roomId: "R2",
      startAt: todayAt(11),
    }),
  ];
}
