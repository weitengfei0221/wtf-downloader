import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 主题三态行为验证（DESIGN.md §4.2，2026-11-13 用户裁决「主题三个选项」）。
 * 仓库 vitest environment=node（无 jsdom），故这里自建最小 window/document 替身，
 * 只覆盖本模块真正用到的 API：documentElement.dataset.theme、matchMedia、localStorage。
 */
type FakeMq = {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  emit: (matches: boolean) => void;
};

const dataset: Record<string, string> = {};
let mqs: FakeMq[] = [];
let store: Record<string, string> = {};

function makeMq(matches: boolean): FakeMq {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  const mq: FakeMq = {
    matches,
    addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
      listeners.push(cb);
    }),
    removeEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
      const at = listeners.indexOf(cb);
      if (at >= 0) listeners.splice(at, 1);
    }),
    emit(next: boolean) {
      mq.matches = next;
      for (const cb of [...listeners]) cb({ matches: next });
    },
  };
  return mq;
}

const installed: unknown[] = [];

beforeEach(() => {
  mqs = [];
  store = {};
  for (const k of Object.keys(dataset)) delete dataset[k];

  const win = {
    matchMedia: vi.fn((_q: string) => {
      const mq = makeMq(false);
      mqs.push(mq);
      return mq;
    }),
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  };
  const doc = { documentElement: { dataset } };

  // 记录原值以便还原（本仓库 node 环境下通常都是 undefined）
  installed.push([globalThis, 'window', (globalThis as never as { window?: unknown }).window]);
  installed.push([globalThis, 'document', (globalThis as never as { document?: unknown }).document]);
  (globalThis as never as { window: unknown }).window = win;
  (globalThis as never as { document: unknown }).document = doc;
});

afterEach(() => {
  for (let i = installed.length - 1; i >= 0; i -= 1) {
    const [target, key, prev] = installed[i] as [Record<string, unknown>, string, unknown];
    if (prev === undefined) delete target[key];
    else target[key] = prev;
  }
  installed.length = 0;
  vi.resetModules();
});

/** 每个用例重新 import，避免模块级 activeStop 跨用例残留 */
async function themeModule() {
  return import('./theme');
}

describe('resolveTheme：3 偏好 × 系统深浅 六格矩阵', () => {
  it('system 跟随系统；light / dark 是绝对偏好，无视系统值', async () => {
    const { resolveTheme } = await themeModule();

    // system
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    // light（绝对）
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    // dark（绝对）
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('applyThemePreference：写 data-theme，且只在 system 时订阅系统变化', () => {
  it('system：立即写 data-theme，并注册 matchMedia change 监听', async () => {
    const { applyThemePreference } = await themeModule();

    const stop = applyThemePreference('system', true);
    expect(dataset.theme).toBe('dark');
    expect(mqs).toHaveLength(1);
    expect(mqs[0]!.addEventListener).toHaveBeenCalledOnce();

    // 系统切浅色 → 跟随
    mqs[0]!.emit(false);
    expect(dataset.theme).toBe('light');

    stop();
    expect(mqs[0]!.removeEventListener).toHaveBeenCalledOnce();
    // 停止后系统再变不应再改 data-theme
    mqs[0]!.emit(true);
    expect(dataset.theme).toBe('light');
  });

  it('固定 light：不注册任何 matchMedia 监听（否则会被系统事件覆盖）', async () => {
    const { applyThemePreference } = await themeModule();

    const stop = applyThemePreference('light', true); // 系统是深色也不跟随
    expect(dataset.theme).toBe('light');
    expect(mqs).toHaveLength(0);

    // 返回的 stop 仍可安全调用（幂等空操作）
    expect(() => stop()).not.toThrow();
    expect(dataset.theme).toBe('light');
  });

  it('固定 dark：不注册任何 matchMedia 监听', async () => {
    const { applyThemePreference } = await themeModule();

    applyThemePreference('dark', false); // 系统是浅色也不跟随
    expect(dataset.theme).toBe('dark');
    expect(mqs).toHaveLength(0);
  });
});

describe('activateTheme：偏好切换时旧监听必须停掉（失败模式回归）', () => {
  it('system → light：旧系统监听被移除，之后系统事件不再改主题', async () => {
    const { activateTheme } = await themeModule();

    activateTheme('system', false);
    const first = mqs[0]!;
    expect(first.addEventListener).toHaveBeenCalledOnce();
    expect(dataset.theme).toBe('light');

    activateTheme('light', false);
    // 旧监听已停
    expect(first.removeEventListener).toHaveBeenCalledOnce();
    expect(dataset.theme).toBe('light');
    // 系统切深色：因为已是绝对偏好，且旧监听已停，主题不得变
    first.emit(true);
    expect(dataset.theme).toBe('light');
  });

  it('light → system：只保留一条新监听，不会累积两条', async () => {
    const { activateTheme } = await themeModule();

    activateTheme('light', false);
    expect(mqs).toHaveLength(0);

    activateTheme('system', true);
    expect(mqs).toHaveLength(1);
    expect(dataset.theme).toBe('dark');

    activateTheme('system', false); // 再切一次同值
    // 旧的一条被停，新的一条接替：mqs 共 2 个实例，但只有第 2 个在监听
    expect(mqs[0]!.removeEventListener).toHaveBeenCalledOnce();
    expect(mqs[1]!.addEventListener).toHaveBeenCalledOnce();
    expect(dataset.theme).toBe('light');
  });

  it('stopActiveTheme 之后系统事件不再影响主题', async () => {
    const { activateTheme, stopActiveTheme } = await themeModule();

    activateTheme('system', true);
    expect(dataset.theme).toBe('dark');
    stopActiveTheme();
    mqs[0]!.emit(false);
    expect(dataset.theme).toBe('dark');
  });
});

describe('localStorage 镜像：首装不闪屏 + 非法值回落', () => {
  it('readThemePreference 读回镜像值；缺失或非法回落 system', async () => {
    const { readThemePreference, THEME_STORAGE_KEY } = await themeModule();

    expect(readThemePreference()).toBe('system'); // 缺省
    store[THEME_STORAGE_KEY] = 'dark';
    expect(readThemePreference()).toBe('dark');
    store[THEME_STORAGE_KEY] = 'purple'; // 手改坏值
    expect(readThemePreference()).toBe('system');
  });

  it('writeThemePreference 落盘，供下次冷启动同步上色', async () => {
    const { writeThemePreference, readThemePreference, THEME_STORAGE_KEY } = await themeModule();

    writeThemePreference('light');
    expect(store[THEME_STORAGE_KEY]).toBe('light');
    expect(readThemePreference()).toBe('light');
  });

  it('localStorage 抛错（隐私模式）不影响主题应用', async () => {
    const win = (globalThis as never as { window: { localStorage: unknown } }).window;
    win.localStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const { readThemePreference, writeThemePreference, activateTheme } = await themeModule();

    expect(readThemePreference()).toBe('system');
    expect(() => writeThemePreference('dark')).not.toThrow();
    expect(() => activateTheme('dark', false)).not.toThrow();
    expect(dataset.theme).toBe('dark');
  });
});

describe('无 matchMedia 的降级环境', () => {
  it('system 偏好下不抛错，按浅色处理', async () => {
    const win = (globalThis as never as { window: { matchMedia?: unknown } }).window;
    delete win.matchMedia;
    const { applyThemePreference } = await themeModule();

    expect(() => applyThemePreference('system')).not.toThrow();
    expect(dataset.theme).toBe('light');
  });
});
