import { describe, expect, it } from 'vitest';
import type { SegmentProgress } from '@/api/types';
import { segmentsSummaryText } from './segments';

/** 造分片快照：每片 total=1000，downloaded 由入参给定 */
function segs(downloaded: number[], total = 1000): SegmentProgress[] {
  return downloaded.map((d, index) => ({ index, downloaded: d, total }));
}

describe('segmentsSummaryText（分片活跃/完成双态，2026-10-25 实测修复）', () => {
  it('刚开跑（已完成 0，多片已在写入）→ 活跃文案，不再显示 0/N', () => {
    expect(segmentsSummaryText(segs([120, 90, 30, 0]), 10_000)).toBe('3 分片并行中');
    expect(segmentsSummaryText(segs([1, 1, 1, 1, 1, 1, 1, 1]), 10_000)).toBe('8 分片并行中');
  });

  it('部分分片收尾后 → 完成计数文案', () => {
    expect(segmentsSummaryText(segs([1000, 1000, 480]), 10_000)).toBe('2/3 分片完成');
  });

  it('全部完成 / 尚未写入 / 全部为 0 字节 → 不展示', () => {
    expect(segmentsSummaryText(segs([1000, 1000]), 10_000)).toBeNull();
    expect(segmentsSummaryText(segs([0, 0, 0]), 10_000)).toBeNull();
  });

  it('无 Content-Length 的单片流式下载仍不展示', () => {
    expect(segmentsSummaryText(undefined, null)).toBeNull();
    expect(segmentsSummaryText([], null)).toBeNull();
    expect(segmentsSummaryText(segs([512]), null)).toBeNull();
    // 分片长度未知（total=0）视为单片流式
    expect(segmentsSummaryText([{ index: 0, downloaded: 512, total: 0 }], 10_000)).toBeNull();
  });

  it('分片长度未知（total=0）不算完成，但已写入字节仍算活跃', () => {
    expect(
      segmentsSummaryText(
        [
          { index: 0, downloaded: 300, total: 0 },
          { index: 1, downloaded: 200, total: 1000 },
        ],
        10_000,
      ),
    ).toBe('2 分片并行中');
  });
});
