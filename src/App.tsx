import { useState } from "react";
import "./styles.css";
import { useAppState } from "./storage/useAppState";
import { Banner } from "./ui/Banner";
import { Metrics } from "./ui/Metrics";
import { CasesBoard } from "./ui/CasesBoard";
import { ScheduleBoard } from "./ui/ScheduleBoard";
import { HandoverBoard } from "./ui/HandoverBoard";
import { VersionBoard } from "./ui/VersionBoard";

const TABS = [
  { id: "cases", name: "个案登记 · 危机随访" },
  { id: "schedule", name: "督导排班" },
  { id: "handover", name: "改派交接" },
  { id: "version", name: "排期版本" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function App() {
  const { state, notice, apply, dismiss, reset } = useAppState();
  const [tab, setTab] = useState<TabId>("cases");

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-12 · port 5112</p>
          <h1>督导排班与危机随访交接台</h1>
          <p className="subtitle">
            个案风险 · 随访截止 · 咨询师 / 督导 / 会谈室排班；人员重叠、高风险 24h 无接单或房间冲突整笔拒绝并保留原计划；
            改派先建交接单，督导确认前原咨询师不释放，未完成随访随交接承接。
          </p>
        </div>
        <div className="stack-card">
          <span>架构（按层拆分）</span>
          <strong>数据 domain · 判定 rules · 存储 storage · 界面 ui</strong>
          <button className="reset-btn" onClick={reset}>重置为演示数据</button>
        </div>
      </section>

      <Banner notice={notice} onDismiss={dismiss} />
      <Metrics state={state} />

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </nav>

      {tab === "cases" && <CasesBoard state={state} apply={apply} />}
      {tab === "schedule" && <ScheduleBoard state={state} apply={apply} />}
      {tab === "handover" && <HandoverBoard state={state} apply={apply} />}
      {tab === "version" && <VersionBoard state={state} />}
    </main>
  );
}

export default App;
