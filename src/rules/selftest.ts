// 判定层冒烟测试（非持久化、纯逻辑）。用 esbuild 即时编译后执行：
//   npx esbuild src/rules/selftest.ts --bundle --platform=node | node
import { buildSeed, buildViolatingDrafts } from "../domain/seed";
import { HOUR } from "../domain/clock";
import { validateScheduling, canCompleteSession } from "./schedule";
import {
  acceptSupervision,
  completeSession,
  confirmHandover,
  correctSession,
  createHandover,
  freezeSchedule,
  rejectHandover,
  submitBatch,
} from "./transitions";
import type { AppState, Session } from "../domain/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}
const codes = (r: { violations: { code: string }[] }) =>
  r.violations.map((v) => v.code).sort().join(",");

console.log("规则冒烟测试");

// 1) 违规批次整笔拒绝
let s: AppState = buildSeed();
const violating = buildViolatingDrafts(s);
const r1 = submitBatch(s, violating);
check("违规批次被整笔拒绝", r1.ok === false);
check(
  "覆盖人员重叠/房间/高风险三类违规",
  ["COUNSELOR_OVERLAP", "ROOM_CONFLICT", "HIGHRISK_NO_SUPERVISOR"].every((c) =>
    codes(r1).includes(c),
  ),
  codes(r1),
);
check("拒绝后原计划保留（会话数不变）", r1.ok === false && s.sessions.length === 4);

// 2) 合法批次通过（选用不与既有计划冲突的人员/时段/房间）
const t2 = s.sessions.find((x) => x.id === "P2")!.startAt; // 明天14:00
const good: Session[] = [
  {
    id: "G1", caseId: "C-042", counselorId: "T3", supervisorId: "S2", roomId: "R1",
    startAt: t2 + 3 * HOUR, endAt: t2 + 4 * HOUR,
    status: "draft", note: "", createdAt: Date.now(),
  },
];
const r2 = submitBatch(s, good);
check("合法批次通过并转为 confirmed", r2.ok === true && r2.state!.sessions[r2.state!.sessions.length - 1].status === "confirmed");
if (r2.state) s = r2.state;

// 3) 高风险未接单不得完成会谈
const blocked = canCompleteSession(s, "P3"); // C-311 已接单 S2 -> 可完成
check("已接单高风险可完成", blocked.ok === true, codes(blocked));

// 给 C-203（未接单）插一条 confirmed 排期（绕过 UI，直接构造状态）
const now = Date.now();
const unacceptedSession: Session = {
  id: "PX", caseId: "C-203", counselorId: "T3", supervisorId: null, roomId: "R3",
  startAt: now + 6 * HOUR, endAt: now + 7 * HOUR, status: "confirmed", note: "", createdAt: now,
};
const s3: AppState = { ...s, sessions: [...s.sessions, unacceptedSession] };
const r3 = completeSession(s3, "PX");
check("高风险未接单禁止完成会谈", r3.ok === false && codes(r3).includes("HIGHRISK_BLOCKED"), codes(r3));

// 4) 督导接单后可完成
const r4a = acceptSupervision(s3, "C-203", "S2");
check("督导接单成功", r4a.ok === true && r4a.state!.cases.find((c) => c.id === "C-203")!.supervisorId === "S2");
if (r4a.state) {
  const covered = {
    ...r4a.state,
    sessions: r4a.state.sessions.map((x) => (x.id === "PX" ? { ...x, supervisorId: "S2" } : x)),
  };
  const r4b = completeSession(covered, "PX");
  check("接单后允许完成会谈", r4b.ok === true, codes(r4b));
}

// 5) 24h 窗口超时接单拒绝
const expired: AppState = {
  ...s,
  cases: s.cases.map((c) =>
    c.id === "C-203" ? { ...c, riskFlaggedAt: now - 25 * HOUR } : c,
  ),
};
const r5 = acceptSupervision(expired, "C-203", "S2");
check("超过24h窗口接单被拒", r5.ok === false && codes(r5).includes("WINDOW_EXPIRED"), codes(r5));

// 6) 改派：建单后原咨询师不释放
const s6 = buildSeed();
const r6 = createHandover(s6, {
  caseId: "C-042", toCounselorId: "T2", supervisorId: "S2", reason: "测试改派",
});
check("建立交接单", r6.ok === true);
const hId = r6.state!.handovers.find((h) => h.caseId === "C-042")!.id;
check(
  "确认前原咨询师不释放",
  r6.state!.cases.find((c) => c.id === "C-042")!.counselorId === "T1",
);
check(
  "未完成随访随交接单承接",
  r6.state!.handovers.find((h) => h.id === hId)!.carriedFollowUpIds.includes("F1"),
);
// 重复发起被拒
const r6b = createHandover(r6.state!, {
  caseId: "C-042", toCounselorId: "T3", supervisorId: "S1", reason: "x",
});
check("待确认期间重复发起被拒", r6b.ok === false && codes(r6b).includes("HANDOVER_OPEN"));

