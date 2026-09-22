import { useState } from "react";
import type { AppState } from "../domain/types";
import { fmtDateTime } from "../domain/clock";
import { staffName, statusLabel } from "./format";
import {
  confirmHandover,
  createHandover,
  rejectHandover,
  type CreateHandoverInput,
} from "../rules/transitions";

interface Props {
  state: AppState;
  apply: (r: import("../rules/helpers").MutateResult) => boolean;
}

export function HandoverBoard({ state, apply }: Props) {
  const counselors = state.staff.filter((s) => s.role === "咨询师");
  const supervisors = state.staff.filter((s) => s.role === "督导");
  const pendingCaseIds = new Set(
    state.handovers.filter((h) => h.status === "pending").map((h) => h.caseId),
  );
  const assignable = state.cases.filter((c) => c.counselorId && !pendingCaseIds.has(c.id));

  const [form, setForm] = useState<CreateHandoverInput>({
    caseId: assignable[0]?.id ?? "",
    toCounselorId: counselors.find((t) => t.id !== assignable[0]?.counselorId)?.id ?? "",
    supervisorId: supervisors[0]?.id ?? "",
    reason: "",
  });

  return (
    <div className="board">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>改派交接</p>
            <h2>先建交接单 · 督导确认前原咨询师不释放</h2>
          </div>
        </div>
        <form
          className="field-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (apply(createHandover(state, form))) setForm({ ...form, reason: "" });
          }}
        >
          <label>
            <span>个案</span>
            <select value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
              {assignable.map((c) => (
                <option key={c.id} value={c.id}>{c.id} · 当前 {staffName(state, c.counselorId)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>改派给（新咨询师）</span>
            <select
              value={form.toCounselorId}
              onChange={(e) => setForm({ ...form, toCounselorId: e.target.value })}
            >
              {counselors
                .filter((t) => t.id !== state.cases.find((c) => c.id === form.caseId)?.counselorId)
                .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>
            <span>审批督导</span>
            <select
              value={form.supervisorId}
              onChange={(e) => setForm({ ...form, supervisorId: e.target.value })}
            >
              {supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>
            <span>改派原因</span>
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="如 值班调整 / 专长匹配 / 危机转介"
            />
          </label>
          <div className="form-actions span-2">
            <button className="primary-action" type="submit">建立交接单（不释放原咨询师）</button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>交接单</p>
            <h2>未完成随访随交接承接</h2>
          </div>
        </div>
        <div className="handover-list">
          {[...state.handovers]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((h) => {
              const c = state.cases.find((x) => x.id === h.caseId);
              const carried = state.followUps.filter((f) =>
                h.carriedFollowUpIds.includes(f.id),
              );
              return (
                <article key={h.id} className={`handover-card handover-${h.status}`}>
                  <header>
                    <div className="case-title">
                      <h3>{h.id} · {h.caseId}</h3>
                      <span className="badge badge-status">{statusLabel[h.status]}</span>
                      {h.status === "pending" && (
                        <span className="badge badge-handover">原咨询师 {staffName(state, h.fromCounselorId)} 锁定中</span>
                      )}
                    </div>
                    <p className="muted">建立于 {fmtDateTime(h.createdAt)}</p>
                  </header>

                  <p>
                    <strong>{staffName(state, h.fromCounselorId)}</strong>
                    {" → "}
                    <strong>{staffName(state, h.toCounselorId)}</strong>
                    {" · 审批："}{staffName(state, h.supervisorId)}
                    {c && <> · 风险 <b className={c.risk === "高风险" ? "text-danger" : ""}>{c.risk}</b></>}
                  </p>
                  <p className="muted">原因：{h.reason}</p>

                  <div className="carried">
                    <span>承接随访（{carried.length}）：</span>
                    {carried.length === 0 && <em className="muted">无未完成随访</em>}
                    {carried.map((f) => (
                      <span key={f.id} className={`tag ${f.dueAt < Date.now() ? "tag-danger" : ""}`}>
                        {f.title} · {fmtDateTime(f.dueAt)} · {statusLabel[f.status]}
                      </span>
                    ))}
                  </div>

                  {h.decisionNote && <p className="decision-note">督导意见：{h.decisionNote}</p>}

                  {h.status === "pending" && (
                    <div className="btn-row">
                      <button
                        className="primary-action mini"
                        onClick={() => apply(confirmHandover(state, h.id))}
                      >
                        督导确认（释放原咨询师并转移未来排期）
                      </button>
                      <button
                        className="mini"
                        onClick={() => apply(rejectHandover(state, h.id, "督导驳回：维持原承接"))}
                      >
                        驳回（保留原咨询师）
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
        </div>
      </section>
    </div>
  );
}
