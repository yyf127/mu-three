"""启动 Win32 原版客户端，截它的登录界面当参照图（只在需要时手动跑）。

    python tools/ref-login-shot.py [等待秒数]

用 ctypes 取窗口矩形，`PIL.ImageGrab` 只抓窗口那一块，不会把桌面其它内容带进来。
"""

import ctypes
import subprocess
import sys
import time
from ctypes import wintypes

from PIL import ImageGrab

CLIENT = r"D:\Project\H5_mu\MU-097k-Client-Win32"
OUT = r"D:\Project\H5_mu\mu-three\shots\ref-login-win32.png"
WAIT = float(sys.argv[1]) if len(sys.argv) > 1 else 12.0

user32 = ctypes.windll.user32
user32.SetProcessDPIAware()


class RECT(ctypes.Structure):
    _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG), ("right", wintypes.LONG), ("bottom", wintypes.LONG)]


def window_rect(hwnd):
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def main():
    proc = subprocess.Popen([CLIENT + r"\\main.exe"], cwd=CLIENT)
    print(f"pid={proc.pid} 等 {WAIT}s…")
    hwnd = 0
    deadline = time.time() + WAIT
    while time.time() < deadline:
        time.sleep(0.5)
        hwnd = user32.FindWindowW(None, "MU Online") or hwnd
    if not hwnd:
        # 标题不确定时，退一步按进程枚举
        hwnd = user32.GetForegroundWindow()
    print(f"hwnd={hwnd} 标题={ctypes.create_unicode_buffer(256).value}")
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.8)
    l, t, r, b = window_rect(hwnd)
    print(f"窗口 {l},{t} {r - l}×{b - t}")
    if r - l < 100 or b - t < 100:
        print("窗口矩形不可信，抓整屏兜底")
        l, t, r, b = 0, 0, *[int(v) for v in (user32.GetSystemMetrics(0), user32.GetSystemMetrics(1))]
    img = ImageGrab.grab(bbox=(l, t, r, b))
    img.save(OUT)
    print("已保存", OUT, img.size)
    proc.kill()


main()
