#!/usr/bin/env python3
"""Build the chat-two-columns design fragment from real hold-net-rl turns.

Data: /tmp/turns20.json — [{"turn", "user", "chars", "steps", "tool", "clock", "text"}]
produced by the session extractor (prose-cleaned assistant text, truncated).

Variant 1 (Two lanes): pinned 30% left rail of my requests + one scrolling
right pane, click-to-jump and scroll-spy.
"""
import html
import json
import pathlib
import re
import sys

DATA_PATH = pathlib.Path("/tmp/turns20.json")
GUTTER_BUDGET = 420


def load_data():
    if DATA_PATH.exists():
        return json.loads(DATA_PATH.read_text())
    return [
        {"turn": 2, "user": "给我讲一下现在的 switch-net-rl", "chars": 286607,
         "steps": 4, "tool": "exec_command · rg switch-net-rl", "clock": "10-27 01:04",
         "text": "（缺少 /tmp/turns20.json）"},
    ]


def wan(chars):
    return f"{chars/10000:.1f} 万字" if chars >= 10000 else f"{chars:,} 字"


def esc(t):
    t = html.escape(t)
    t = re.sub(r"\*\*([^*\n]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", t)
    return t


def tabs_html(rows):
    out = []
    for r in rows:
        out.append(
            f"""        <button type="button" class="t" data-turn="{r['turn']}" role="tab" aria-selected="false">
          <span class="tno">{r['turn']}</span>
          <span class="ttx">{esc(r['user'])}</span>
          <span class="tmeta">{len(r['user'])} 字 · {r['clock'][-5:]}</span>
        </button>"""
        )
    return "\n".join(out)


def pane_html(rows):
    out = []
    for r in rows:
        steps = f" · {r['steps']} 步" if r["steps"] else ""
        out.append(
            f"""        <section class="turn" data-turn="{r['turn']}">
          <div class="turn-hd"><span>第 {r['turn']} 轮 · {wan(r['chars'])}{steps}</span><span>{r['clock']}</span></div>
          <div class="txt">{esc(r['text'])}</div>
        </section>"""
        )
    return "\n".join(out)


def gutter_html(rows):
    out = []
    for r in rows:
        body = r["text"][:GUTTER_BUDGET]
        cut = len(r["text"]) > GUTTER_BUDGET
        note = (f'<div class="cut">已显示 {len(body):,} 字 · 本回合共 {r["chars"]:,} 字</div>'
                if cut else "")
        out.append(
            f"""          <div class="u">
            <span class="ti">{r['turn']}</span>
            <p>{esc(r['user'])}</p>
          </div>
          <div class="a">
            <div class="txt">{esc(body)}</div>
            <div class="steps"><span class="st">{wan(r['chars'])}</span></div>
            {note}
          </div>"""
        )
    return "\n".join(out)


def collapse_html(rows):
    out = []
    for r in rows:
        out.append(f'          <div class="u"><span class="ti">{r["turn"]}</span><p>{esc(r["user"])}</p></div>')
        out.append(
            f'          <div class="fold"><span class="chev" aria-hidden="true"></span>'
            f"模型回复 · {wan(r['chars'])}" + (f" · {r['steps']} 步" if r["steps"] else "") + "</div>"
        )
    return "\n".join(out)


def main():
    out_path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "chat-two-columns.html")
    rows = load_data()
    total_user = sum(len(r["user"]) for r in rows)
    total_ai = sum(r["chars"] for r in rows)

    tpl = pathlib.Path(__file__).with_name("fragment.tpl.html").read_text()
    out_path.write_text(
        tpl.replace("@@TABS@@", tabs_html(rows))
        .replace("@@PANE@@", pane_html(rows))
        .replace("@@GUTTER@@", gutter_html(rows))
        .replace("@@COLLAPSE@@", collapse_html(rows))
        .replace("@@TOTAL_USER@@", str(total_user))
        .replace("@@TOTAL_AI@@", wan(total_ai))
        .replace("@@USER_COUNT@@", str(len(rows)))
    )
    print(f"wrote {out_path} ({out_path.stat().st_size} bytes, {len(rows)} turns)")


if __name__ == "__main__":
    main()
