import type { AppState } from "../domain/types";
import { HOUR } from "../domain/clock";

export function Metrics({ state }: { state: AppState }) {
  const highRisk = state.cases.filter((c) => c.risk === "高风险");
  const unaccepted = highRisk.filter((c) => !c.supervisorId);
  const pendingFU = state.followUps.filter((f) => f.status === "待随访");
  const overdueFU = pendingFU.filter((f) => f.dueAt < Date.now());
  const upcoming = state.sessions.filter(
    (s) => s.status !== "completed" && s.endAt > Date.now(),
  );
  const openHandovers = state.handovers.filter((h) => h.status === "pending");

  const cards = [
    { label: "活跃个案", value: state.cases.length, cls: "status-ok" },
    { label: "高风险未接单", value: unaccepted.length, cls: unaccepted.length ? "status-danger" : "status-ok" },
    { label: "24h 接单窗口进行中", value: countWindow(unaccepted), cls: unaccepted.length ? "status-watch" : "status-ok" },
    { label: "待随访 / 逾期", value: `${pendingFU.length} / ${overdueFU.length}`, cls: overdueFU.length ? "status-danger" : "status-ok" },
    { label: "未来排期", value: upcoming.length, cls: "status-ok" },
    { label: "待确认交接", value: openHandovers.length, cls: openHandovers.length ? "status-watch" : "status-ok" },
  ];

  return (
    <section className="metrics-grid metrics-6">
      {cards.map((m) => (
        <article key={m.label} className="metric-card">
          <span>{m.label}</span>
          <strong>{m.value}</strong>
          <i className={m.cls} />
        </article>
      ))}
    </section>
  );
}

function countWindow(unaccepted: AppState["cases"]): number {
  const now = Date.now();
  return unaccepted.filter(
    (c) => c.riskFlaggedAt && now - c.riskFlaggedAt <= 24 * HOUR,
  ).length;
}
