import type { AppState } from "./types";

const H = 60 * 60 * 1000;
const D = 24 * H;

/** 以当前时间为基准生成示例数据，保证 24 小时接单、逾期随访等规则可演示 */
export function buildSeed(): AppState {
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();

  const staff = [
    { id: "c1", name: "林岚", role: "咨询师" as const },
    { id: "c2", name: "周谨", role: "咨询师" as const },
    { id: "c3", name: "顾北", role: "咨询师" as const },
    { id: "s1", name: "沈奕", role: "督导" as const },
    { id: "s2", name: "贺兰", role: "督导" as const },
  ];

  const rooms = [
    { id: "r1", name: "会谈室·静" },
    { id: "r2", name: "会谈室·安" },
    { id: "r3", name: "会谈室·宁" },
  ];

  const cases: AppState["cases"] = [
    {
      id: "C-042",
      clientCode: "C-042",
      topic: "焦虑",
      risk: "中风险",
      counselorId: "c1",
      supervisorId: "s1",
      roomId: "r1",
      registeredAt: iso(now - 2 * D),
      followUpDueAt: iso(now + 3 * D),
    },
    {
      id: "C-119",
      clientCode: "C-119",
      topic: "亲密关系",
      risk: "稳定",
      counselorId: "c2",
      supervisorId: "s2",
      roomId: "r2",
      registeredAt: iso(now - 5 * D),
      followUpDueAt: iso(now + 6 * D),
    },
    {
      id: "C-203",
      clientCode: "C-203",
      topic: "职业压力",
      risk: "关注",
      counselorId: "c3",
      supervisorId: "s1",
      roomId: "r3",
      registeredAt: iso(now - 1 * D),
      followUpDueAt: iso(now + 2 * D),
    },
    {
      id: "C-310",
      clientCode: "C-310",
      topic: "危机干预",
      risk: "高风险",
      counselorId: "c1",
      supervisorId: "s1",
      roomId: "r2",
      registeredAt: iso(now - 30 * H),
      followUpDueAt: iso(now + 12 * H),
    },
    {
      id: "C-311",
      clientCode: "C-311",
      topic: "创伤后应激",
      risk: "高风险",
      counselorId: "c2",
      supervisorId: "s2",
      roomId: "r1",
      registeredAt: iso(now - 20 * H),
      followUpDueAt: iso(now + 1 * D),
    },
  ];

  const schedule: AppState["schedule"] = [
    {
      id: "E-01",
      caseId: "C-042",
      counselorId: "c1",
      supervisorId: "s1",
      roomId: "r1",
      startAt: iso(now + 26 * H),
      endAt: iso(now + 27 * H),
      supervisorAcceptedAt: null,
      status: "scheduled",
      frozen: true,
      version: 2,
    },
    {
      id: "E-02",
      caseId: "C-310",
      counselorId: "c1",
      supervisorId: "s1",
      roomId: "r2",
      startAt: iso(now + 4 * H),
      endAt: iso(now + 5 * H),
      supervisorAcceptedAt: null, // 高风险未接单：仅演示完成拦截，新排期会被整批拒绝
      status: "scheduled",
      frozen: true,
      version: 1,
    },
    {
      id: "E-03",
      caseId: "C-311",
      counselorId: "c2",
      supervisorId: "s2",
      roomId: "r1",
      startAt: iso(now + 6 * H),
      endAt: iso(now + 7 * H),
      supervisorAcceptedAt: iso(now - 20 * H + 6 * H), // 登记后 6 小时接单
      status: "scheduled",
      frozen: true,
      version: 1,
    },
    {
      id: "E-04",
      caseId: "C-119",
      counselorId: "c2",
      supervisorId: "s2",
      roomId: "r2",
      startAt: iso(now - 26 * H),
      endAt: iso(now - 25 * H),
      supervisorAcceptedAt: null,
      status: "completed",
      frozen: true,
      version: 1,
    },
  ];

  const followUps: AppState["followUps"] = [
    {
      id: "F-01",
      caseId: "C-310",
      title: "危机随访",
      dueAt: iso(now + 12 * H),
      assigneeId: "c1",
      done: false,
      doneAt: null,
    },
    {
      id: "F-02",
      caseId: "C-311",
      title: "危机随访",
      dueAt: iso(now + 1 * D),
      assigneeId: "c2",
      done: false,
      doneAt: null,
    },
    {
      id: "F-03",
      caseId: "C-042",
      title: "常规随访",
      dueAt: iso(now + 3 * D),
      assigneeId: "c1",
      done: false,
      doneAt: null,
    },
    {
      id: "F-04",
      caseId: "C-203",
      title: "常规随访",
      dueAt: iso(now + 2 * D),
      assigneeId: "c3",
      done: false,
      doneAt: null,
    },
    {
      id: "F-05",
      caseId: "C-119",
      title: "常规随访",
      dueAt: iso(now - 1 * D),
      assigneeId: "c2",
      done: true,
      doneAt: iso(now - 2 * D),
    },
  ];

  const handoffs: AppState["handoffs"] = [
    {
      id: "H-01",
      caseId: "C-203",
      fromCounselorId: "c3",
      toCounselorId: "c2",
      supervisorId: "s1",
      reason: "原咨询师休假一周",
      status: "pending",
      createdAt: iso(now - 3 * H),
      resolvedAt: null,
      carriedFollowUpIds: [],
    },
  ];

  const versions: AppState["versions"] = [
    {
      id: "V-01",
      entryId: "E-01",
      version: 2,
      reason: "来访者临时改期",
      changedAt: iso(now - 5 * H),
      before: { startAt: iso(now + 2 * H), endAt: iso(now + 3 * H), roomId: "r1" },
      after: { startAt: iso(now + 26 * H), endAt: iso(now + 27 * H), roomId: "r1" },
    },
  ];

  return { staff, rooms, cases, schedule, followUps, handoffs, versions };
}
