import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCompletedAt,
  formatEta,
  formatLimit,
  formatPercent,
  formatSegments,
  formatSpeed,
} from './format';

describe('formatBytes（十进制，1 MB = 1000 KB）', () => {
  it('null/undefined → "--"，0 → "0 B"', () => {
    expect(formatBytes(null)).toBe('--');
    expect(formatBytes(undefined)).toBe('--');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('字节级取整，KB/MB/GB 小于 10 保留 1 位小数', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(2_400_000_000)).toBe('2.4 GB');
  });

  it('≥ 10 取整（"13 GB"）', () => {
    expect(formatBytes(13_000_000_000)).toBe('13 GB');
    expect(formatBytes(1_400_000_000)).toBe('1.4 GB');
  });

  it('跨单位边界不丢精度（≥10 取整，DESIGN.md §6.5）', () => {
    expect(formatBytes(999_999)).toBe('1000 KB');
    expect(formatBytes(999_999_999)).toBe('1000 MB');
  });
});

describe('formatSpeed（十进制）', () => {
  it('0 → "0 B/s"，null → "--"', () => {
    expect(formatSpeed(0)).toBe('0 B/s');
    expect(formatSpeed(null)).toBe('--');
  });

  it('KB 档：<10 一位小数，≥10 取整', () => {
    expect(formatSpeed(800)).toBe('800 B/s');
    expect(formatSpeed(500_000)).toBe('500 KB/s');
    expect(formatSpeed(12_400_000)).toBe('12.4 MB/s');
  });

  it('GB 档 2 位小数', () => {
    expect(formatSpeed(1_250_000_000)).toBe('1.25 GB/s');
  });
});

describe('formatEta', () => {
  it('不可得 → "--"', () => {
    expect(formatEta(null)).toBe('--');
    expect(formatEta(-1)).toBe('--');
  });

  it('边界：< 1 秒 / 秒 / 分秒 / 时分', () => {
    expect(formatEta(0.4)).toBe('< 1 秒');
    expect(formatEta(42)).toBe('42 秒');
    expect(formatEta(200)).toBe('3 分 20 秒');
    expect(formatEta(4320)).toBe('1 小时 12 分');
  });

  it('59.6 秒向上取整不溢出展示', () => {
    expect(formatEta(59.6)).toBe('60 秒');
  });
});

describe('formatPercent', () => {
  it('未知大小 → "--"；0 字节任务 → "100%"', () => {
    expect(formatPercent(0, null)).toBe('--');
    expect(formatPercent(0, 0)).toBe('100%');
  });

  it('1 位小数；满格 "100%" 不带小数', () => {
    expect(formatPercent(634, 1000)).toBe('63.4%');
    expect(formatPercent(1000, 1000)).toBe('100%');
    expect(formatPercent(999, 1000)).toBe('99.9%');
  });
});

describe('formatCompletedAt', () => {
  it('当天 → "今天 HH:mm"', () => {
    const now = new Date(2026, 9, 24, 20, 0).getTime();
    const ts = new Date(2026, 9, 24, 14, 32).getTime();
    expect(formatCompletedAt(ts, now)).toBe('今天 14:32');
  });

  it('跨天 → "MM-DD HH:mm"', () => {
    const now = new Date(2026, 9, 24, 20, 0).getTime();
    const ts = new Date(2026, 8, 30, 9, 5).getTime();
    expect(formatCompletedAt(ts, now)).toBe('09-30 09:05');
  });
});

describe('formatLimit / formatSegments', () => {
  it('限速值展示', () => {
    expect(formatLimit(512_000)).toBe('512 KB/s');
    expect(formatLimit(5_000_000)).toBe('5.0 MB/s');
    expect(formatLimit(null)).toBe('--');
  });

  it('分片计数', () => {
    expect(formatSegments(16, 32)).toBe('16/32');
  });
});
