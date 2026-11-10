import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 静态护栏（2026-11 两次真实缺陷）：
 * 1) 行内按钮「打开所在目录」裸 await → reject = 未处理 Promise（"点了没反应"）；
 * 2) Enter 键盘路径另写一份 `void openFileLocation(id)` 且漏 catch（"按回车没反应"）。
 * 根因是**同一种动作有两份实现**。现在键盘路径复用 `onAction(task, 'open-dir')`，
 * 本文件把"只允许一条实现路径 + 失败必须有出口"变成断言，防止再分叉。
 *
 * 判定策略：按**语句块**而非单行扫描——prettier 可能把长调用折成多行
 * （`void openFile(\n  longArg,\n).catch(...)`），单行匹配会漏判成假阳性。
 * 因此"调用点之后 4 行内出现 `.catch(`"即视为已有出口。
 */
const source = readFileSync(
  fileURLToPath(new URL('./TaskListView.vue', import.meta.url)),
  'utf8',
);
const lines = source.split('\n');

/** 找出所有 fire-and-forget（`void xxx(`）却没有任何 catch 出口的调用点行号（1-based） */
function bareFireAndForget(callPattern: RegExp): number[] {
  const hits: number[] = [];
  lines.forEach((line, index) => {
    if (!line.includes('void ') || !callPattern.test(line)) return;
    const window = lines.slice(index, index + 4).join('\n');
    if (!/\.catch\(/.test(window)) hits.push(index + 1);
  });
  return hits;
}

describe('TaskListView 打开类操作：单一路径 + 失败出口', () => {
  it('Enter 键盘路径复用 onAction（不自行调用打开命令）', () => {
    expect(source).toContain("void onAction(task, 'open-dir')");
  });

  it('`openFileLocation(` 全文件只有一个调用点（鼠标/键盘共用 onAction）', () => {
    const calls = source.match(/openFileLocation\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('不存在裸 `void openFile(...)`（调用点后 4 行内须有 .catch）', () => {
    // 行号便于定位；空数组 = 无裸调用
    expect(bareFireAndForget(/void openFile\(/)).toEqual([]);
  });

  it('打开文件走 joinPath 拼接（禁裸拼 `${dir}/${name}`，防尾分隔符产生 // 或 \\/）', () => {
    expect(source).toContain('openFile(joinPath(task.dir, task.filename))');
    expect(source).not.toContain('`${task.dir}/${task.filename}`');
  });

  it('两处打开类调用都走 toast.pushError（文案规则单一入口，禁自行拼前缀）', () => {
    const calls = source.match(/toast\.pushError\('toast\.openFailed', e\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toMatch(/toast\.push\('error',\s*'toast\./);
  });

  it('onAction 整体有兜底 catch（不变量：三条 fire-and-forget 入口依赖它永不 reject）', () => {
    const start = source.indexOf('async function onAction');
    expect(start).toBeGreaterThan(-1);

    // 取 onAction 函数体：到下一个顶层 `async function` 为止（不写死后继函数名，防重排误伤）
    const nextFn = source.indexOf('\nasync function ', start + 1);
    const body = source.slice(start, nextFn === -1 ? source.length : nextFn);

    // 锚定到 `default:` 之后：内层 case 全在 default 之前，结构上只有最外层兜底能出现在其后。
    // 若将来某个 case 自己也用 saveFailed 前缀，这条断言仍不会被它"顶替"通过。
    const defaultIndex = body.indexOf('default:');
    expect(defaultIndex).toBeGreaterThan(-1);

    expect(body.slice(defaultIndex)).toContain("toast.pushError('toast.saveFailed', e)");
  });
});
