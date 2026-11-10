import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { TaskRecord, TaskStatus } from '@/api/types';
import { useTaskSelection } from './useTaskSelection';

/** 多选状态机行为验证（§2.9）：ref 装载 visible 模拟筛选；无组件实例时不注册 window 监听。 */
const task = (id: string, status: TaskStatus = 'completed'): TaskRecord => ({
  id,
  url: 'https://example.com/f.zip',
  finalUrl: 'https://example.com/f.zip',
  filename: `${id}.zip`,
  dir: 'D:/downloads',
  totalBytes: 1000,
  status,
  speedLimit: null,
  error: null,
  retryCount: 0,
  downloadedBytes: 0,
  createdAt: 1,
  updatedAt: 1,
});

function setup(rows: TaskRecord[]) {
  const visible = ref(rows);
  const sel = useTaskSelection(() => visible.value);
  return { visible, sel };
}

const ids = (sel: ReturnType<typeof useTaskSelection>): string[] => [...sel.checkedIds.value];
const selectedIds = (sel: ReturnType<typeof useTaskSelection>): string[] =>
  sel.selected.value.map((row) => row.id);
const esc = (): KeyboardEvent => ({ key: 'Escape' }) as KeyboardEvent;
const key = (k: string): KeyboardEvent => ({ key: k }) as KeyboardEvent;
const keyWith = (opts: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ key: 'a', ctrlKey: false, metaKey: false, target: null, preventDefault: () => {}, ...opts }) as unknown as KeyboardEvent;

describe('全选只作用于 visible（不碰 store.tasks 全集）', () => {
  it('当前筛选结果被全选，隐藏行不进勾选集合', () => {
    const { visible, sel } = setup([task('a'), task('b'), task('c')]);
    visible.value = [task('a'), task('b')]; // 模拟筛选隐藏 c

    sel.selectAll();

    expect(ids(sel)).toEqual(['a', 'b']);
    expect(selectedIds(sel)).toEqual(['a', 'b']);
    expect(sel.count.value).toBe(2);
    expect(sel.allVisibleSelected.value).toBe(true);
  });

  it('筛选切回后隐藏行仍未被勾选，allVisibleSelected 变 false', () => {
    const { visible, sel } = setup([task('a'), task('b'), task('c')]);
    visible.value = [task('a')];
    sel.selectAll();
    visible.value = [task('a'), task('b'), task('c')];

    expect(ids(sel)).toEqual(['a']);
    expect(sel.allVisibleSelected.value).toBe(false);
  });

  it('批量目标 selected 只含 visible 内勾选行（筛选隐藏的行永不参与动作）', () => {
    const { visible, sel } = setup([task('a'), task('b'), task('c')]);
    sel.selectAll();
    visible.value = [task('b')];

    expect(ids(sel)).toEqual(['a', 'b', 'c']);
    expect(selectedIds(sel)).toEqual(['b']);
  });

  it('toggleAll：未全选则全选当前筛选，已全选则只取消当前筛选内', () => {
    const { visible, sel } = setup([task('a'), task('b'), task('c')]);
    visible.value = [task('a'), task('b')];
    sel.toggleAll();
    expect(ids(sel)).toEqual(['a', 'b']);

    visible.value = [task('b'), task('c')];
    sel.toggleAll(); // 此时 b 已勾、c 未勾 → 全选当前筛选
    expect(ids(sel)).toEqual(['a', 'b', 'c']);

    sel.toggleAll(); // 当前筛选已全选 → 取消 b、c，a 保留（不属于当前筛选）
    expect(ids(sel)).toEqual(['a']);
  });
});

