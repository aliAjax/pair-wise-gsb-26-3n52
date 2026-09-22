// 数据层：时间工具。以"今天的本地整点"为基准，保证演示数据相对今天有效，
// 刷新后仍一致（不依赖硬编码日期）。

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** 今天 hour:00（本地）；若此刻已过该整点则顺延到明天 */
export function todayAt(hour: number, dayOffset = 0): number {
  const now = new Date();
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (d.getTime() <= now.getTime()) {
    d = new Date(d.getTime() + DAY);
  }
  return d.getTime() + dayOffset * DAY;
}

export function nowTs(): number {
  return Date.now();
}

/** yyyy-mm-dd hh:mm */
export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** mm-dd hh:mm，用于紧凑排班表 */
export function fmtShort(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 两个半开区间是否重叠 */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** 距离截止的人类可读倒计时；负数表示已逾期 */
export function countdown(deadline: number, from = Date.now()): string {
  const diff = deadline - from;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / HOUR);
  const m = Math.floor((abs % HOUR) / (60 * 1000));
  const sign = diff < 0 ? "逾期 " : "剩余 ";
  if (h >= 24) {
    return `${sign}${Math.floor(h / 24)}天${h % 24}时`;
  }
  return `${sign}${h}时${m}分`;
}
