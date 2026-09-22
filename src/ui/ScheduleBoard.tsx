import { useState } from "react";
import type { AppState, Session } from "../domain/types";
import { HOUR, fmtShort, todayAt } from "../domain/clock";
import { riskClass, roomName, staffName, statusLabel } from "./format";
import { genId } from "../rules/helpers";
import {
  completeSession,
  correctSession,
  freezeSchedule,
  submitBatch,
  type CorrectInput,
} from "../rules/transitions";
import { buildViolatingDrafts } from "../domain/seed";

interface Props {
  state: AppState;
  apply: (r: import("../rules/helpers").MutateResult) => boolean;
}

interface DraftRow {
  caseId: string;
  counselorId: string;
  supervisorId: string;
  roomId: string;
  hour: number;
  dayOffset: number;
}

export function ScheduleBoard({ state, apply }: Props) {
  const counselors = state.staff.filter((s) => s.role === "咨询师");
  const supervisors = state.staff.filter((s) => s.role === "督导");

  const [rows, setRows] = useState<DraftRow[]>([
    {
      caseId: state.cases[0]?.id ?? "",
      counselorId: state.cases[0]?.counselorId ?? counselors[0]?.id ?? "",
      supervisorId: state.cases[0]?.supervisorId ?? "",
      roomId: state.rooms[0]?.id ?? "",
      hour: 13,
      dayOffset: 1,
    },
  ]);

  const update = (i: number, patch: Partial<DraftRow>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const toSessions = (): Session[] =>
    rows.map((r, i) => {
      const startAt = todayAt(r.hour, r.dayOffset);
      return {
        id: `draft-${i}`,
        caseId: r.caseId,
        counselorId: r.counselorId,
        supervisorId: r.supervisorId || null,
        roomId: r.roomId,
        startAt,
        endAt: startAt + HOUR,
        status: "draft",
        note: "",
        createdAt: Date.now(),
      };
    });

  const loadViolating = () => {
    // 载入违规批次到草稿表，便于查看其构成（提交时才判定拒绝）
    const ds = buildViolatingDrafts(state);
    setRows(
      ds.map((d) => ({
        caseId: d.caseId,
        counselorId: d.counselorId,
        supervisorId: d.supervisorId ?? "",
        roomId: d.roomId,
        hour: new Date(d.startAt).getHours(),
        dayOffset: 0,
      })),
    );
  };

  return (
    <div className="board">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>批量排班</p>
            <h2>咨询师 · 督导 · 会谈室（整笔提交，冲突即整笔拒绝）</h2>
          </div>
          <div className="btn-row">
            <button onClick={loadViolating}>载入违规示例批次</button>
            <button onClick={() => setRows([...rows, { ...rows[0] }])}>+ 增加一行</button>
            <button
              className="primary-action"
              onClick={() => apply(submitBatch(state, toSessions()))}
            >
              整笔提交 {rows.length} 条
            </button>
          </div>
        </div>

        <div className="draft-table">
          <div className="draft-row draft-head">
            <span>个案</span><span>咨询师</span><span>督导</span>
            <span>会谈室</span><span>日期</span><span>时段</span><span></span>
          </div>
          {rows.map((r, i) => {
            const c = state.cases.find((x) => x.id === r.caseId);
            return (
              <div className="draft-row" key={i}>
                <select value={r.caseId} onChange={(e) => update(i, { caseId: e.target.value })}>
                  {state.cases.map((x) => (
                    <option key={x.id} value={x.id}>{x.id}（{x.risk}）</option>
                  ))}
                </select>
                <select value={r.counselorId} onChange={(e) => update(i, { counselorId: e.target.value })}>
                  {counselors.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select
                  className={c?.risk === "高风险" && !r.supervisorId ? "select-danger" : ""}
                  value={r.supervisorId}
                  onChange={(e) => update(i, { supervisorId: e.target.value })}
                >
                  <option value="">无督导</option>
                  {supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={r.roomId} onChange={(e) => update(i, { roomId: e.target.value })}>
                  {state.rooms.map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
                </select>
                <select value={r.dayOffset} onChange={(e) => update(i, { dayOffset: Number(e.target.value) })}>
                  <option value={0}>今天</option>
                  <option value={1}>明天</option>
                  <option value={2}>后天</option>
                  <option value={3}>3 天后</option>
                </select>
                <select value={r.hour} onChange={(e) => update(i, { hour: Number(e.target.value) })}>
                  {Array.from({ length: 11 }, (_, k) => k + 8).map((h) => (
                    <option key={h} value={h}>{h}:00-{h + 1}:00</option>
                  ))}
                </select>
                <button className="mini" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>删</button>
              </div>
            );
          })}
        </div>
        <p className="muted small">
          校验：咨询师/督导时段重叠、会谈室冲突、高风险 24h 无督导接单。任一不通过，全部草稿不入计划。
        </p>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>排班计划</p>
            <h2>冻结后更正须留原因并生成版本</h2>
          </div>
          <button className="primary-action" onClick={() => apply(freezeSchedule(state, "机构管理员"))}>
            冻结全部未来已确认排期
          </button>
        </div>

        <div className="session-list">
          {[...state.sessions]
            .sort((a, b) => a.startAt - b.startAt)
            .map((s) => (
              <SessionRow key={s.id} state={state} session={s} apply={apply} />
            ))}
        </div>
      </section>
    </div>
  );
}

function SessionRow({
  state,
  session,
  apply,
}: {
  state: AppState;
  session: Session;
  apply: Props["apply"];
}) {
  const c = state.cases.find((x) => x.id === session.caseId);
  const supervisors = state.staff.filter((s) => s.role === "督导");
  const [editing, setEditing] = useState(false);
  const [corr, setCorr] = useState<CorrectInput>({
    sessionId: session.id,
    startAt: session.startAt,
    endAt: session.endAt,
    roomId: session.roomId,
    supervisorId: session.supervisorId,
    reason: "",
    operator: "机构管理员",
  });

  const highBlocked = c?.risk === "高风险" && !session.supervisorId;

  return (
    <article className={`session-card status-${session.status}`}>
      <div className="session-main">
        <div>
          <div className="case-title">
            <h3>{session.id}</h3>
            {c && <span className={`badge ${riskClass[c.risk]}`}>{c.risk}</span>}
            <span className={`badge badge-status`}>{statusLabel[session.status]}</span>
          </div>
          <p className="muted">
            {c?.id} · {fmtShort(session.startAt)} ~ {fmtShort(session.endAt)}
          </p>
          <p className="muted">
            咨询师 {staffName(state, session.counselorId)} · 督导 {staffName(state, session.supervisorId)} ·{" "}
            {roomName(state, session.roomId)}
          </p>
        </div>
        <div className="btn-row">
          {session.status !== "completed" && (
            <button
              className="mini"
              disabled={highBlocked}
              title={highBlocked ? "高风险未接单，禁止完成" : "完成会谈"}
              onClick={() => apply(completeSession(state, session.id))}
            >
              完成会谈
            </button>
          )}
          {session.status === "frozen" && (
            <button className="mini" onClick={() => setEditing(!editing)}>更正</button>
          )}
        </div>
      </div>

      {highBlocked && session.status !== "completed" && (
        <p className="text-danger small">⛔ 高风险督导未接单，不可完成会谈</p>
      )}

      {editing && (
        <form
          className="correct-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (apply(correctSession(state, corr))) setEditing(false);
          }}
        >
          <label>
            <span>开始时间</span>
            <input
              type="datetime-local"
              value={toLocal(corr.startAt)}
              onChange={(e) => {
                const start = new Date(e.target.value).getTime();
                setCorr({ ...corr, startAt: start, endAt: start + HOUR });
              }}
            />
          </label>
          <label>
            <span>会谈室</span>
            <select value={corr.roomId} onChange={(e) => setCorr({ ...corr, roomId: e.target.value })}>
              {state.rooms.map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
            </select>
          </label>
          <label>
            <span>督导</span>
            <select
              value={corr.supervisorId ?? ""}
              onChange={(e) => setCorr({ ...corr, supervisorId: e.target.value || null })}
            >
              <option value="">无督导</option>
              {supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="span-2">
            <span>更正原因（必填，进入版本留痕）</span>
            <input
              value={corr.reason}
              onChange={(e) => setCorr({ ...corr, reason: e.target.value })}
              placeholder="如：督导临时冲突，顺延一小时并更换会谈室"
            />
          </label>
          <div className="form-actions span-2">
            <button className="primary-action" type="submit">提交更正（新版本）</button>
            <button type="button" onClick={() => setEditing(false)}>取消</button>
          </div>
        </form>
      )}
    </article>
  );
}

function toLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
