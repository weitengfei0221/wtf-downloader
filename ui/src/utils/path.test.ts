import { describe, expect, it } from 'vitest';
import { joinPath } from './path';

/**
 * 护栏（2026-11）：下载目录可能带尾分隔符，`${dir}/${name}` 会拼出 `D:\Downloads\/x.zip`，
 * 该路径会原样进入后端 `open_path` 的绝对路径校验与错误文案（"文件不存在：…"）。
 */
describe('joinPath（目录 + 文件名）', () => {
  it('目录无尾分隔符：用单个 / 连接', () => {
    expect(joinPath('D:\\Downloads', 'ubuntu.iso')).toBe('D:\\Downloads/ubuntu.iso');
  });

  it('目录带一个尾反斜杠：去净后再连接（不产生 \\/）', () => {
    expect(joinPath('D:\\Downloads\\', 'ubuntu.iso')).toBe('D:\\Downloads/ubuntu.iso');
  });

  it('目录带尾正斜杠 / 多个分隔符：一并去净', () => {
    expect(joinPath('D:/Downloads/', 'a.zip')).toBe('D:/Downloads/a.zip');
    expect(joinPath('/home/me/downloads//', 'a.zip')).toBe('/home/me/downloads/a.zip');
  });

  it('根目录保留根：/ → /a.txt', () => {
    expect(joinPath('/', 'a.txt')).toBe('/a.txt');
  });

  it('目录为空串：退化为文件名（不产生前导 /）', () => {
    expect(joinPath('', 'a.txt')).toBe('a.txt');
  });

  it('文件名中的空格与中文原样保留（不做 URL 编码）', () => {
    expect(joinPath('D:\\下载', '我的 文件.zip')).toBe('D:\\下载/我的 文件.zip');
  });
});
