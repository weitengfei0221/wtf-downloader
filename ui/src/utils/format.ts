/**
 * 数字与单位格式化（DESIGN.md §6.5，十进制：1 MB = 1000 KB = 1_000_000 B）。
 * 所有输出由组件层配合 .mono 类（--font-mono + tabular-nums）渲染。
 */

const KB = 1000;
const MB = KB * 1000;
const GB = MB * 1000;
const TB = GB * 1000;

/** 小于 10 保留 1 位小数，≥ 10 取整（"2.4 GB" / "13 GB"） */
function smart(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

/** 文件大小：B / KB / MB / GB / TB；null → "--"；0 → "0 B" */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '--';
  if (bytes === 0) return '0 B';
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${smart(bytes / KB)} KB`;
  if (bytes < GB) return `${smart(bytes / MB)} MB`;
  if (bytes < TB) return `${smart(bytes / GB)} GB`;
  return `${smart(bytes / TB)} TB`;
}

/**
 * 速度：0 → "0 B/s"；< 1 KB/s → "N B/s"；< 1 MB/s → KB/s（<10 一位小数，≥10 取整）；
 * < 1 GB/s → "x.x MB/s"（1 位小数）；≥ 1 GB/s → "x.xx GB/s"（2 位小数）
 */
export function formatSpeed(bps: number | null | undefined): string {
  if (bps == null) return '--';
  if (bps === 0) return '0 B/s';
  if (bps < KB) return `${Math.round(bps)} B/s`;
  if (bps < MB) return `${smart(bps / KB)} KB/s`;
  if (bps < GB) return `${(bps / MB).toFixed(1)} MB/s`;
  return `${(bps / GB).toFixed(2)} GB/s`;
}

/** 剩余时间："< 1 秒" / "42 秒" / "3 分 20 秒" / "1 小时 12 分"；不可得 "--" */
export function formatEta(secs: number | null | undefined): string {
  if (secs == null || secs < 0) return '--';
  if (secs < 1) return '< 1 秒';
  if (secs < 60) return `${Math.round(secs)} 秒`;
  const minutes = Math.floor(secs / 60);
  if (minutes < 60) {
    return `${minutes} 分 ${Math.round(secs % 60)} 秒`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

/** 百分比：1 位小数（"63.4%"）；未知大小 "--"；满格 "100%" */
export function formatPercent(done: number, total: number | null | undefined): string {
  if (total == null) return '--';
  if (total <= 0) return done > 0 ? '--' : '100%';
  const pct = (done / total) * 100;
  if (pct >= 100) return '100%';
  return `${pct.toFixed(1)}%`;
}

/** 分片："{已完成}/{总数}"（"16/32"） */
export function formatSegments(done: number, total: number): string {
  return `${done}/${total}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 完成时刻："今天 14:32" / "MM-DD HH:mm"（跨天及更早） */
export function formatCompletedAt(epochMs: number, now: number = Date.now()): string {
  const d = new Date(epochMs);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  if (sameDay) return `今天 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/** 限速值展示（"5 MB/s" / "512 KB/s"）；null → "--" */
export function formatLimit(bps: number | null | undefined): string {
  if (bps == null) return '--';
  if (bps < MB) return `${smart(bps / KB)} KB/s`;
  if (bps < GB) return `${(bps / MB).toFixed(1)} MB/s`;
  return `${(bps / GB).toFixed(2)} GB/s`;
}

/** URL 合法性（粘贴即校验用）：http:// 或 https:// 开头 */
export function isHttpUrl(line: string): boolean {
  return /^https?:\/\/\S+/i.test(line);
}
