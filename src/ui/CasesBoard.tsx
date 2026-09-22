import { useState } from "react";
import type { AppState, RiskLevel } from "../domain/types";
import { countdown, fmtDateTime } from "../domain/clock";
import { riskClass, staffName, statusLabel } from "./format";
import {
  acceptSupervision,
  completeFollowUp,
  registerCase,
  type RegisterCaseInput,
} from "../rules/transitions";

interface Props {
  state: AppState;
  apply: (r: import("../rules/helpers").MutateResult) => boolean;
}

const RISKS: RiskLevel[] = ["稳定", "关注", "中风险", "高风险"];

export function CasesBoard({ state, apply }: Props) {
  const counselors = state.staff.filter((s) => s.role === "咨询师");
  const supervisors = state.staff.filter((s) => s.role === "督导");

  const [form, setForm] = useState<RegisterCaseInput>({
    codeName: "",
    theme: "",
    risk: "关注",
    counselorId: counselors[0]?.id ?? null,
    followUpDeadline: Date.now() + 3 * 24 * 3600 * 1000,
    note: "",
  });

  const pendingHandoverCaseIds = new Set(
    state.handovers.filter((h) => h.status === "pending").map((h) => h.caseId),
  );

  return (
    <div className="board">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>个案登记</p>
            <h2>风险 · 随访截止 · 咨询师</h2>
          </div>
        </div>
        <form
          className="field-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (apply(registerCase(state, form))) {
              setForm({ ...form, codeName: "", theme: "", note: "" });
            }
          }}
        >
          <label>
            <span>来访者代号</span>
            <input
              value={form.codeName}
              onChange={(e) => setForm({ ...form, codeName: e.target.value })}
              placeholder="如 来访者 E-512"
            />
          </label>
          <label>
            <span>咨询主题</span>
            <input
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value })}
              placeholder="如 焦虑 / 亲密关系"
            />
          </label>
          <label>
            <span>风险等级</span>
            <select
              value={form.risk}
              onChange={(e) => setForm({ ...form, risk: e.target.value as RiskLevel })}
            >
              {RISKS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            <span>承接咨询师</span>
            <select
              value={form.counselorId ?? ""}
              onChange={(e) => setForm({ ...form, counselorId: e.target.value || null })}
            >
              <option value="">待派</option>
              {counselors.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>随访截止</span>
            <input
              type="datetime-local"
              value={toLocal(form.followUpDeadline)}
              onChange={(e) =>
                setForm({ ...form, followUpDeadline: new Date(e.target.value).getTime() })
              }
            />
          </label>
          <label className="span-2">
            <span>备注 / 干预目标</span>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="危机要点、干预目标"
            />
          </label>
          <div className="form-actions span-2">
            <button className="primary-action" type="submit">登记个案</button>
            {form.risk === "高风险" && (
              <em className="hint-warn">登记即开始 24 小时督导接单窗口，并建立首次随访</em>
            )}
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>个案名册与危机随访</p>
            <h2>个案 {state.cases.length} · 待随访 {state.followUps.filter((f) => f.status === "待随访").length}</h2>
          </div>
        </div>
        <div className="case-list">
          {state.cases.map((c) => {
            const fus = state.followUps.filter((f) => f.caseId === c.id);
            const pending = fus.filter((f) => f.status === "待随访");
            const inHandover = pendingHandoverCaseIds.has(c.id);
            return (
              <article key={c.id} className="case-card">
                <header>
                  <div className="case-title">
                    <h3>{c.id}</h3>
                    <span className={`badge ${riskClass[c.risk]}`}>{c.risk}</span>
                    {inHandover && <span className="badge badge-handover">改派中·原咨询师锁定</span>}
                  </div>
                  <p className="muted">{c.codeName} · {c.theme}</p>
                </header>

                <div className="case-meta">
                  <div>
                    <span>咨询师</span>
                    <strong>{staffName(state, c.counselorId)}</strong>
                  </div>
                  <div>
                    <span>督导</span>
                    <strong className={c.risk === "高风险" && !c.supervisorId ? "text-danger" : ""}>
                      {c.supervisorId ? staffName(state, c.supervisorId) : "未接单"}
                    </strong>
                  </div>
                  <div>
                    <span>随访截止</span>
                    <strong className={c.followUpDeadline < Date.now() ? "text-danger" : ""}>
                      {fmtDateTime(c.followUpDeadline)}
                    </strong>
                  </div>
                </div>

                {c.risk === "高风险" && (
                  <div className="supervisor-bar">
                    {c.supervisorId ? (
                      <span className="chip-ok">督导 {staffName(state, c.supervisorId)} 已接单，会谈可完成</span>
                    ) : (
                      <>
                        <span className="chip-danger">
                          24h 接单窗口：{c.riskFlaggedAt ? countdown(c.riskFlaggedAt + 24 * 3600 * 1000) : "—"}
                        </span>
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) apply(acceptSupervision(state, c.id, e.target.value));
                          }}
                        >
                          <option value="" disabled>督导接单…</option>
                          {supervisors.map((s) => (
                            <option key={s.id} value={s.id}>{s.name} 接单</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                )}

                <ul className="followup-list">
                  {fus.map((f) => (
                    <li key={f.id} className={f.status === "待随访" && f.dueAt < Date.now() ? "overdue" : ""}>
                      <div>
                        <strong>{f.title}</strong>
                        <span className="muted">
                          {fmtDateTime(f.dueAt)} · {statusLabel[f.status]}
                          {f.status === "待随访" && <> · {countdown(f.dueAt)}</>}
                        </span>
                      </div>
                      {f.status === "待随访" && (
                        <button
                          className="mini"
                          onClick={() => apply(completeFollowUp(state, f.id))}
                        >
                          完成随访
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {c.note && <p className="case-note">{c.note}</p>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function toLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
