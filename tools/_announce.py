#!/usr/bin/env python3
"""Folio 公告发布器（Windows 桌面小工具，只用标准库）。

它只做三件事：
  1. 编辑 site/notice.json：标题、正文、日期、链接、过期时间、级别；
  2. 保存前按双端客户端的规则校验（electron/update.js 与 UpdateCenter.kt 都认这一份字段）；
  3. 一键 git add / commit / push，让 GitHub Pages 上的 notice.json 生效。

用法：
    python tools/_announce.py           # 打开窗口（也可以双击 tools/announce.bat）
    python tools/_announce.py --check   # 不开窗口，只校验当前 notice.json

注意：公告是「数据」不是指令，正文里写什么都只当文本渲染，不会被执行。
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
import urllib.request
from datetime import date
from pathlib import Path
import tkinter as tk
from tkinter import messagebox

REPO_ROOT = Path(__file__).resolve().parent.parent
NOTICE_PATH = REPO_ROOT / "site" / "notice.json"
ONLINE_URL = "https://flulwh.github.io/folio/notice.json"
MAX_NOTICES = 10
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FIELDS = ("id", "date", "level", "title", "body", "url", "expiresAt")


def today_text() -> str:
    return date.today().isoformat()


def load_notices(path: Path = NOTICE_PATH) -> tuple[str, list[dict]]:
    """读 notice.json。文件不存在或损坏时返回空列表，不打断工具启动。"""
    if not path.exists():
        return today_text(), []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return today_text(), []
    items = raw.get("notices") if isinstance(raw, dict) else None
    notices = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    updated = raw.get("updatedAt") if isinstance(raw.get("updatedAt"), str) else today_text()
    return updated, notices


def normalize_notice(raw: dict) -> dict:
    """把一条公告收敛成客户端认识的形状，未识别的字段原样保留。"""
    item = dict(raw)
    item["id"] = str(item.get("id") or "").strip()
    item["title"] = str(item.get("title") or "").strip()
    item["body"] = str(item.get("body") or "").strip()
    item["date"] = str(item.get("date") or "").strip()
    item["level"] = str(item.get("level") or "info").strip()
    item["url"] = str(item.get("url") or "").strip()
    expires = str(item.get("expiresAt") or "").strip()
    if expires:
        item["expiresAt"] = expires
    else:
        item.pop("expiresAt", None)
    return item


def validate(notices: list[dict]) -> list[str]:
    """按客户端规则校验。返回错误文案列表，空列表表示可以发布。"""
    errors: list[str] = []
    if len(notices) > MAX_NOTICES:
        errors.append(f"公告最多 {MAX_NOTICES} 条，当前 {len(notices)} 条（客户端只取前 10 条）。")
    seen: set[str] = set()
    for index, raw in enumerate(notices, start=1):
        item = normalize_notice(raw)
        name = item["title"] or f"第 {index} 条"
        if not item["id"]:
            errors.append(f"{name}：缺少 id。")
        elif item["id"] in seen:
            errors.append(f"{name}：id 重复（{item['id']}）。")
        else:
            seen.add(item["id"])
        if not item["title"]:
            errors.append(f"第 {index} 条：标题不能为空。")
        if not DATE_RE.match(item["date"]):
            errors.append(f"{name}：日期要写成 YYYY-MM-DD。")
        if item["level"] not in ("info", "warn"):
            errors.append(f"{name}：级别只能是 info 或 warn。")
        if item["url"] and not item["url"].lower().startswith(("http://", "https://")):
            errors.append(f"{name}：链接必须以 http:// 或 https:// 开头。")
        expires = item.get("expiresAt", "")
        if expires and not DATE_RE.match(expires):
            errors.append(f"{name}：过期时间要写成 YYYY-MM-DD，留空表示不过期。")
    return errors


def dump_payload(notices: list[dict], updated_at: str | None = None) -> str:
    ordered = sorted(
        (normalize_notice(item) for item in notices),
        key=lambda item: (item["date"], item["id"]),
        reverse=True,
    )
    payload = {"updatedAt": updated_at or today_text(), "notices": ordered}
    # 客户端按 date 倒序展示，这里保持同样的顺序，diff 才不会一直来回抖。
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def save_notices(notices: list[dict], path: Path = NOTICE_PATH) -> list[str]:
    """校验并写盘；有错误时什么都不写。"""
    errors = validate(notices)
    if errors:
        return errors
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_payload(notices), encoding="utf-8")
    return []


def next_id(notices: list[dict], day: str) -> str:
    """同一天连续发公告时用 `日期-1`、`日期-2` 递增，避免撞号。"""
    used = {str(item.get("id") or "") for item in notices}
    index = 1
    while f"{day}-{index}" in used:
        index += 1
    return f"{day}-{index}"


def fetch_online(timeout: float = 6.0) -> tuple[bool, dict, str]:
    request = urllib.request.Request(ONLINE_URL, headers={"User-Agent": "Folio-Announce"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
        return True, json.loads(body), ""
    except Exception as err:  # 网络问题一律降级成一句人话
        return False, {}, str(err) or err.__class__.__name__


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(REPO_ROOT), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


# ---------------- 视觉 ----------------
# 与官网同一套暗色令牌：近黑底、米白字、砖红强调色，数字与 id 用等宽字。

BG = "#0b0d12"
PANEL = "#11151d"
PANEL_2 = "#181d28"
PANEL_SEL = "#1d2534"
LINE = "#252c39"
TEXT = "#f1ece2"
MUTED = "#a3abb9"
FAINT = "#727b8b"
ACCENT = "#e2542f"
ACCENT_SOFT = "#3a1a12"
OK = "#63b98a"
WARN = "#d9a441"

FONT = ("Microsoft YaHei UI", 10)
FONT_SM = ("Microsoft YaHei UI", 9)
FONT_BOLD = ("Microsoft YaHei UI", 10, "bold")
FONT_TITLE = ("Microsoft YaHei UI", 17, "bold")
FONT_MONO = ("Consolas", 9)


def make_entry(parent, var, mono: bool = False) -> tk.Entry:
    return tk.Entry(
        parent,
        textvariable=var,
        bd=0,
        relief="flat",
        bg=PANEL_2,
        fg=TEXT,
        insertbackground=TEXT,
        disabledbackground=PANEL_2,
        disabledforeground=FAINT,
        highlightthickness=1,
        highlightbackground=LINE,
        highlightcolor=ACCENT,
        font=FONT_MONO if mono else FONT,
        selectbackground=ACCENT,
        selectforeground="#fff6ee",
    )


def make_button(parent, text: str, command, kind: str = "ghost") -> tk.Button:
    palette = {
        "primary": (ACCENT, "#fff6ee", "#f06a43", ACCENT),
        "ghost": (PANEL_2, TEXT, "#212a3a", LINE),
        "text": (BG, MUTED, PANEL_2, BG),
        "danger": (PANEL_2, "#e0948a", "#2a1a17", LINE),
    }
    bg, fg, active_bg, border = palette.get(kind, palette["ghost"])
    return tk.Button(
        parent,
        text=text,
        command=command,
        bd=0,
        relief="flat",
        bg=bg,
        fg=fg,
        activebackground=active_bg,
        activeforeground=fg,
        disabledforeground=FAINT,
        font=FONT,
        padx=14,
        pady=7,
        cursor="hand2",
        highlightthickness=1,
        highlightbackground=border,
        highlightcolor=border,
    )


def apply_dark_titlebar(window: tk.Tk) -> None:
    """Win10 2004+ / Win11 的深色标题栏；调用失败就保持系统默认。"""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        hwnd = ctypes.windll.user32.GetParent(window.winfo_id())
        value = ctypes.c_int(1)
        for attribute in (20, 19):
            if ctypes.windll.dwmapi.DwmSetWindowAttribute(
                hwnd, attribute, ctypes.byref(value), ctypes.sizeof(value)
            ) == 0:
                break
    except Exception:
        pass


class NoticeList(tk.Frame):
    """深色公告列表：每行标题 + 日期，选中行左侧一条强调色。"""

    def __init__(self, master, on_pick) -> None:
        super().__init__(master, bg=PANEL)
        self.on_pick = on_pick
        self.canvas = tk.Canvas(self, bg=PANEL, highlightthickness=0, bd=0)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.inner = tk.Frame(self.canvas, bg=PANEL)
        self.window = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda _e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(self.window, width=e.width))
        self.canvas.bind("<Enter>", lambda _e: self.canvas.bind_all("<MouseWheel>", self._wheel))
        self.canvas.bind("<Leave>", lambda _e: self.canvas.unbind_all("<MouseWheel>"))

    def _wheel(self, event) -> None:
        self.canvas.yview_scroll(-1 if event.delta > 0 else 1, "units")

    def render(self, items: list[dict], selected: int | None = None) -> None:
        for child in self.inner.winfo_children():
            child.destroy()
        if not items:
            tk.Label(
                self.inner, text="还没有公告\n点左下角「新建」开始", bg=PANEL, fg=FAINT,
                font=FONT_SM, justify="center", pady=28,
            ).pack(fill="x")
            return
        for index, item in enumerate(items):
            active = index == selected
            bg = PANEL_SEL if active else PANEL
            row = tk.Frame(self.inner, bg=bg, cursor="hand2")
            row.pack(fill="x", padx=4, pady=2)
            tk.Frame(row, width=3, bg=ACCENT if active else bg).pack(side="left", fill="y")
            text = tk.Frame(row, bg=bg)
            text.pack(side="left", fill="x", expand=True, padx=10, pady=8)
            title = tk.Label(
                text, text=item.get("title") or "(未命名)", bg=bg,
                fg=TEXT if active else "#d6d9e0", font=FONT_BOLD if active else FONT,
                anchor="w", justify="left", wraplength=200,
            )
            title.pack(fill="x")
            meta = " · ".join(
                part for part in (str(item.get("date") or ""), str(item.get("level") or "info")) if part
            )
            tag = tk.Label(text, text=meta, bg=bg, fg=FAINT, font=FONT_SM, anchor="w")
            tag.pack(fill="x", pady=(3, 0))
            for widget in (row, text, title, tag):
                widget.bind("<Button-1>", lambda _e, i=index: self.on_pick(i))


class AnnounceApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Folio 公告发布器")
        self.geometry("940x720")
        self.minsize(860, 660)
        self.configure(bg=BG)

        self.items: list[dict] = []
        self.index: int | None = None
        self.busy = False
        self.action_buttons: list[tk.Button] = []

        self._build()
        self._load()
        self._refresh_list()
        if self.items:
            # 打开就载入第一条，右侧不是空的，少一次点击。
            self._show_item(0)
        self.bind("<Control-s>", lambda _e: self._save())
        self.bind("<Control-Return>", lambda _e: self._publish())
        self.after(120, apply_dark_titlebar, self)

    # ---------------- 布局 ----------------

    def _build(self) -> None:
        # 顶栏：字标 + 一句说明 + 右侧弱按钮
        header = tk.Frame(self, bg=BG)
        header.pack(fill="x", padx=24, pady=(20, 14))
        brand = tk.Frame(header, bg=BG)
        brand.pack(side="left", anchor="w")
        tk.Label(brand, text="公告发布器", bg=BG, fg=TEXT, font=FONT_TITLE).pack(anchor="w")
        tk.Label(
            brand, text="编辑 site/notice.json，保存后一键推到 GitHub Pages",
            bg=BG, fg=FAINT, font=FONT_SM,
        ).pack(anchor="w", pady=(3, 0))
        self.btn_open = make_button(header, "打开线上页面", self._open_page, "text")
        self.btn_open.pack(side="right")

        tk.Frame(self, bg=LINE, height=1).pack(fill="x", padx=24)

        # 状态栏先占住底部，避免被可伸缩的表单挤掉
        bar = tk.Frame(self, bg="#0e1219")
        bar.pack(fill="x", side="bottom")
        self.status_dot = tk.Canvas(bar, width=10, height=10, bg="#0e1219", highlightthickness=0)
        self.status_dot.pack(side="left", padx=(24, 8), pady=9)
        self.dot_id = self.status_dot.create_oval(2, 2, 8, 8, fill=FAINT, outline="")
        self.status = tk.StringVar(value=str(NOTICE_PATH))
        tk.Label(
            bar, textvariable=self.status, bg="#0e1219", fg=MUTED, font=FONT_SM, anchor="w",
        ).pack(side="left", fill="x", expand=True)

        body = tk.Frame(self, bg=BG)
        body.pack(fill="both", expand=True, padx=24, pady=18)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        # 左：公告列表
        side = tk.Frame(body, bg=PANEL, width=300,
                        highlightthickness=1, highlightbackground=LINE)
        side.grid(row=0, column=0, sticky="nsw", padx=(0, 18))
        side.grid_propagate(False)
        head = tk.Frame(side, bg=PANEL)
        head.pack(fill="x", padx=12, pady=(12, 8))
        tk.Label(head, text="公告", bg=PANEL, fg=TEXT, font=FONT_BOLD).pack(side="left")
        self.count_label = tk.Label(head, text="", bg=PANEL, fg=FAINT, font=FONT_SM)
        self.count_label.pack(side="right")
        self.notice_list = NoticeList(side, self._pick)
        self.notice_list.pack(fill="both", expand=True, padx=6)
        side_actions = tk.Frame(side, bg=PANEL)
        side_actions.pack(fill="x", padx=10, pady=10)
        make_button(side_actions, "新建", self._add).pack(side="left")
        make_button(side_actions, "删除", self._remove, "danger").pack(side="left", padx=6)

        # 右：表单
        form = tk.Frame(body, bg=BG)
        form.grid(row=0, column=1, sticky="nsew")
        form.columnconfigure(0, weight=1, uniform="col")
        form.columnconfigure(1, weight=1, uniform="col")

        self.var_id = tk.StringVar()
        self.var_date = tk.StringVar()
        self.var_level = tk.StringVar(value="info")
        self.var_title = tk.StringVar()
        self.var_url = tk.StringVar()
        self.var_expires = tk.StringVar()

        def label(text: str, row: int, col: int = 0, span: int = 1) -> None:
            tk.Label(form, text=text, bg=BG, fg=MUTED, font=FONT_SM).grid(
                row=row, column=col, columnspan=span, sticky="w", pady=(12 if row else 0, 4)
            )

        def place(widget, row: int, col: int = 0, span: int = 1) -> None:
            widget.grid(row=row, column=col, columnspan=span, sticky="ew", ipady=6, ipadx=2)

        label("标题", 0, span=2)
        self.title_entry = make_entry(form, self.var_title)
        place(self.title_entry, 1, span=2)

        label("日期", 2)
        label("级别", 2, col=1)
        place(make_entry(form, self.var_date), 3, col=0)
        level_box = tk.Frame(form, bg=BG)
        level_box.grid(row=3, column=1, sticky="w")
        self.level_buttons: dict[str, tk.Button] = {}
        for value, text in (("info", "普通"), ("warn", "醒目")):
            button = tk.Button(
                level_box, text=text, command=lambda v=value: self._set_level(v),
                bd=0, relief="flat", font=FONT, padx=16, pady=5, cursor="hand2",
                highlightthickness=1, highlightbackground=LINE, highlightcolor=LINE,
            )
            button.pack(side="left", padx=(0, 6))
            self.level_buttons[value] = button
        self._paint_level()

        label("链接", 4, span=2)
        place(make_entry(form, self.var_url), 5, span=2)

        label("过期", 6)
        label("id", 6, col=1)
        place(make_entry(form, self.var_expires, mono=True), 7, col=0)
        place(make_entry(form, self.var_id, mono=True), 7, col=1)

        label("正文", 8, span=2)
        text_wrap = tk.Frame(form, bg=LINE, highlightthickness=1, highlightbackground=LINE)
        text_wrap.grid(row=9, column=0, columnspan=2, sticky="nsew")
        form.rowconfigure(9, weight=1)
        self.body = tk.Text(
            text_wrap, height=6, wrap="word", font=FONT, bd=0, relief="flat",
            bg=PANEL_2, fg=TEXT, insertbackground=TEXT, selectbackground=ACCENT,
            selectforeground="#fff6ee", padx=10, pady=8, spacing2=3, highlightthickness=0,
        )
        self.body.pack(fill="both", expand=True)
        self.body.bind("<KeyRelease>", lambda _e: self._update_count())

        self.char_label = tk.Label(form, text="0 字", bg=BG, fg=FAINT, font=FONT_SM)
        self.char_label.grid(row=10, column=0, columnspan=2, sticky="w", pady=(4, 0))

        actions = tk.Frame(form, bg=BG)
        actions.grid(row=11, column=0, columnspan=2, sticky="ew", pady=(16, 0))
        self.btn_publish = make_button(actions, "发布到线上", self._publish, "primary")
        self.btn_publish.pack(side="left")
        self.btn_save = make_button(actions, "保存文件", self._save)
        self.btn_save.pack(side="left", padx=8)
        self.btn_check = make_button(actions, "检查线上", self._check_online, "text")
        self.btn_check.pack(side="left")
        self.action_buttons = [self.btn_publish, self.btn_save, self.btn_check, self.btn_open]

        tk.Label(
            form,
            text="链接可留空；过期后自动隐藏；id 改了用户会重新收到公告。",
            bg=BG, fg=FAINT, font=FONT_SM,
        ).grid(row=12, column=0, columnspan=2, sticky="w", pady=(10, 0))

    # ---------------- 数据 ----------------

    def _load(self) -> None:
        _, self.items = load_notices()

    def _refresh_list(self) -> None:
        self.notice_list.render(self.items, self.index)
        self.count_label.configure(text=f"{len(self.items)} / {MAX_NOTICES}")

    def _push_form(self) -> None:
        """把表单写回内存里的当前条目（不写盘）。"""
        if self.index is None or not (0 <= self.index < len(self.items)):
            return
        item = self.items[self.index]
        item["id"] = self.var_id.get().strip()
        item["date"] = self.var_date.get().strip()
        item["level"] = self.var_level.get().strip() or "info"
        item["title"] = self.var_title.get().strip()
        item["url"] = self.var_url.get().strip()
        body = self.body.get("1.0", "end-1c").strip()
        item["body"] = body
        expires = self.var_expires.get().strip()
        if expires:
            item["expiresAt"] = expires
        else:
            item.pop("expiresAt", None)

    def _pull_form(self) -> None:
        self.index = None
        self.var_id.set("")
        self.var_date.set("")
        self.var_level.set("info")
        self.var_title.set("")
        self.var_url.set("")
        self.var_expires.set("")
        self.body.delete("1.0", tk.END)
        if hasattr(self, "level_buttons"):
            self._paint_level()
        if hasattr(self, "char_label"):
            self._update_count()

    def _show_item(self, index: int) -> None:
        item = self.items[index]
        self.index = index
        self.var_id.set(str(item.get("id") or ""))
        self.var_date.set(str(item.get("date") or ""))
        self.var_level.set(str(item.get("level") or "info"))
        self.var_title.set(str(item.get("title") or ""))
        self.var_url.set(str(item.get("url") or ""))
        self.var_expires.set(str(item.get("expiresAt") or ""))
        self.body.delete("1.0", tk.END)
        self.body.insert("1.0", str(item.get("body") or ""))
        self._paint_level()
        self._update_count()
        self.notice_list.render(self.items, index)

    def _pick(self, index: int) -> None:
        """点列表里的某一条：先把表单写回上一条，再载入新的。"""
        if index == self.index:
            return
        self._push_form()
        self._refresh_list()
        self._show_item(index)

    def _set_level(self, value: str) -> None:
        self.var_level.set(value)
        self._paint_level()

    def _paint_level(self) -> None:
        for value, button in self.level_buttons.items():
            active = self.var_level.get() == value
            if value == "warn":
                on_bg, on_fg = "#3a2a10", WARN
            else:
                on_bg, on_fg = ACCENT_SOFT, "#f2a48c"
            button.configure(
                bg=on_bg if active else PANEL_2,
                fg=on_fg if active else FAINT,
                activebackground=on_bg if active else PANEL_2,
                activeforeground=on_fg if active else FAINT,
            )

    def _update_count(self) -> None:
        length = len(self.body.get("1.0", "end-1c"))
        self.char_label.configure(text=f"{length} 字")

    def _add(self) -> None:
        self._push_form()
        day = today_text()
        item = {
            "id": next_id(self.items, day),
            "date": day,
            "level": "info",
            "title": "",
            "body": "",
            "url": "",
        }
        self.items.insert(0, item)
        self._refresh_list()
        self._show_item(0)
        self.title_entry.focus_set()

    def _remove(self) -> None:
        if self.index is None or not (0 <= self.index < len(self.items)):
            return
        title = self.items[self.index].get("title") or "这条公告"
        if not messagebox.askyesno("删除公告", f"确定删除「{title}」？保存并发布后线上才会消失。"):
            return
        del self.items[self.index]
        self.index = None
        self._pull_form()
        self._refresh_list()
        self._set_busy(False, "已删除一条公告，记得保存并发布。")

    # ---------------- 动作 ----------------

    def _save(self) -> str | None:
        self._push_form()
        errors = save_notices(self.items)
        if errors:
            messagebox.showerror("还不能保存", "\n".join(errors[:8]))
            return None
        self._set_busy(False, f"已写入 {NOTICE_PATH}")
        return NOTICE_PATH.read_text(encoding="utf-8")

    def _publish(self) -> None:
        if self.busy:
            return
        if self._save() is None:
            return
        if not messagebox.askyesno("发布到线上", "将提交并推送到 GitHub，页面 1–2 分钟后生效。继续？"):
            return
        title = next((item.get("title") for item in self.items if item.get("title")), "公告更新")
        self._set_busy(True, "正在提交并推送…")

        def worker() -> None:
            add = git("add", "site/notice.json")
            if add.returncode != 0:
                self.after(0, lambda: self._fail("git add 失败", add))
                return
            # add 之后再判断暂存区是否有变化，否则永远显示「没有变化」。
            staged = git("diff", "--cached", "--quiet", "--", "site/notice.json")
            if staged.returncode == 0:
                self.after(0, lambda: self._set_busy(False, "文件没有变化，不需要推送。"))
                return
            # 只提交 notice.json：哪怕暂存区里还有别的文件，也不替用户一起提交。
            commit = git("commit", "-m", f"公告: {title}", "--", "site/notice.json")
            if commit.returncode != 0:
                self.after(0, lambda: self._fail("提交失败", commit))
                return
            push = git("push", "origin", "main")
            if push.returncode != 0:
                # 远端被别的提交推动了（最常见是 CI 机器人更新 README），
                # 把本地提交挪到远端之上再推一次；--autostash 保住用户没提交的改动。
                fetch = git("fetch", "origin", "main")
                if fetch.returncode != 0:
                    self.after(0, lambda: self._fail("推送失败（拉取远端也失败，提交已在本地）", fetch))
                    return
                rebase = git("rebase", "--autostash", "origin/main")
                if rebase.returncode != 0:
                    git("rebase", "--abort")
                    self.after(0, lambda: self._fail("推送失败（远端有新提交，自动合并失败，提交已在本地）", rebase))
                    return
                push = git("push", "origin", "main")
            if push.returncode != 0:
                self.after(0, lambda: self._fail("推送失败（提交已在本地）", push))
                return
            self.after(0, lambda: self._set_busy(
                False, "已推送。GitHub Pages 通常 1–2 分钟后生效，可点「检查线上」确认。"
            ))

        threading.Thread(target=worker, daemon=True).start()

    def _fail(self, title: str, result: subprocess.CompletedProcess) -> None:
        self._set_busy(False, f"{title}。")
        detail = (result.stderr or result.stdout or "").strip()
        messagebox.showerror(title, detail[-1200:] or "没有输出，可能是网络或权限问题。")

    def _check_online(self) -> None:
        if self.busy:
            return
        self._set_busy(True, "正在读取线上 notice.json…")

        def worker() -> None:
            ok, payload, error = fetch_online()
            if not ok:
                self.after(0, lambda: self._set_busy(False, f"读取失败：{error}"))
                return
            online = payload.get("notices") if isinstance(payload, dict) else []
            online_ids = {str(item.get("id")) for item in online if isinstance(item, dict)}
            local_ids = {str(item.get("id")) for item in self.items}
            missing = local_ids - online_ids
            extra = online_ids - local_ids
            if missing or extra:
                parts = []
                if missing:
                    parts.append(f"未上线 {len(missing)} 条")
                if extra:
                    parts.append(f"线上多 {len(extra)} 条")
                self.after(0, lambda: self._set_busy(False, "线上与本地不一致：" + "，".join(parts) + "。"))
            else:
                self.after(0, lambda: self._set_busy(False, "线上与本地一致，公告已生效。"))

        threading.Thread(target=worker, daemon=True).start()

    def _open_page(self) -> None:
        import webbrowser

        webbrowser.open(ONLINE_URL)

    def _set_busy(self, busy: bool, message: str) -> None:
        self.busy = busy
        self.status.set(message)
        if busy:
            color = ACCENT
        elif any(word in message for word in ("失败", "不一致")):
            color = WARN
        elif message.startswith(("已推送", "已写入", "线上与本地一致")):
            color = OK
        else:
            color = FAINT
        self.status_dot.itemconfigure(self.dot_id, fill=color)
        state = "disabled" if busy else "normal"
        for button in self.action_buttons:
            button.configure(state=state)


def check_cli() -> int:
    _, notices = load_notices()
    errors = validate(notices)
    if errors:
        print("notice.json 有 %d 处问题：" % len(errors))
        for item in errors:
            print(" -", item)
        return 1
    print(f"ok：{len(notices)} 条公告，字段与客户端规则一致。")
    return 0


def main() -> int:
    if "--check" in sys.argv[1:]:
        return check_cli()
    try:
        app = AnnounceApp()
    except tk.TclError as err:
        print(f"打不开图形界面：{err}", file=sys.stderr)
        return 1
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
