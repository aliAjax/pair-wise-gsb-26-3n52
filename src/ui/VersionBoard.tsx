import type { AppState } from "../domain/types";
import { fmtDateTime } from "../domain/clock";

const typeLabel: Record<string, string> = {
  init: "初始化",
  freeze: "冻结",
  correct: "更正",
  handover: "交接",
  case: "个案",
};

export function VersionBoard({ state }: { state: AppState }) {
  return (
    <div className="board">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>排期版本与留痕</p>
            <h2>更正留原因 · 当前修订号 {state.versions[0]?.revision ?? 1}</h2>
          </div>
        </div>
        <ol className="version-timeline">
          {state.versions.map((v) => (
            <li key={v.id} className={`version-item version-${v.type}`}>
              <div className="version-dot">{v.revision}</div>
              <div>
                <div className="case-title">
                  <span className="badge badge-type">{typeLabel[v.type] ?? v.type}</span>
                  <strong>{v.reason}</strong>
                </div>
                <p className="muted">{v.detail}</p>
                <p className="muted small">
                  {fmtDateTime(v.at)} · 操作人 {v.operator}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