// 7) 确认交接：无冲突则转移
const r7 = confirmHandover(r6.state!, hId);
check("确认交接成功", r7.ok === true);
check("确认后咨询师转移", r7.state!.cases.find((c) => c.id === "C-042")!.counselorId === "T2");
check(
  "未来排期咨询师随交接转移",
  r7.state!.sessions.find((x) => x.id === "P1")!.counselorId === "T2",
);

// 7b) 新咨询师时段冲突 -> 拒绝确认，保留原咨询师
const s7 = buildSeed();
const cr = createHandover(s7, { caseId: "C-311", toCounselorId: "T2", supervisorId: "S1", reason: "冲突测试" });
// C-311 未来排期 P3 在 16:00，T2 已有 P2 在 14:00 —— 不冲突；再造一个 16:00 的 T2 占用
const conflictState: AppState = {
  ...cr.state!,
  sessions: [
    ...cr.state!.sessions,
    {
      id: "PC", caseId: "C-042", counselorId: "T2", supervisorId: "S1", roomId: "R3",
      startAt: s7.sessions.find((x) => x.id === "P3")!.startAt,
      endAt: s7.sessions.find((x) => x.id === "P3")!.endAt,
      status: "confirmed", note: "", createdAt: now,
    },
  ],
};
const h7b = conflictState.handovers.find((h) => h.caseId === "C-311")!.id;
const r7b = confirmHandover(conflictState, h7b);
check("新咨询师时段冲突时拒绝确认", r7b.ok === false && codes(r7b).includes("TARGET_OVERLAP"), codes(r7b));
check("拒绝确认保留原咨询师", r7b.state === undefined && conflictState.cases.find((c) => c.id === "C-311")!.counselorId === "T1");

// 7c) 驳回：原咨询师保留
const s7c = buildSeed();
const cr7c = createHandover(s7c, { caseId: "C-042", toCounselorId: "T2", supervisorId: "S2", reason: "r" });
const h7c = cr7c.state!.handovers.find((h) => h.caseId === "C-042")!.id;
const rr = rejectHandover(cr7c.state!, h7c, "维持");
check("驳回交接原咨询师保留", rr.state!.cases.find((c) => c.id === "C-042")!.counselorId === "T1");

// 8) 冻结 + 更正留原因版本（更正必须作用于已冻结排期）
let s8 = buildSeed();
const fz = freezeSchedule(s8, "管理员");
check("冻结未来 confirmed 排期", fz.ok === true && fz.state!.sessions.find((x) => x.id === "P2")!.status === "frozen");
const frozen = fz.state!;
const revBefore = frozen.versions[0]?.revision ?? 1;
const p2 = frozen.sessions.find((x) => x.id === "P2")!;
const noReason = correctSession(frozen, {
  sessionId: "P2", startAt: p2.startAt + HOUR, endAt: p2.startAt + 2 * HOUR,
  roomId: "R2", supervisorId: "S1", reason: "", operator: "管理员",
});
check("无原因更正被拒", noReason.ok === false && codes(noReason).includes("REASON_REQUIRED"));
const withReason = correctSession(frozen, {
  sessionId: "P2", startAt: p2.startAt + HOUR, endAt: p2.startAt + 2 * HOUR,
  roomId: "R2", supervisorId: "S1", reason: "督导顺延", operator: "管理员",
});
check("有原因更正通过并产生新版本", withReason.ok === true && withReason.state!.versions[0].revision === revBefore + 1);
check("版本记录原因", withReason.state!.versions[0].reason === "督导顺延");

// 9) 同批草稿互相重叠也应拒绝
const base = buildSeed();
const st = base.sessions.find((x) => x.id === "P1")!.startAt;
const inter: Session[] = [
  { id: "A", caseId: "C-119", counselorId: "T3", supervisorId: "S2", roomId: "R3", startAt: st, endAt: st + HOUR, status: "draft", note: "", createdAt: now },
  { id: "B", caseId: "C-119", counselorId: "T3", supervisorId: "S2", roomId: "R1", startAt: st + 30 * 60000, endAt: st + 90 * 60000, status: "draft", note: "", createdAt: now },
];
const r9 = validateScheduling(base, inter);
check("同批草稿互相重叠被拒", !r9.ok && codes(r9).includes("COUNSELOR_OVERLAP"), codes(r9));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) {
  (globalThis as { process?: { exit: (n: number) => void } }).process?.exit(1);
}
