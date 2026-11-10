import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ApiError } from '@/api/invoke';
import { useToastStore } from './toast';

beforeEach(() => {
  setActivePinia(createPinia());
});

/**
 * 文案契约护栏（DESIGN.md §6.4，2026-11 项目总监裁决「方案 A」）：
 * 后端 AppError 的 message 已是自包含完整中文句 → 原样上屏，前端**不叠加**业务前缀，
 * 否则出现「打开失败：文件不存在：…」「保存失败：任务不存在…」的语义重复。
 * 只有非 AppError（无业务语义的裸原因）才用调用点的 key 补前缀。
 */
describe('pushError 前缀规则', () => {
  it('AppError → 原样展示（不套「打开失败：」）', () => {
    const toast = useToastStore();
    toast.pushError('toast.openFailed', new ApiError('io_error', '文件不存在：D:/Downloads/x.zip'));

    expect(toast.items).toHaveLength(1);
    expect(toast.items[0]?.message).toBe('文件不存在：D:/Downloads/x.zip');
    expect(toast.items[0]?.kind).toBe('error');
  });

  it('AppError → 原样展示（不套「保存失败：」）', () => {
    const toast = useToastStore();
    toast.pushError('toast.saveFailed', new ApiError('engine_error', '开启开机自启失败: 拒绝访问'));

    expect(toast.items[0]?.message).toBe('开启开机自启失败: 拒绝访问');
  });

  it('运行时 Error（无业务语义）→ 用 key 补前缀', () => {
    const toast = useToastStore();
    toast.pushError('toast.saveFailed', new Error('EACCES: permission denied'));

    expect(toast.items[0]?.message).toBe('保存失败：EACCES: permission denied');
  });

  it('字符串 rejection（IPC 原始串 / 命令未注册）→ 用 key 补前缀', () => {
    const toast = useToastStore();
    toast.pushError('toast.openFailed', 'Command open_path not found');

    expect(toast.items[0]?.message).toBe('打开失败：Command open_path not found');
  });

  it('prefix key 仍受 key 文案控制：add.addFailed（添加失败：{原因}）', () => {
    const toast = useToastStore();
    toast.pushError('add.addFailed', new Error('network down'));

    expect(toast.items[0]?.message).toBe('添加失败：network down');
  });
});
