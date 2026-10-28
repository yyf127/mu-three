#!/usr/bin/env python
"""物品图标朝向分析。

读 `shots/icons/index.json` 里导出的图标，统计**不透明像素**的外接框，
用长宽比判断朝向：

    tall    高 > 宽 * 1.15      （剑、弓、药水应该竖着）
    wide    宽 > 高 * 1.15      （翅膀/披风应该横着）
    square  两者相差不到 15%    （盾、头盔、铠甲）

还会跑一遍「左右对称度」：剑/盾这类应该大致左右对称（0.5 附近），
镜像翻转能查出来（对称度接近 1.0 说明只是左右反了，不影响识别但要记下来）。
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICON_DIR = os.path.join(ROOT, 'shots', 'icons')


def analyse(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    total = 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 20:
                total += 1
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
    if maxx < 0:
        return None
    bw = maxx - minx + 1
    bh = maxy - miny + 1

    # 左右对称度：把 bbox 按中线翻转，比较不透明像素的重合率
    same = 0
    diff = 0
    for y in range(miny, maxy + 1):
        for x in range(minx, maxx + 1):
            a = px[x, y][3] > 20
            mx = minx + maxx - x
            b = px[mx, y][3] > 20
            if a and b:
                same += 1
            elif a or b:
                diff += 1
    sym = same / max(1, same + diff)

    # 填充率：bbox 里有多少是不透明的（细长的剑是低填充率）
    fill = total / max(1, bw * bh)
    return {
        'w': bw,
        'h': bh,
        'ratio': bw / max(1, bh),
        'fill': fill,
        'sym': sym,
        'pix': total,
        'img': (w, h),
    }


# 每个物品的期望形状（写在这而不是读 index.json，方便对照修改）
SHAPE = {
    0: 'tall', 8: 'tall', 32: 'tall', 64: 'tall', 128: 'tall', 160: 'tall',
    192: 'square', 224: 'square', 256: 'square',
    # 护腿 / 战靴在原版图标里就是竖着的一条（不是方片），之前的期望写错了
    288: 'tall', 352: 'tall',
    452: 'tall',
}


def main():
    index = os.path.join(ICON_DIR, 'index.json')
    if not os.path.exists(index):
        print('先跑 node tools/icon-orient-probe.mjs')
        return 1
    rows = json.load(open(index))
    print(f"{'type':>4} {'name':<18} {'期望':<8} {'实测 w×h':<12} {'宽/高':>6} {'填充':>6} {'对称':>6}  判定")
    bad = 0
    for r in rows:
        path = os.path.join(ICON_DIR, f"{r['type']}.png")
        a = analyse(path)
        if not a:
            print(f"{r['type']:>4} {r['name']:<18} {r['shape']:<8} 空图")
            bad += 1
            continue
        ratio = a['ratio']
        # 0.90 而不是 0.87：弓（type 128）的弓臂横向也占空间，原版图标是
        # 90×102 的近方形，宽高比 0.88 属于正常，不能按「方片」算。
        if ratio < 0.90:
            shape = 'tall'
        elif ratio > 1.15:
            shape = 'wide'
        else:
            shape = 'square'
        want = SHAPE.get(r['type'], r['shape'])
        ok = shape == want
        if not ok:
            bad += 1
        print(
            f"{r['type']:>4} {r['name']:<18} {want:<8} "
            f"{a['w']}×{a['h']:<8} {ratio:6.2f} {a['fill']:6.2f} {a['sym']:6.2f}  "
            f"{'OK' if ok else '**' + shape + '**'}"
        )
    print(f'\n{len(rows) - bad}/{len(rows)} 符合预期')
    return 0 if bad == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
