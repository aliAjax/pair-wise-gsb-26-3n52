import type { Notice } from "../storage/useAppState";

export function Banner({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  if (!notice) return null;
  if (notice.ok) {
    return (
      <div className="banner banner-ok">
        <strong>操作成功</strong>
        <span>计划已更新并落库，刷新后一致。</span>
        <button onClick={onDismiss} aria-label="关闭">×</button>
      </div>
    );
  }
  return (
    <div className="banner banner-reject">
      <div className="banner-head">
        <strong>整笔拒绝 · 原计划保留</strong>
        <button onClick={onDismiss} aria-label="关闭">×</button>
      </div>
      <ul>
        {notice.violations.map((v, i) => (
          <li key={i}>
            <code>{v.code}</code> {v.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
