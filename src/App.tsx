import { useMemo, useState } from "react";
import "./styles.css";
import type { AppState, RiskLevel, ScheduleDraft } from "./data/types";
import { RISK_LEVELS } from "./data/types";
import { loadState, resetState, saveState } from "./storage/repository";
import {
  commitBatch,
  completeEntry,
  completeFollowUp,
  completionBlock,
  confirmHandoff,
  correctEntry,
  createHandoff,
  registerCase,
  rejectHandoff,
  type ValidationIssue,
} from "./domain/rules";

const pad = (n: number) => String(n).padStart(2, "0");

const toInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromInput = (v: string) => new Date(v).toISOString();

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

interface DraftRow {
  caseId: string;
  startAt: string;
  endAt: string;
  acceptedAt: string;
}

interface CorrectionForm {
  entryId: string;
  startAt: string;
  endAt: string;
  roomId: string;
  reason: string;
}

const defaultDraft = (caseId: string): DraftRow => {
  const base = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return {
    caseId,
    startAt: toInput(new Date(base).toISOString()),
    endAt: toInput(new Date(base + 60 * 60 * 1000).toISOString()),
    acceptedAt: "",
  };
};

function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [batchIssues, setBatchIssues] = useState<ValidationIssue[] | null>(null);

  // 个案登记表单
  const [caseForm, setCaseForm] = useState({
    clientCode: "",
    topic: "",
    risk: "关注" as RiskLevel,
    counselorId: "c1",
    supervisorId: "s1",
    roomId: "r1",
    followUpDueAt: toInput(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()),
  });

  // 批量排期草稿
  const [drafts, setDrafts] = useState<DraftRow[]>([defaultDraft("C-042")]);

  // 冻结排期更正
  const [correction, setCorrection] = useState<CorrectionForm | null>(null);

  // 交接单表单
  const [handoffForm, setHandoffForm] = useState({ caseId: "C-310", toCounselorId: "c2", reason: "" });

  const commit = (next: AppState) => {
    saveState(next);
    setState(next);
  };

  const staffById = useMemo(() => new Map(state.staff.map((s) => [s.id, s])), [state.staff]);
  const roomById = useMemo(() => new Map(state.rooms.map((r) => [r.id, r])), [state.rooms]);
  const caseById = useMemo(() => new Map(state.cases.map((c) => [c.id, c])), [state.cases]);
  const counselors = state.staff.filter((s) => s.role === "咨询师");
  const supervisors = state.staff.filter((s) => s.role === "督导");
  const nowMs = Date.now();

  const staffName = (id: string) => staffById.get(id)?.name ?? id;
  const roomName = (id: string) => roomById.get(id)?.name ?? id;

  const metrics = [
    { label: "活跃个案", value: state.cases.length, tone: "status-ok" },
    { label: "高风险个案", value: state.cases.filter((c) => c.risk === "高风险").length, tone: "status-danger" },
    {
      label: "高风险未接单",
      value: state.schedule.filter(
        (e) => e.status === "scheduled" && caseById.get(e.caseId)?.risk === "高风险" && !e.supervisorAcceptedAt
      ).length,
      tone: "status-danger",
    },
    { label: "待确认交接", value: state.handoffs.filter((h) => h.status === "pending").length, tone: "status-watch" },
    { label: "未完成随访", value: state.followUps.filter((f) => !f.done).length, tone: "status-watch" },
  ];

  const showResult = (res: { ok: boolean } & { reason?: string }, okText: string) => {
    if (res.ok) {
      setNotice({ kind: "ok", text: okText });
      return true;
    }
    setNotice({ kind: "err", text: res.reason ?? "操作被拒绝" });
    return false;
  };

  const submitCase = () => {
    const res = registerCase(
      state,
      { ...caseForm, followUpDueAt: fromInput(caseForm.followUpDueAt) },
      new Date().toISOString()
    );
    if (showResult(res, `个案 ${caseForm.clientCode} 已登记，随访任务已生成`)) {
      commit((res as { ok: true; state: AppState }).state);
      setCaseForm({ ...caseForm, clientCode: "", topic: "" });
    }
  };

  const submitBatch = () => {
    const parsed: ScheduleDraft[] = drafts.map((d) => ({
      caseId: d.caseId,
      startAt: fromInput(d.startAt),
      endAt: fromInput(d.endAt),
      supervisorAcceptedAt: d.acceptedAt ? fromInput(d.acceptedAt) : null,
    }));
    const res = commitBatch(state, parsed);
    if (res.ok) {
      commit(res.state);
      setBatchIssues(null);
      setDrafts([]);
      setNotice({ kind: "ok", text: `整批 ${parsed.length} 笔排期已通过并冻结` });
    } else {
      setBatchIssues(res.issues);
      setNotice({ kind: "err", text: "整笔拒绝：原计划未做任何变动" });
    }
  };

  const submitCorrection = () => {
    if (!correction) return;
    const res = correctEntry(
      state,
      correction.entryId,
      {
        startAt: fromInput(correction.startAt),
        endAt: fromInput(correction.endAt),
        roomId: correction.roomId,
      },
      correction.reason,
      new Date().toISOString()
    );
    if (showResult(res, "更正已留痕，生成新版本")) {
      commit((res as { ok: true; state: AppState }).state);
      setCorrection(null);
    }
  };

  const submitHandoff = () => {
    const res = createHandoff(state, handoffForm, new Date().toISOString());
    if (showResult(res, "交接单已建立，待督导确认；确认前原咨询师不释放")) {
      commit((res as { ok: true; state: AppState }).state);
      setHandoffForm({ ...handoffForm, reason: "" });
    }
  };

  const sortedSchedule = [...state.schedule].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const sortedFollowUps = [...state.followUps].sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-12 · port 5112</p>
          <h1>督导排班与危机随访交接台</h1>
          <p className="subtitle">
            个案登记风险、随访截止、咨询师、督导与会谈室；人员时段重叠、高风险 24
            小时无督导接单或会谈室冲突时整笔拒绝并保留原计划。高风险未接单不得完成会谈；改派先建交接单，督导确认前原咨询师不释放，未完成随访随交接承接；排期冻结，更正留原因版本。
          </p>
        </div>
        <div className="stack-card">
          <span>架构</span>
          <strong>数据 data / 判定 domain / 存储 storage 三层拆分</strong>
          <button
            onClick={() => {
              commit(resetState());
              setNotice({ kind: "ok", text: "已重置为示例数据" });
            }}
          >
            重置示例数据
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={m.tone} />
          </article>
        ))}
      </section>

      {notice && (
        <div className={notice.kind === "ok" ? "notice notice-ok" : "notice notice-err"}>
          {notice.text}
        </div>
      )}
      {batchIssues && (
        <div className="notice notice-err">
          <strong>整批拒绝明细（原计划保留）：</strong>
          <ul>
            {batchIssues.map((issue, i) => (
              <li key={i}>
                第 {issue.draftIndex + 1} 笔：{issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="workspace">
        <aside className="panel narrow">
          <h2>个案登记</h2>
          <div className="form-stack">
            <label>
              <span>来访者代号</span>
              <input
                value={caseForm.clientCode}
                onChange={(e) => setCaseForm({ ...caseForm, clientCode: e.target.value })}
                placeholder="如 C-401"
              />
            </label>
            <label>
              <span>咨询主题</span>
              <input
                value={caseForm.topic}
                onChange={(e) => setCaseForm({ ...caseForm, topic: e.target.value })}
                placeholder="如 焦虑"
              />
            </label>
            <label>
              <span>风险等级</span>
              <select
                value={caseForm.risk}
                onChange={(e) => setCaseForm({ ...caseForm, risk: e.target.value as RiskLevel })}
              >
                {RISK_LEVELS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              <span>咨询师</span>
              <select
                value={caseForm.counselorId}
                onChange={(e) => setCaseForm({ ...caseForm, counselorId: e.target.value })}
              >
                {counselors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>督导</span>
              <select
                value={caseForm.supervisorId}
                onChange={(e) => setCaseForm({ ...caseForm, supervisorId: e.target.value })}
              >
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>会谈室</span>
              <select
                value={caseForm.roomId}
                onChange={(e) => setCaseForm({ ...caseForm, roomId: e.target.value })}
              >
                {state.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>随访截止</span>
              <input
                type="datetime-local"
                value={caseForm.followUpDueAt}
                onChange={(e) => setCaseForm({ ...caseForm, followUpDueAt: e.target.value })}
              />
            </label>
            <button className="primary-action" onClick={submitCase}>
              登记个案
            </button>
          </div>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>批量提交 · 整笔判定</p>
              <h2>排期草稿</h2>
            </div>
            <div className="row-actions">
              <button onClick={() => setDrafts([...drafts, defaultDraft(state.cases[0]?.id ?? "")])}>
                添加一笔
              </button>
              <button className="primary-action" onClick={submitBatch} disabled={drafts.length === 0}>
                提交整批
              </button>
            </div>
          </div>
          {drafts.length === 0 && <p className="muted-text">暂无草稿，点击「添加一笔」开始排期。</p>}
          <div className="draft-list">
            {drafts.map((d, i) => {
              const kase = caseById.get(d.caseId);
              const highRisk = kase?.risk === "高风险";
              return (
                <div key={i} className="draft-row">
                  <strong>第 {i + 1} 笔</strong>
                  <select
                    value={d.caseId}
                    onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, caseId: e.target.value } : x)))}
                  >
                    {state.cases.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.clientCode} · {c.risk} · {roomName(c.roomId)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="datetime-local"
                    value={d.startAt}
                    onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, startAt: e.target.value } : x)))}
                  />
                  <input
                    type="datetime-local"
                    value={d.endAt}
                    onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, endAt: e.target.value } : x)))}
                  />
                  {highRisk ? (
                    <label className="accept-field">
                      <span>督导接单时间（登记后24小时内）</span>
                      <input
                        type="datetime-local"
                        value={d.acceptedAt}
                        onChange={(e) =>
                          setDrafts(drafts.map((x, j) => (j === i ? { ...x, acceptedAt: e.target.value } : x)))
                        }
                      />
                    </label>
                  ) : (
                    <span className="muted-text">非高风险，无需接单时间</span>
                  )}
                  <button onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>移除</button>
                </div>
              );
            })}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>排期冻结 · 更正留痕</p>
            <h2>排期计划</h2>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>个案</th>
              <th>时段</th>
              <th>会谈室</th>
              <th>咨询师 / 督导</th>
              <th>督导接单</th>
              <th>状态</th>
              <th>版本</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedSchedule.map((e) => {
              const kase = caseById.get(e.caseId);
              const block = kase ? completionBlock(e, kase) : "个案不存在";
              const editing = correction?.entryId === e.id;
              return (
                <tr key={e.id}>
                  <td>
                    {kase?.clientCode}
                    <span className={`badge risk-${kase?.risk}`}>{kase?.risk}</span>
                  </td>
                  <td>
                    {editing ? (
                      <div className="edit-cell">
                        <input
                          type="datetime-local"
                          value={correction.startAt}
                          onChange={(ev) => setCorrection({ ...correction, startAt: ev.target.value })}
                        />
                        <input
                          type="datetime-local"
                          value={correction.endAt}
                          onChange={(ev) => setCorrection({ ...correction, endAt: ev.target.value })}
                        />
                      </div>
                    ) : (
                      `${fmt(e.startAt)} ~ ${fmt(e.endAt)}`
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <select
                        value={correction.roomId}
                        onChange={(ev) => setCorrection({ ...correction, roomId: ev.target.value })}
                      >
                        {state.rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      roomName(e.roomId)
                    )}
                  </td>
                  <td>
                    {staffName(e.counselorId)} / {staffName(e.supervisorId)}
                  </td>
                  <td>
                    {e.supervisorAcceptedAt ? (
                      <span className="badge badge-ok">已接单 {fmt(e.supervisorAcceptedAt)}</span>
                    ) : (
                      <span className="badge badge-danger">未接单</span>
                    )}
                  </td>
                  <td>
                    {e.status === "completed" ? (
                      <span className="badge badge-ok">已完成</span>
                    ) : (
                      <span className="badge badge-watch">已冻结·待会谈</span>
                    )}
                  </td>
                  <td>v{e.version}</td>
                  <td>
                    {editing ? (
                      <div className="edit-cell">
                        <input
                          placeholder="更正原因（必填）"
                          value={correction.reason}
                          onChange={(ev) => setCorrection({ ...correction, reason: ev.target.value })}
                        />
                        <button className="primary-action" onClick={submitCorrection}>
                          提交版本
                        </button>
                        <button onClick={() => setCorrection(null)}>取消</button>
                      </div>
                    ) : (
                      <div className="row-actions">
                        <button
                          disabled={block !== null}
                          title={block ?? "完成会谈"}
                          onClick={() => {
                            const res = completeEntry(state, e.id);
                            if (showResult(res, "会谈已完成")) {
                              commit((res as { ok: true; state: AppState }).state);
                            }
                          }}
                        >
                          完成会谈
                        </button>
                        <button
                          onClick={() =>
                            setCorrection({
                              entryId: e.id,
                              startAt: toInput(e.startAt),
                              endAt: toInput(e.endAt),
                              roomId: e.roomId,
                              reason: "",
                            })
                          }
                        >
                          更正
                        </button>
                      </div>
                    )}
                    {block && e.status !== "completed" && <p className="block-reason">{block}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="workspace">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>改派先建交接单</p>
              <h2>交接台</h2>
            </div>
          </div>
          <div className="handoff-form">
            <select
              value={handoffForm.caseId}
              onChange={(e) => setHandoffForm({ ...handoffForm, caseId: e.target.value })}
            >
              {state.cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clientCode} · 当前 {staffName(c.counselorId)}
                </option>
              ))}
            </select>
            <select
              value={handoffForm.toCounselorId}
              onChange={(e) => setHandoffForm({ ...handoffForm, toCounselorId: e.target.value })}
            >
              {counselors.map((s) => (
                <option key={s.id} value={s.id}>
                  改派给 {s.name}
                </option>
              ))}
            </select>
            <input
              placeholder="交接原因"
              value={handoffForm.reason}
              onChange={(e) => setHandoffForm({ ...handoffForm, reason: e.target.value })}
            />
            <button className="primary-action" onClick={submitHandoff}>
              建立交接单
            </button>
          </div>
          <div className="record-list">
            {state.handoffs.length === 0 && <p className="muted-text">暂无交接单。</p>}
            {[...state.handoffs].reverse().map((h) => {
              const kase = caseById.get(h.caseId);
              return (
                <article key={h.id} className="record-card">
                  <div className="record-index">{h.id.slice(0, 2)}</div>
                  <div>
                    <h3>
                      {kase?.clientCode}：{staffName(h.fromCounselorId)} → {staffName(h.toCounselorId)}
                      <span
                        className={
                          h.status === "pending"
                            ? "badge badge-watch"
                            : h.status === "confirmed"
                              ? "badge badge-ok"
                              : "badge badge-danger"
                        }
                      >
                        {h.status === "pending" ? "待督导确认" : h.status === "confirmed" ? "已确认" : "已拒绝"}
                      </span>
                    </h3>
                    <p>
                      督导 {staffName(h.supervisorId)} · {h.reason} · 建单 {fmt(h.createdAt)}
                      {h.status === "pending" && " · 确认前原咨询师不释放"}
                      {h.status === "confirmed" &&
                        ` · 承接未完成随访 ${h.carriedFollowUpIds.length} 项，原咨询师已释放`}
                    </p>
                    {h.status === "pending" && (
                      <div className="row-actions">
                        <button
                          className="primary-action"
                          onClick={() => {
                            const res = confirmHandoff(state, h.id, new Date().toISOString());
                            if (showResult(res, "督导已确认：改派生效，未完成随访随交接承接")) {
                              commit((res as { ok: true; state: AppState }).state);
                            }
                          }}
                        >
                          督导确认
                        </button>
                        <button
                          onClick={() => {
                            const res = rejectHandoff(state, h.id, new Date().toISOString());
                            if (showResult(res, "督导已拒绝：个案仍归原咨询师")) {
                              commit((res as { ok: true; state: AppState }).state);
                            }
                          }}
                        >
                          督导拒绝
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>危机随访</p>
              <h2>随访任务</h2>
            </div>
          </div>
          <div className="record-list">
            {sortedFollowUps.map((f) => {
              const overdue = !f.done && Date.parse(f.dueAt) < nowMs;
              return (
                <article key={f.id} className="record-card">
                  <div className={`record-index ${overdue ? "index-danger" : ""}`}>
                    {f.done ? "✓" : overdue ? "!" : "…"}
                  </div>
                  <div>
                    <h3>
                      {caseById.get(f.caseId)?.clientCode} · {f.title}
                      {f.done ? (
                        <span className="badge badge-ok">已完成</span>
                      ) : overdue ? (
                        <span className="badge badge-danger">已逾期</span>
                      ) : (
                        <span className="badge badge-watch">进行中</span>
                      )}
                    </h3>
                    <p>
                      截止 {fmt(f.dueAt)} · 负责人 {staffName(f.assigneeId)}
                      {f.done && f.doneAt ? ` · 完成于 ${fmt(f.doneAt)}` : ""}
                    </p>
                    {!f.done && (
                      <button onClick={() => commit(completeFollowUp(state, f.id, new Date().toISOString()))}>
                        完成随访
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>冻结排期更正留痕</p>
            <h2>版本记录</h2>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>排期</th>
              <th>更正时间</th>
              <th>原因</th>
              <th>变更前 → 变更后</th>
            </tr>
          </thead>
          <tbody>
            {state.versions.length === 0 && (
              <tr>
                <td colSpan={5} className="muted-text">
                  暂无更正版本。
                </td>
              </tr>
            )}
            {[...state.versions].reverse().map((v) => {
              const entry = state.schedule.find((e) => e.id === v.entryId);
              return (
                <tr key={v.id}>
                  <td>v{v.version}</td>
                  <td>{entry ? caseById.get(entry.caseId)?.clientCode : v.entryId}</td>
                  <td>{fmt(v.changedAt)}</td>
                  <td>{v.reason}</td>
                  <td>
                    {fmt(v.before.startAt)}~{fmt(v.before.endAt)} {roomName(v.before.roomId)} →{" "}
                    {fmt(v.after.startAt)}~{fmt(v.after.endAt)} {roomName(v.after.roomId)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}

export default App;
