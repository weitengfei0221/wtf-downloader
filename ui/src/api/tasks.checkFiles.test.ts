import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// 只验证「前端实参形状」，不依赖 Tauri 运行时：mock 掉 IPC / Channel / event。
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { checkFiles } from './tasks';

const ipc = invoke as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  ipc.mockResolvedValue([]);
});

/**
 * 跨端冻结契约（DESIGN.md §2.10 / SPEC §5.1）：
 * 命令名 check_files 保持 snake_case，永不做 camelCase 转换；
 * 参数 { taskIds: string[] }；返回 string[]（文件不存在的已完成任务 id）。
 */
describe('checkFiles 命令契约', () => {
  it('命令名严格 check_files，参数为 { taskIds }（不转成 checkFiles / task_ids）', async () => {
    await checkFiles(['t1', 't2']);
    expect(ipc).toHaveBeenCalledExactlyOnceWith('check_files', { taskIds: ['t1', 't2'] });
  });

  it('返回 string[] 原样透传（不在前端二次过滤）', async () => {
    ipc.mockResolvedValue(['t1', 't9']);
    await expect(checkFiles(['t1', 't9', 't3'])).resolves.toEqual(['t1', 't9']);
  });

  it('空 taskIds 也如实发送，不造 id、不跳过调用', async () => {
    await checkFiles([]);
    expect(ipc).toHaveBeenCalledExactlyOnceWith('check_files', { taskIds: [] });
  });

  it('命令失败向上抛（由 useMissingFileCheck 的 catch 留 warn，不在此吞）', async () => {
    ipc.mockRejectedValue({ code: 'not_found', message: 'command not found' });
    await expect(checkFiles(['t1'])).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('静态护栏：命令名与分层', () => {
  const source = readFileSync(fileURLToPath(new URL('./tasks.ts', import.meta.url)), 'utf8');

  it('调用点唯一且保持 snake_case check_files', () => {
    expect(source).toContain("invoke<string[]>('check_files', { taskIds })");
    expect(source.match(/'check_files'/g)).toHaveLength(1);
    expect(source).not.toContain("'checkFiles'");
  });

  it('checkFiles 只在 api/ 层直连 invoke（组件层禁 import @tauri-apps/api）', () => {
    expect(source).toContain('export function checkFiles(taskIds: string[]): Promise<string[]>');
    expect(source).toContain("import { invoke } from './invoke'");
  });
});