describe('Shift 连选以上一次点击为锚点、按 visible 顺序连续选', () => {
  it('a → Shift+d 把 a..d 整段加入（不清空已有勾选）', () => {
    const { sel } = setup([task('a'), task('b'), task('c'), task('d')]);
    sel.toggle('a');
    sel.toggle('d', true);

    expect(ids(sel)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('连选范围由当前 visible 决定，被筛选隐藏的行不在段内', () => {
    const { sel } = setup([task('a'), task('c'), task('d')]); // b 被筛选隐藏
    sel.toggle('a');
    sel.toggle('d', true);

    expect(ids(sel)).toEqual(['a', 'c', 'd']);
  });

  it('反向 Shift（d → Shift+a）同样连续选整段', () => {
    const { sel } = setup([task('a'), task('b'), task('c'), task('d')]);
    sel.toggle('d');
    sel.toggle('a', true);
    // 勾选集合是 Set（插入序 d,a,b,c），但批量目标仍按 visible 顺序派生
    expect(ids(sel).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(selectedIds(sel)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clear 重置锚点；之后首次 Shift 点击退化为普通切换', () => {
    const { sel } = setup([task('a'), task('b'), task('c'), task('d')]);
    sel.toggle('a');
    sel.toggle('d', true);
    sel.clear();
    sel.toggle('c', true); // 锚点已清空 → 只勾 c，而不是 a..c
    expect(ids(sel)).toEqual(['c']);
  });

  it('无锚点时 Shift 退化为普通切换；普通点击可取消勾选', () => {
    const { sel } = setup([task('a'), task('b')]);
    sel.toggle('a', true);
    expect(ids(sel)).toEqual(['a']);
    sel.toggle('a');
    expect(ids(sel)).toEqual([]);
  });
});

describe('Esc 清空 / 删除成功后清理选择', () => {
  it('Esc 清空勾选集合与锚点', () => {
    const { sel } = setup([task('a'), task('b')]);
    sel.selectAll();
    sel.onWindowKeydown(esc());

    expect(ids(sel)).toEqual([]);
    expect(sel.allVisibleSelected.value).toBe(false);
  });

  it('非 Esc 键不清空（关菜单/弹窗的 Esc 由消费方 stopPropagation 拦截）', () => {
    const { sel } = setup([task('a'), task('b')]);
    sel.selectAll();
    sel.onWindowKeydown(key('Enter'));
    expect(ids(sel)).toEqual(['a', 'b']);
  });

  it('removeIds 清掉已删 id，其余保留；锚点若被删则重置', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    sel.selectAll();
    sel.removeIds(['a', 'c']);
    expect(ids(sel)).toEqual(['b']);

    sel.removeIds([]);
    expect(ids(sel)).toEqual(['b']); // 空数组不动
  });

  it('clear 与 removeIds 之后重新全选仍只作用于 visible', () => {
    const { sel } = setup([task('a'), task('b')]);
    sel.selectAll();
    sel.clear();
    expect(ids(sel)).toEqual([]);
    sel.selectAll();
    expect(ids(sel)).toEqual(['a', 'b']);
  });
});

describe('selectOnly：左键清空原选择、只选该行并设 Shift 锚点', () => {
  it('已有 a,b 时点击 c → 只剩 c', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    sel.toggle('a');
    sel.toggle('b');
    sel.selectOnly('c');
    expect(ids(sel)).toEqual(['c']);
    expect(sel.count.value).toBe(1);
  });

  it('selectOnly 之后 Shift 点击从该行开始连选（锚点已更新）', () => {
    const { sel } = setup([task('a'), task('b'), task('c'), task('d')]);
    sel.toggle('a');
    sel.selectOnly('d');
    sel.toggle('b', true);
    expect(ids(sel).sort()).toEqual(['b', 'c', 'd']);
    expect(selectedIds(sel)).toEqual(['b', 'c', 'd']);
  });

  it('prepareContext：行不在集合中收敛为单选，已在集合中保持多选', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    sel.toggle('a');
    sel.toggle('b');
    sel.prepareContext('c');
    expect(ids(sel)).toEqual(['c']);
    sel.prepareContext('c');
    expect(ids(sel)).toEqual(['c']); // 不重复清空、不误加
  });
});

describe('Ctrl 切换成员资格（不清空其它行）', () => {
  it('Ctrl+点击未选行 → 加入；再 Ctrl+点击同一行 → 移出，其它行保留', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    sel.selectOnly('b');
    sel.toggle('a', false);
    expect(ids(sel).sort()).toEqual(['a', 'b']);
    sel.toggle('a', false);
    expect(ids(sel)).toEqual(['b']);
  });
});

/**
 * 2026-11 第七轮用户实测：「按住 ctrl 选的时候最后一次点击选中的状态貌似被覆盖了……
 * 第三个任务其实被选中了，但是颜色看不出来被选中了」（右键菜单显示「已选 3 个任务」）。
 * 先证伪「选择集合被逻辑覆盖」这一假设：若 3 行（尤其最后点的行）has() 全为 true、
 * checkedIds 每次 commit 同步、selected 正确派生，则根因只在视觉态，禁止改样式掩盖逻辑问题。
 */
describe('Ctrl 连点 3 行：选择集合本身无覆盖 bug（用户实测根因排查）', () => {
  it('Ctrl 连续点击 a/b/c：三行 has() 全 true，最后一次点击的 c 也在集合内', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    sel.toggle('a', false);
    sel.toggle('b', false);
    sel.toggle('c', false);

    expect(sel.has('a')).toBe(true);
    expect(sel.has('b')).toBe(true);
    expect(sel.has('c')).toBe(true); // 最后一次点击的行：不能被前两次覆盖
    expect(ids(sel).sort()).toEqual(['a', 'b', 'c']);
    expect(sel.count.value).toBe(3);
    expect(selectedIds(sel)).toEqual(['a', 'b', 'c']); // selected computed 正确派生
  });

  it('视图真实路径：普通点击 a → Ctrl+b → Ctrl+c，最后一行仍未丢', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    sel.selectOnly('a'); // 普通左键
    sel.toggle('b', false); // Ctrl
    sel.toggle('c', false); // Ctrl：最后一次点击
    expect(sel.has('c')).toBe(true);
    expect([...sel.checkedIds.value].sort()).toEqual(['a', 'b', 'c']);
    expect(sel.selected.value.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('checkedIds 每次 commit 都替换为新 Set（引用变化可触发响应式），无静默覆盖', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    const before = sel.checkedIds.value;
    sel.toggle('a', false);
    const afterA = sel.checkedIds.value;
    expect(afterA).not.toBe(before);
    expect([...afterA]).toEqual(['a']);
    sel.toggle('b', false);
    sel.toggle('c', false);
    expect(sel.checkedIds.value).not.toBe(afterA);
    expect([...sel.checkedIds.value].sort()).toEqual(['a', 'b', 'c']);
  });

  it('selected 只从 visible 派生：筛掉一行后集合保留但动作集合收敛', () => {
    const { visible, sel } = setup([task('a'), task('b'), task('c')]);
    sel.toggle('a', false);
    sel.toggle('b', false);
    sel.toggle('c', false);
    visible.value = [task('a'), task('c')];
    expect([...sel.checkedIds.value].sort()).toEqual(['a', 'b', 'c']);
    expect(selectedIds(sel)).toEqual(['a', 'c']);
  });
});

describe('selectIds：框选批量提交（追加 / 替换 / 隐藏行永不参与）', () => {
  it('替换模式先清空再选，只保留命中的 visible id', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    sel.toggle('a', false);
    sel.selectIds(['b', 'c', 'ghost'], false);
    expect(ids(sel).sort()).toEqual(['b', 'c']);
    expect(sel.selected.value.map((row) => row.id)).toEqual(['b', 'c']);
  });

  it('追加模式保留既有选择并与命中集合取并集', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    sel.selectOnly('a');
    sel.selectIds(['b', 'b', 'ghost'], true);
    expect(ids(sel).sort()).toEqual(['a', 'b']);
  });

  it('空命中 + 替换 = 清空选择（框选空白区域的语义）', () => {
    const { sel } = setup([task('a')]);
    sel.selectOnly('a');
    sel.selectIds([], false);
    expect(ids(sel)).toEqual([]);
  });
});

