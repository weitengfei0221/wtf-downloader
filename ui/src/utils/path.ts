/**
 * 路径拼接（DESIGN.md §6.5 邻近工具；仅用于「目录 + 文件名」这类**展示/透传**场景，
 * 不做规范化、不解析 `..`、不转换分隔符风格）。
 *
 * 存在理由（2026-11）：后端 `open_path` 要求绝对路径并原样消费，下载目录由用户在
 * 系统选择器里指定/手工录入，尾部可能带 `\` 或 `/`。直接 `${dir}/${name}` 会拼出
 * `D:\Downloads\/x.zip` 这类双分隔符——Win32 多数情况能容忍，但错误信息里回显的
 * 路径会很怪（"文件不存在：D:\Downloads\/x.zip"），且非 Windows 语义下不保证成立。
 * 因此统一去掉目录尾部所有分隔符后用单个 `/` 连接。
 */

/**
 * 拼接目录与文件名。
 * - 目录尾部的一个或多个 `/`、`\` 一律去净（`D:\Downloads\` → `D:\Downloads`）
 * - 目录为 POSIX 根 `/` 时保留根（`/` + `a.txt` → `/a.txt`）
 * - 目录为空串时退化为文件名本身（调用方仍应保证目录非空）
 */
export function joinPath(dir: string, name: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  if (trimmed === '') return dir.startsWith('/') ? `/${name}` : name;
  return `${trimmed}/${name}`;
}
