import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError, isResumeConflict } from './invoke';

/**
 * AC-09（续传冲突 → 弹"是否重新下载"）判据的单一实现守卫。
 *
 * 历史缺陷（2026-11）：同一份语义有两份判据——命令 reject 路径判 `code`，`task:failed`
 * 事件路径只嗅 `error` 文本。一旦引擎侧把错误文案中文化/改写，事件路径会**静默失效**
 * （弹窗不出现、用户失去重下入口，且无任何报错）。现在收敛为 `isResumeConflict` 一处：
 * **code 优先**，文本嗅探仅作过渡兼容（后端载荷全量带 code 后删除）。
 */
describe('isResumeConflict：命令 reject 路径', () => {
  it('ApiError.code 命中 → true（不看 message 文案）', () => {
    expect(isResumeConflict(new ApiError('resume_conflict', '资源已变化'))).toBe(true);
  });

  it('ApiError 其他 code → false，即使 message 里出现该标识也不翻案', () => {
    expect(isResumeConflict(new ApiError('io_error', 'resume_conflict 写盘失败'))).toBe(false);
  });

  it('裸字符串错误（非 AppError）含标识 → true', () => {
    expect(isResumeConflict('ipc error: resume_conflict')).toBe(true);
  });
});

describe('isResumeConflict：task:failed 事件载荷', () => {
  it('载荷带 code 时只认 code（error 文案完全不含标识也成立）', () => {
    const payload = { taskId: 't1', error: '资源已变化，已中止', code: 'resume_conflict' };
    expect(isResumeConflict(payload)).toBe(true);
  });

  it('code 与文本冲突时以 code 为准（文本不得翻案）', () => {
    const payload = { taskId: 't1', error: 'resume_conflict 相关旧文案', code: 'io_error' };
    expect(isResumeConflict(payload)).toBe(false);
  });

  it('过渡兼容：旧后端载荷只有 error 文本时仍能识别', () => {
    expect(isResumeConflict({ taskId: 't1', error: 'resume_conflict' })).toBe(true);
    expect(isResumeConflict({ taskId: 't1', error: 'v2: resume_conflict: etag 变化' })).toBe(true);
  });

  it('普通失败载荷 → false（不能误触发重下弹窗）', () => {
    expect(isResumeConflict({ taskId: 't1', error: '服务器返回 404' })).toBe(false);
    expect(isResumeConflict({ taskId: 't1', error: '分片重试耗尽（3 次）：响应数据不完整（decode）' })).toBe(false);
  });

  it('无 code 无 error 的对象 / null / undefined → false', () => {
    expect(isResumeConflict({})).toBe(false);
    expect(isResumeConflict(null)).toBe(false);
    expect(isResumeConflict(undefined)).toBe(false);
  });
});

/**
 * 静态护栏：调用点不得再分叉出第二份判据。
 * App.vue 曾写 `p.error.includes('resume_conflict')`，若有人再加回来，这条立刻红。
 */
describe('调用点单一（防判据分叉）', () => {
  const appVue = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8');
  /** 去掉注释再断言：App.vue 的 JSDoc 里**必须**保留 resume_conflict 的说明文字 */
  const appCode = appVue
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  it('App.vue 的事件路径改调 isResumeConflict（code 优先版）', () => {
    expect(appVue).toContain('if (isResumeConflict(p)) uiStore.openResumeConflict(p.taskId);');
  });

  it('App.vue 的可执行代码不再自己嗅探错误文本', () => {
    expect(appCode).not.toContain("includes('resume_conflict')");
    expect(appCode).not.toContain('resume_conflict');
  });
});