describe('Ctrl+A 只全选 visible，且文本输入内不拦截', () => {
  it('Ctrl+A 只作用当前筛选结果，隐藏行不进动作集合', () => {
    const { visible, sel } = setup([task('a'), task('b'), task('c')]);
    visible.value = [task('a'), task('b')];
    sel.onWindowKeydown(keyWith({ key: 'a', ctrlKey: true }));
    expect(ids(sel)).toEqual(['a', 'b']);
    expect(selectedIds(sel)).toEqual(['a', 'b']);
    expect(sel.allVisibleSelected.value).toBe(true);
  });

  it('焦点在 INPUT / TEXTAREA / contentEditable 内时不抢 Ctrl+A', () => {
    const { sel } = setup([task('a'), task('b')]);
    for (const target of [
      { tagName: 'INPUT' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ]) {
      sel.onWindowKeydown(keyWith({ ctrlKey: true, target: target as unknown as EventTarget }));
      expect(ids(sel)).toEqual([]);
    }
  });

  it('非 Ctrl 的 a / 非 a 的 Ctrl 键都不触发全选', () => {
    const { sel } = setup([task('a'), task('b')]);
    sel.onWindowKeydown(keyWith({ key: 'a', ctrlKey: false }));
    sel.onWindowKeydown(keyWith({ key: 'f', ctrlKey: true }));
    expect(ids(sel)).toEqual([]);
  });

  it('Ctrl+A 会 preventDefault（阻止浏览器全选整页文本）', () => {
    const { sel } = setup([task('a')]);
    const preventDefault = vi.fn();
    sel.onWindowKeydown(keyWith({ ctrlKey: true, preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});

describe('Esc 清空后锚点复位；removeIds 清掉已删 id', () => {
  it('Esc 之后首次 Shift 点击退化为普通切换（锚点已清）', () => {
    const { sel } = setup([task('a'), task('b'), task('c'), task('d')]);
    sel.selectOnly('a');
    sel.toggle('d', true);
    sel.onWindowKeydown(esc());
    expect(ids(sel)).toEqual([]);
    sel.toggle('c', true);
    expect(ids(sel)).toEqual(['c']);
  });

  it('removeIds 只清成功删除的 id，锚点被删时复位', () => {
    const { sel } = setup([task('a'), task('b'), task('c')]);
    sel.selectOnly('a');
    sel.removeIds(['a', 'c']);
    expect(ids(sel)).toEqual([]);
    sel.toggle('b', true); // 锚点已复位 → 只勾 b，而不是 a..b
    expect(ids(sel)).toEqual(['b']);
  });
});
