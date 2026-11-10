import { describe, expect, it } from 'vitest';
import { anchoredStyleAt } from './dialog';

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 200, estimatedHeight: 148 };

describe('anchoredStyleAt（坐标点定位，越界翻转）', () => {
  it('常规位置：菜单落在点右下方（margin 4px）', () => {
    expect(anchoredStyleAt({ x: 300, y: 200 }, { ...MENU, viewport: VIEWPORT })).toEqual({
      left: '300px',
      top: '204px',
      width: '200px',
    });
  });

  it('右侧放不下 → 翻转到点左侧', () => {
    const style = anchoredStyleAt({ x: 900, y: 200 }, { ...MENU, viewport: VIEWPORT });
    expect(style.left).toBe(`${900 - 200 - 4}px`);
    expect(style.top).toBe('204px');
  });

  it('下方放不下 → 翻转到点上方', () => {
    const style = anchoredStyleAt({ x: 300, y: 780 }, { ...MENU, viewport: VIEWPORT });
    expect(style.top).toBe(`${780 - 148 - 4}px`);
    expect(style.left).toBe('300px');
  });

  it('贴边坐标仍保留 8px 视口边距', () => {
    const topLeft = anchoredStyleAt({ x: 2, y: 2 }, { ...MENU, viewport: VIEWPORT });
    expect(topLeft.left).toBe('8px');
    expect(topLeft.top).toBe('8px');

    const bottomRight = anchoredStyleAt({ x: 998, y: 798 }, { ...MENU, viewport: VIEWPORT });
    expect(bottomRight.left).toBe(`${1000 - 200 - 8}px`);
    expect(bottomRight.top).toBe(`${800 - 148 - 8}px`);
  });

  it('不给宽度时只做边距收紧，不输出 width', () => {
    const style = anchoredStyleAt({ x: 999, y: 100 }, { viewport: VIEWPORT });
    expect(style.left).toBe(`${1000 - 8}px`);
    expect(style.width).toBeUndefined();
  });
});
