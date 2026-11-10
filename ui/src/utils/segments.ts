/**
 * 分片进度摘要（DESIGN.md §1.2 元数据行 / §6.2）。
 *
 * 2026-10-25 实测修复：并行分片的语义改为「活跃 / 完成」双态。
 * 旧实现只统计已完成分片，而 16 片并行下载接近同时完成，中途永远是 0/16、
 * 直到全部完成时文案直接隐藏 → 用户永远看不到有效信息。
 * 现规则：
 *   - 已完成 > 0 且未全部完成 → "{done}/{total} 分片完成"
 *   - 已完成 = 0 且存在已写入字节的分片 → "{active} 分片并行中"
 *   - 全部完成 / 尚未开始 / 单片流式（无 Content-Length）→ 不展示
 */

import { t } from '@/locales/zh-CN';
import type { SegmentProgress } from '@/api/types';

/** 完成分片：已知长度且已下满 */
function isSegmentDone(segment: SegmentProgress): boolean {
  return segment.total > 0 && segment.downloaded >= segment.total;
}

/** 活跃分片：未完成但已写入字节 */
function isSegmentActive(segment: SegmentProgress): boolean {
  return !isSegmentDone(segment) && segment.downloaded > 0;
}

/**
 * 元数据行分片文案；返回 null 表示该时刻不展示。
 * @param segments 进度帧里的分片快照
 * @param totalBytes 总字节数（null/undefined = 无 Content-Length 的流式下载）
 */
export function segmentsSummaryText(
  segments: SegmentProgress[] | undefined,
  totalBytes: number | null | undefined,
): string | null {
  // 单片流式（服务器不支持分段 / 未知长度）没有「分片」语义，不展示
  if (!segments || segments.length < 2) return null;
  if (totalBytes == null) return null;

  const total = segments.length;
  const done = segments.filter(isSegmentDone).length;
  // 全部完成：状态即将切到 completed（文案另有「完成于」），此处隐藏
  if (done === total) return null;
  if (done > 0) return t('meta.segments', { done, total });

  const active = segments.filter(isSegmentActive).length;
  if (active > 0) return t('meta.segmentsActive', { active });
  // 刚建立连接、尚无字节写入：不展示无意义的 0/N
  return null;
}
