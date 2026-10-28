#!/usr/bin/env python
"""给 `shots/icons/scan` 里的朝向参数变体打分。

期望（按 MU 原版背包图标的观感）：
    0 / 8   单手/双手剑      tall   （刀身竖直，宽高比 0.3~0.85）
    64      弓              tall   （弓身竖直，宽高比 0.3~0.9）
    128     盾              square （0.75~1.5）
    160     头盔            square （0.6~1.6）

判分：每个 type 算出「宽/高」离目标区间的距离，加总；再对填充率过低的
（< 0.08，说明看到的是薄边而不是正面）加罚分。总分越低越好。
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCAN = os.path.join(ROOT, 'shots', 'icons', 'scan')

# type -> (最低宽高比, 最高宽高比)   —— 0.97 每 32 一组：0 剑 · 32 斧 · 128 弓
# · 160 杖 · 192 盾 · 224 头盔 · 256 铠甲
WANT = {
    0: (0.22, 0.70),    # 波刃剑（细长）
    8: (0.22, 0.70),    # 巨蛇魔剑
    32: (0.40, 0.95),   # 短斧
    128: (0.28, 0.80),  # 短弓
    160: (0.20, 0.65),  # 骷髅杖
    192: (0.78, 1.35),  # 圆盾
    224: (0.78, 1.40),  # 青铜盔
    256: (0.78, 1.45),  # 青铜铠
}


def bbox_ratio(path):
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
    return bw / max(1, bh), total / max(1, bw * bh), (bw, bh)


def main():
    index = os.path.join(SCAN, 'index.json')
    if not os.path.exists(index):
        print('先跑 node tools/icon-variant-scan.mjs')
        return 1
    rows = json.load(open(index))

    by_tag = {}
    for r in rows:
        path = os.path.join(SCAN, f"{r['tag']}_{r['type']}.png")
        a = bbox_ratio(path)
        if not a:
            continue
        ratio, fill, dim = a
        lo, hi = WANT.get(r['type'], (0.5, 2.0))
        # 偏离目标区间的距离
        if ratio < lo:
            bad = (lo - ratio) / lo
        elif ratio > hi:
            bad = (ratio - hi) / hi
        else:
            bad = 0.0
        # 填充率太低 = 看到的是薄边
        if fill < 0.08:
            bad += 0.5
        rec = by_tag.setdefault(r['tag'], {'order': r['order'], 'yUp': r['yUp'], 'noConj': r['noConj'], 'score': 0.0, 'ratios': {}})
        rec['score'] += bad
        rec['ratios'][r['type']] = round(ratio, 2)

    ranked = sorted(by_tag.values(), key=lambda x: x['score'])
    print(f"{'变体':<26} {'总分':>6}  各类型宽高比（0/8/32/128/160/192/224/256）")
    for rec in ranked[:8]:
        ratios = ' '.join(str(rec['ratios'].get(t, '-')) for t in (0, 8, 32, 128, 160, 192, 224, 256))
        print(
            f"{rec['order'] + ' ' + ('yup' if rec['yUp'] else 'none') + ' ' + ('noconj' if rec['noConj'] else 'conj'):<26} "
            f"{rec['score']:6.2f}  {ratios}"
        )
    print()
    best = ranked[0]
    print(f"最优：order={best['order']} yUp={best['yUp']} noConj={best['noConj']}  score={best['score']:.2f}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
