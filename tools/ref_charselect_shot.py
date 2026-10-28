"""启动原版客户端、自动登录到选角界面并截图（只在本机手动跑）。

    python tools/ref_charselect_shot.py [账号] [密码]

流程：起 main.exe → 等窗口 → 置前 → 键盘输入 账号 Tab 密码 Enter →
等角色列表 → 截窗口。窗口句柄按 PID 枚举，避免抓到别的窗口。
"""

import ctypes
import struct
import subprocess
import sys
import time
from ctypes import wintypes

from PIL import ImageGrab

CLIENT = r"D:\Project\H5_mu\MU-097k-Client-Win32"
OUT = r"D:\Project\H5_mu\mu-three\shots\ref-charselect-win32.png"
ACCOUNT = sys.argv[1] if len(sys.argv) > 1 else "1234"
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else "1234"

user32 = ctypes.windll.user32
user32.SetProcessDPIAware()
KEYEVENTF_KEYUP = 0x0002


class RECT(ctypes.Structure):
    _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG), ("right", wintypes.LONG), ("bottom", wintypes.LONG)]


def find_plaque(img):
    """在服务器列表那个区域找浅色的小銘牌，返回窗口内坐标。"""
    w, h = img.size
    xs, ys = [], []
    for y in range(int(h * 0.35), int(h * 0.65), 2):
        for x in range(int(w * 0.2), int(w * 0.8), 2):
            r_, g_, b_ = img.getpixel((x, y))[:3]
            if 150 <= r_ <= 215 and 150 <= g_ <= 215 and 150 <= b_ <= 215:
                xs.append(x)
                ys.append(y)
    if len(xs) < 200:
        return None
    return (min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2


def windows_of(pid):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        p = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid and user32.IsWindowVisible(hwnd):
            r = RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(r))
            if r.right - r.left > 200 and r.bottom - r.top > 200:
                found.append(hwnd)
        return True

    user32.EnumWindows(cb, 0)
    return found


def tap(vk, shift=False):
    if shift:
        user32.keybd_event(0x10, 0, 0, 0)
    user32.keybd_event(vk, 0, 0, 0)
    time.sleep(0.02)
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
    if shift:
        user32.keybd_event(0x10, 0, KEYEVENTF_KEYUP, 0)
    time.sleep(0.05)


VK = {c: 0x30 + int(c) for c in "0123456789"}
VK["TAB"] = 0x09
VK["ENTER"] = 0x0D


def click_at(hwnd, rx, ry):
    """在窗口内相对坐标点一下（游戏用的是自己的鼠标状态机，走系统鼠标事件）。"""
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    x, y = r.left + rx, r.top + ry
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.15)
    user32.mouse_event(0x0002, 0, 0, 0, 0)   # LEFTDOWN
    time.sleep(0.08)
    user32.mouse_event(0x0004, 0, 0, 0, 0)   # LEFTUP
    time.sleep(0.15)


def type_text(s):
    for ch in s:
        tap(VK[ch])


def main():
    proc = subprocess.Popen([CLIENT + r"\\main.exe"], cwd=CLIENT)
    print(f"pid={proc.pid}")
    hwnd = 0
    for _ in range(60):
        time.sleep(0.5)
        ws = windows_of(proc.pid)
        if ws:
            hwnd = ws[0]
            break
    if not hwnd:
        print("没找到窗口")
        proc.kill()
        return
    user32.SetForegroundWindow(hwnd)
    time.sleep(1.2)

    # 账号框默认有焦点：账号 → Tab → 密码 → Enter
    type_text(ACCOUNT)
    tap(VK["TAB"])
    type_text(PASSWORD)
    tap(VK["ENTER"])

    # 登录后先是「服务器列表」（ConnectServer 模式），回车选第一个服
    time.sleep(7)
    user32.SetForegroundWindow(hwnd)
    # 先在截图里找「Server 1」那块浅色銘牌，再按它的实际位置点一下
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    probe = ImageGrab.grab(bbox=(r.left, r.top, r.right, r.bottom))
    hit = find_plaque(probe)
    print("Server 銘牌位置:", hit)
    if hit:
        cx, cy = hit
        click_at(hwnd, cx, cy)
        time.sleep(0.8)
        click_at(hwnd, cx, cy)
    else:
        tap(VK["ENTER"])
    time.sleep(10)  # 等角色列表
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.5)
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    print(f"窗口 {r.left},{r.top} {r.right - r.left}×{r.bottom - r.top}")
    ImageGrab.grab(bbox=(r.left, r.top, r.right, r.bottom)).save(OUT)
    print("已保存", OUT)
    proc.kill()


main()
