import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, defaultRows, ROW_H, ITEM_H, LIST_H, RAIL } from "./harness.js";

const railH = 388; // 500(容器底) - 100(顶) - 12
const activeId = (w) => { const el = w.activeTab(); return el && el.getAttribute("data-cln-id"); };
const listTop = RAIL.top + 8;

test("apply：注入样式、注册到 shell.overlay、装上诊断钩子", async () => {
  const w = await createWorld();
  await w.mount();

  assert.deepEqual(w.slots.injected, ["shell.overlay"]);
  assert.equal(w.slots.registered[0].desc.name, "shell.overlay");
  assert.equal(w.slots.registered[0].desc.id, "chat-lanes");
  assert.equal(w.doc.querySelectorAll('style[data-plugin-css="dsh-chat-lanes"]').length, 1);
  assert.equal(typeof w.win.__CLN__.report, "function");

  // 注销 effect 应把样式节点收走
  w.effects[0]();
  assert.equal(w.doc.querySelectorAll('style[data-plugin-css="dsh-chat-lanes"]').length, 0);
});

test("apply：旧的同名样式先被清掉，最终只剩一份", async () => {
  const w = await createWorld({ extraStyle: true });
  await w.mount();
  assert.equal(w.doc.querySelectorAll('style[data-plugin-css="dsh-chat-lanes"]').length, 1);
});

test("apply：宿主没有 slots 服务时安静退出", async () => {
  const w = await createWorld({ getOverride: () => undefined });
  w.commonjs.apply(w.ctx);
  assert.deepEqual(w.slots.injected, []);
  assert.equal(typeof w.win.__CLN__.report, "function");
});

test("apply：宿主抛错时不再吞掉，直接冒泡", async () => {
  const w = await createWorld({
    getOverride: () => { throw new Error("no slots service"); }
  });
  assert.throws(() => w.commonjs.apply(w.ctx), /no slots service/);
});

test("左栏：每句我的话一条，带轮次标签，第一条默认选中", async () => {
  const w = await createWorld();
  await w.mount();

  const tabs = w.tabs();
  assert.equal(tabs.length, 12);
  assert.equal(tabs[0].textContent.includes("第 1 轮的问题"), true);
  assert.equal(tabs[0].textContent.includes("第 1 轮"), true);
  assert.equal(activeId(w), "chat-anchor-1");
  assert.equal(w.doc.querySelector(".cln-n").textContent, "12 条");
});

test("左栏：容器宽度决定栏宽（下限 196、上限 288）", async () => {
  const narrow = await createWorld({ scopeW: 600 });
  await narrow.mount();
  assert.equal(narrow.scope.style.getPropertyValue("--cln-rail"), "196px");
  assert.equal(narrow.rail().style.width, "184px");

  const wide = await createWorld({ scopeW: 2000 });
  await wide.mount();
  assert.equal(wide.scope.style.getPropertyValue("--cln-rail"), "288px");
  assert.equal(wide.rail().style.width, "276px");
});

test("左栏：底边让开输入框，并且不越出窗口", async () => {
  const withComposer = await createWorld({ composerTop: 460 });
  await withComposer.mount();
  assert.equal(withComposer.rail().style.height, 460 - 6 - 100 - 12 + "px");

  const shortWindow = await createWorld();
  shortWindow.win.innerHeight = 300;
  await shortWindow.mount();
  assert.equal(shortWindow.rail().style.height, "178px");
});

test("左栏：每次布局算出的盒子一样时不再重渲染", async () => {
  const w = await createWorld();
  await w.mount();
  const before = w.rail();
  await w.flush(() => w.tick());
  assert.equal(w.rail(), before); // 同一个 DOM 节点 = 没有重渲染
});

test("扫描：跳过非我的话、空消息、超长消息，缺 anchor 时用序号兜底", async () => {
  const w = await createWorld({
    rows: [
      { kind: "user", text: "  ", turn: "1" },                      // 空白：跳过
      { kind: "assistant-step", text: "回复一" },
      { kind: "user", text: "x".repeat(2001), turn: "2" },          // 超长：跳过
      { kind: "assistant-step", text: "回复二" },
      { kind: "user", text: "y".repeat(700), turn: null },          // 无 turn 外壳 + 长文本
      { kind: "assistant-step", text: "回复三" },
      { kind: "user", text: "短句", anchor: "anchor-x", turn: "4" },
      { kind: "tool-call", text: "exec" },
      { kind: "assistant-step", text: "回复四" },
      { kind: "user", text: "最后一句没有回复" }                     // 没有后续内容行
    ]
  });
  await w.mount();

  const tabs = w.tabs();
  assert.equal(tabs.length, 3);
  // 第 5 行没有 turn 外壳 → 不写"第 N 轮"
  assert.equal(tabs[0].textContent.includes("第 "), false);
  assert.equal(tabs[0].querySelector(".cln-x").textContent.length, 201); // 700 字截到 200 + …
  assert.equal(tabs[0].getAttribute("title").length, 601);               // title 里 600 + …
  assert.equal(tabs[1].getAttribute("data-cln-id"), "anchor-x");
  // 最后一条我的话没有回复可指，只标记自己
  assert.equal(tabs[2].getAttribute("data-cln-id"), "cln-9");
  assert.equal(w.rows[9].hasAttribute("data-cln-start"), false);
});

test("扫描：我给的话超过 48 字时轮次标签也截断", async () => {
  const w = await createWorld({
    rows: [
      { kind: "user", text: "z".repeat(60), turn: "7" },
      { kind: "assistant-step", text: "回复" }
    ]
  });
  await w.mount();
  const label = w.rows[1].getAttribute("data-cln-label");
  assert.equal(label.startsWith("第 7 轮 · "), true);
  assert.equal(label.endsWith("…"), true);
});

test("每轮回复的起点被打上分隔标记，重扫时旧的标记会被清掉", async () => {
  const w = await createWorld();
  await w.mount();
  assert.equal(w.rows[1].getAttribute("data-cln-start"), "");
  assert.equal(w.rows[1].getAttribute("data-cln-label").startsWith("第 1 轮 · "), true);

  // 删掉一半消息后重扫，旧标记不该残留
  w.rows[1].setAttribute("data-chat-flow-kind", "assistant-step");
  w.rows[0].remove();
  w.rows[2].remove();
  await w.flush(() => { w.win.__CLN__.report(); w.dispatchScroll(); });
  assert.equal(w.rows[3].hasAttribute("data-cln-start"), true);
});

test("点击某一条：右侧滚到它对应的回复，并把该条点亮", async () => {
  const w = await createWorld();
  await w.mount();
  const tabs = w.tabs();
  await w.click(tabs[3]);
  // 第 4 轮的目标行绝对位置 = (2*3+1)*40 = 280，留 12px 余量
  assert.equal(w.getScroll(), 280 - 12);
  assert.equal(activeId(w), "chat-anchor-4");
});

test("滚到底：直接认最后一条（流式输出贴着底也成立）", async () => {
  const w = await createWorld();
  await w.mount();
  const max = 24 * ROW_H - 400;
  await w.flush(() => { w.setScroll(max); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-12");
});

test("往下滚：上一条还没整条离开视口，就不交棒", async () => {
  const w = await createWorld();
  await w.mount();
  assert.equal(activeId(w), "chat-anchor-1", "刚进来先点亮第一条");

  // 第 2 轮的回复开头（120）还在视口里往下 20px 处 —— 不切
  await w.flush(() => { w.setScroll(100); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-1");

  // 滚到 200：第 2、3 轮的开头都越过上沿了，第 4 轮的还在下面 80px 处
  await w.flush(() => { w.setScroll(200); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-3");
});

test("向上滚：当前轮的回复开头还在上半屏时，先不切走", async () => {
  const w = await createWorld();
  await w.mount();
  await w.flush(() => { w.setScroll(300); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-4");

  // 往上滚：阅读线已经落进上一轮，但第 4 轮的回复开头（280）还在视口 180px 处
  await w.flush(() => { w.setScroll(100); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-4");
});

test("向上滚：当前轮的回复开头掉到下半屏之后，才切给上一条", async () => {
  const w = await createWorld();
  await w.mount();
  await w.flush(() => { w.setScroll(300); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-4");

  // 再往上：第 4 轮的回复开头到了视口 220px 处（下半屏），此时才切给第 3 轮
  // （第 3 轮的回复开头在 140px 处，还在上半屏，于是停在那儿）
  await w.flush(() => { w.setScroll(60); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-3");
});

test("向上滚：宿主换掉当前那一行时不会崩，高亮仍然落在有效条目上", async () => {
  const w = await createWorld();
  await w.mount();
  await w.flush(() => { w.setScroll(300); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-4");

  // 摘掉第 4 轮"我的话"那行：中间那一帧激活项指向已消失的条目
  w.doc.querySelectorAll("[data-chat-flow-kind]")[6].remove();
  await new Promise((r) => setTimeout(r, 0));
  w.runTimeout();
  await w.flush();
  await w.flush(() => { w.setScroll(100); w.dispatchScroll(); });

  const ids = w.tabs().map((t) => t.getAttribute("data-cln-id"));
  assert.ok(ids.includes(activeId(w)), "高亮必须落在真实存在的条目上");
  assert.ok(!ids.includes("chat-anchor-4"), "被摘掉的那条不该再出现");
});

test("跟随：宿主把消息行全清掉时不会崩（没有可跟随的目标）", async () => {
  const w = await createWorld();
  await w.mount();
  await w.flush(() => { w.tabs()[3].dispatchEvent(new w.win.MouseEvent("click", { bubbles: true })); });
  assert.equal(activeId(w), "chat-anchor-4");

  // 一条消息都不剩：重扫后列表空掉，激活项还指着已经不存在的条目
  w.doc.querySelectorAll("[data-chat-flow-kind]").forEach((row) => row.remove());
  await new Promise((r) => setTimeout(r, 0));
  w.runTimeout();
  await w.flush();
  assert.equal(w.tabs().length, 0);
});

test("换页：对话容器消失时左栏跟着消失（切到插件/定时任务这类内置页）", async () => {
  const w = await createWorld();
  await w.mount();
  assert.equal(w.tabs().length, 12);

  // 内置页没有对话容器：把滚动容器整个摘掉，再跑一次心跳
  w.doc.querySelector("[data-conversation-scroll]").remove();
  w.tick();
  await w.flush();
  assert.equal(w.tabs().length, 0, "容器没了，左栏不该还挂在屏幕上");
});

test("换页：容器被换成另一个节点时，左栏重新接到新容器上", async () => {
  const w = await createWorld();
  await w.mount();
  const oldScope = w.doc.querySelector("[data-conversation-scroll]");
  assert.equal(w.tabs().length, 12);

  // 模拟切到另一个会话：容器换成新节点，内容仍是这一套行
  const next = oldScope.cloneNode(true);
  next.removeAttribute("data-chat-lanes");
  oldScope.replaceWith(next);
  w.reattach(next);
  w.tick(250);   // 只跑那颗轻心跳：它自己发现容器换了，立刻重建
  await w.flush();
  assert.equal(w.tabs().length, 12);
  assert.ok(next.hasAttribute("data-chat-lanes"), "新容器要被接上");
  assert.ok(!oldScope.isConnected);
});

test("卸载之后残留的心跳不会再动 DOM", async () => {
  const w = await createWorld();
  await w.mount();
  await w.unmount();
  const scope = w.doc.querySelector("[data-conversation-scroll]");
  w.forceTick();
  assert.ok(!scope.hasAttribute("data-chat-lanes"), "已经卸载了，不该再把左栏接回去");
});

test("换页：对话容器只是被藏起来（尺寸归零）时也不显示左栏", async () => {
  const w = await createWorld({ scopeW: 0 });
  await w.mount();
  assert.equal(w.tabs().length, 0);
});

test("行头：默认收起，点开是完整原句，再点收起", async () => {
  const w = await createWorld();
  await w.mount();
  const head = w.doc.querySelectorAll(".cln-rhead");
  assert.equal(head.length, 12, "每条回复起点一枚行头");
  const bar = head[0].querySelector(".cln-rh");
  const toggle = head[0].querySelector(".cln-rb");
  const panel = head[0].querySelector(".cln-rf");
  assert.equal(head[0].querySelector(".cln-rl").textContent, "第 1 轮 · 第 1 轮的问题");
  assert.equal(toggle.textContent, "展开");
  assert.equal(panel.hidden, true);

  bar.click();
  assert.equal(panel.hidden, false, "点一下展开");
  assert.equal(toggle.textContent, "收起");
  assert.equal(panel.querySelector(".cln-rt").textContent, "第 1 轮的问题");

  bar.click();
  assert.equal(panel.hidden, true, "再点收起");
  assert.equal(toggle.textContent, "展开");
});

test("行头：展开之后重扫不会把它收起来", async () => {
  const w = await createWorld();
  await w.mount();

  const head = w.doc.querySelector(".cln-rhead");
  const bar = head.querySelector(".cln-rh");
  const panel = head.querySelector(".cln-rf");
  bar.click();
  assert.equal(panel.hidden, false);

  // 点开时我们自己改了按钮文案，会招来一次重扫；宿主更新流式内容时也会
  w.rows[3].firstElementChild.textContent = "第 2 轮的回复又长了一点";
  await new Promise((r) => setTimeout(r, 0));
  w.runTimeout();
  await w.flush();

  assert.equal(panel.isConnected, true, "行头节点要原样留着");
  assert.equal(w.doc.querySelector(".cln-rhead"), head);
  assert.equal(panel.hidden, false, "展开状态不该被重扫收掉");
  assert.equal(head.querySelector(".cln-rb").textContent, "收起");
});

test("行头：点复制把这段用户原话写进剪贴板", async () => {
  const w = await createWorld();
  await w.mount();
  const written = [];
  Object.defineProperty(w.win.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t) => written.push(t) }
  });
  const copy = w.doc.querySelector(".cln-rhead .cln-rc");
  copy.click();
  assert.equal(written.length, 1);
  assert.equal(written[0], "第 1 轮的问题");
  assert.equal(copy.title, "已复制", "图标变成已复制的样子");
  assert.ok(copy.classList.contains("ok"));
  delete w.win.navigator.clipboard;
});

test("行头：没有剪贴板时点复制不炸", async () => {
  const w = await createWorld();
  await w.mount();
  const copy = w.doc.querySelector(".cln-rhead .cln-rc");
  delete w.win.navigator.clipboard;
  copy.click();
  assert.ok(copy.classList.contains("ok"), "按钮给个反馈，但不去碰 clipboard");
});

test("行头：点面板之外的地方就收起来", async () => {
  const w = await createWorld();
  await w.mount();
  const head = w.doc.querySelector(".cln-rhead");
  head.querySelector(".cln-rh").click();
  assert.equal(head.querySelector(".cln-rf").hidden, false);

  w.doc.querySelector(".cln-rail").click();
  assert.equal(head.querySelector(".cln-rf").hidden, true, "点了左栏也算点外面");
  assert.equal(head.querySelector(".cln-rb").textContent, "展开");
  assert.ok(!head.querySelector(".cln-rc").classList.contains("ok"), "收起来时把复制的反馈清掉");
});

test("行头：点面板里面不会收起来", async () => {
  const w = await createWorld();
  await w.mount();
  const head = w.doc.querySelector(".cln-rhead");
  head.querySelector(".cln-rh").click();
  head.querySelector(".cln-rt").click();
  assert.equal(head.querySelector(".cln-rf").hidden, false);
});

test("行头：开另一轮的行头时，前一个自动收起", async () => {
  const w = await createWorld();
  await w.mount();
  const heads = w.doc.querySelectorAll(".cln-rhead");
  heads[0].querySelector(".cln-rh").click();
  heads[1].querySelector(".cln-rh").click();
  assert.equal(heads[0].querySelector(".cln-rf").hidden, true);
  assert.equal(heads[1].querySelector(".cln-rf").hidden, false);
});

test("行头：没打开时点外面什么也不发生", async () => {
  const w = await createWorld();
  await w.mount();
  w.doc.querySelector(".cln-rail").click();
  const head = w.doc.querySelector(".cln-rhead");
  assert.equal(head.querySelector(".cln-rf").hidden, true);
});

test("跟随：激活项跑到可视区外时，左栏自己滚动把它带回来", async () => {
  const w = await createWorld();
  await w.mount();
  const list = w.doc.querySelector(".cln-list");

  await w.flush(() => { w.setScroll(24 * ROW_H - 400); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-12");
  const bottomScroll = list.scrollTop;
  assert.ok(bottomScroll > 0, "到底时应把最后一条滚进视野");

  // 再往上翻：列表要跟着往回走（12 → 8，因为 12..9 的回复开头都还在上半屏以下）
  await w.flush(() => { w.setScroll(400); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-8");
  assert.ok(list.scrollTop < bottomScroll, "高亮往上走，列表也要跟着往回滚");
});

test("跟随：激活的那条已经不在 DOM 里时安静跳过", async () => {
  const w = await createWorld();
  await w.mount();
  await w.flush(() => { w.setScroll(200); w.dispatchScroll(); });
  const active = w.activeTab();
  assert.ok(active);
  // 直接把这条摘掉，再触发一次滚动同步
  active.remove();
  await w.flush(() => { w.setScroll(240); w.dispatchScroll(); });
  assert.equal(w.tabs().length, 11);
});

test("监听：DOM 变动 150ms 后重扫；连续变动只排一次", async () => {
  const w = await createWorld();
  await w.mount();
  const firstTab = w.tabs()[0];

  const row = w.rows[0];
  row.firstElementChild.textContent = "改过的第一句";
  await new Promise((r) => setTimeout(r, 0));  // 让 MutationObserver 派发
  const pendingBefore = w.timers.timeouts.filter((t) => !t.cleared).length;
  assert.equal(pendingBefore, 1);

  // 防抖窗口内再来一次：不应该再排一个定时器
  row.firstElementChild.textContent = "再改一次";
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.timers.timeouts.filter((t) => !t.cleared).length, pendingBefore, "防抖期内不重复排期");

  await w.flush(() => w.runTimeout());
  assert.equal(w.tabs()[0].textContent.includes("再改一次"), true);
  assert.equal(firstTab.isConnected, true);
});

test("监听：滚动容器被换掉时重新绑定；容器消失后不再报错", async () => {
  const w = await createWorld();
  await w.mount();

  w.scope.remove();
  await w.flush(() => w.tick());
  // scopeRoot 找不到容器 → 解绑，左栏保留但不更新
  assert.equal(w.win.__CLN__.report().scope, null);
  await w.flush(() => w.tick());
  assert.equal(w.win.__CLN__.report().scope, null);
});

test("监听：窗口 resize 与 800ms 轮询都会重新布局", async () => {
  const w = await createWorld();
  await w.mount();
  w.win.innerHeight = 350;
  await w.flush(() => w.win.dispatchEvent(new w.win.Event("resize")));
  assert.equal(w.rail().style.height, Math.min(500, 340) - 100 - 12 + "px");
  await w.flush(() => w.tick());
});

test("ResizeObserver：存在时观察容器，卸载时断开", async () => {
  const roSink = [];
  const w = await createWorld({ globalThisResize: true, roSink });
  await w.mount();
  assert.equal(roSink.length, 1);
  assert.equal(roSink[0].el, w.scope);

  w.win.innerHeight = 320;
  await w.flush(() => roSink[0].cb());
  assert.equal(w.rail().style.height, Math.min(500, 310) - 100 - 12 + "px");

  await w.unmount();
  assert.equal(roSink[0].disconnected, true);
});

test("卸载：标记、属性、样式变量、监听全部还原", async () => {
  const w = await createWorld();
  await w.mount();
  const iv = w.timers.intervals[w.timers.intervals.length - 1];
  assert.equal(w.scope.hasAttribute("data-chat-lanes"), true);

  await w.unmount();

  assert.equal(w.scope.hasAttribute("data-chat-lanes"), false);
  assert.equal(w.scope.style.getPropertyValue("--cln-rail"), "");
  assert.equal(w.rows[1].hasAttribute("data-cln-start"), false);
  assert.equal(iv.cleared, true);

  // 卸载后再跑一次轮询（模拟已清除的定时器仍在队列里）应该直接返回，不再改动 DOM
  iv.fn();
  assert.equal(w.scope.hasAttribute("data-chat-lanes"), false);
  assert.equal(w.rows[1].hasAttribute("data-cln-start"), false);
});

test("卸载：排期中的重扫会被取消", async () => {
  const w = await createWorld();
  await w.mount();
  w.rows[0].textContent = "触发一次重扫";
  await new Promise((r) => setTimeout(r, 10));
  const pending = w.timers.timeouts.filter((t) => !t.cleared);
  assert.equal(pending.length, 1);

  await w.unmount();
  assert.equal(pending[0].cleared, true);
});

test("会话外壳自己就是滚动容器时也能找到它", async () => {
  const w = await createWorld({ sessionIsScroll: true });
  await w.mount();
  assert.equal(w.win.__CLN__.scope(), w.scope);
  assert.equal(w.tabs().length, 12);
});

test("没有会话外壳时退回到全局的滚动容器", async () => {
  const w = await createWorld({ bareScope: true });
  await w.mount();
  assert.equal(w.win.__CLN__.scope(), w.scope);
  assert.equal(w.tabs().length, 12);
});

test("会话外壳存在但不是滚动容器、里面也没有时，视为找不到", async () => {
  const w = await createWorld();
  w.scope.removeAttribute("data-conversation-scroll");
  await w.mount();
  assert.equal(w.win.__CLN__.scope(), null);
  assert.equal(w.rail(), null);
});

test("找不到容器时：左栏不渲染、诊断接口给出可读的空状态", async () => {
  const w = await createWorld({ noScope: true });
  await w.mount();

  assert.equal(w.rail(), null);
  assert.deepEqual(w.win.__CLN__.report(), { scope: null, note: "找不到 [data-conversation-scroll]" });
  assert.equal(w.win.__CLN__.trace(), "no [data-conversation-scroll]");
  const st = w.win.__CLN__.state();
  assert.equal(st.pane, null);
  assert.equal(st.rail, null);
  assert.equal(st.list, null);
  assert.equal(st.active, null);
});

test("诊断 report：给出作用域尺寸、行数、kind 列表和前三条", async () => {
  const w = await createWorld();
  await w.mount();
  const r = w.win.__CLN__.report();
  assert.equal(r.rows, 24);
  assert.equal(r.entries, 12);
  assert.equal(r.kinds.startsWith("user,assistant-step"), true);
  assert.equal(r.scope.height, 400);
  assert.equal(r.first[0], "第 1 轮的问题");
});

test("诊断 trace：逐层走到第一条消息行，并带上输入框位置", async () => {
  const w = await createWorld();
  await w.mount();
  // trace 里用的是全局 console（Node 的那一个），不是 window.console
  const logs = [];
  const orig = console.log;
  console.log = (t) => logs.push(t);
  const text = w.win.__CLN__.trace();
  console.log = orig;

  assert.equal(logs.length, 1);
  assert.equal(text.startsWith("SCOPE "), true);
  assert.equal(text.includes("ROW "), true);
  assert.equal(text.includes("kind=user"), true);
  assert.equal(text.includes("ROW> "), true);
  assert.equal(text.includes("COMPOSER div"), true);
});

test("诊断 trace：没有输入框、没有消息行时也不炸", async () => {
  const w = await createWorld({ rows: [], composer: false });
  await w.mount();
  const text = w.win.__CLN__.trace();
  assert.equal(text.includes("COMPOSER none"), true);
  assert.equal(text.includes("ROW "), false);
});

test("诊断 state：报告滚动容器、左栏、列表与当前项", async () => {
  const w = await createWorld();
  await w.mount();
  await w.flush(() => { w.setScroll(200); w.dispatchScroll(); });

  const st = w.win.__CLN__.state();
  assert.equal(st.pane.top, 200);
  assert.equal(st.pane.client, 400);
  assert.equal(st.pane.scroll, 24 * ROW_H);
  assert.equal(st.rail.height, RAIL.height);
  assert.equal(st.list.client, LIST_H);
  assert.equal(st.entries, 12);
  assert.equal(st.active, "chat-anchor-3");
  assert.equal(st.activeVisible, true);
});

test("诊断 copy：有剪贴板就写进去，没有也不报错", async () => {
  const w = await createWorld();
  await w.mount();

  const written = [];
  Object.defineProperty(w.win.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t) => written.push(t) }
  });
  const text = w.win.__CLN__.copy();
  assert.equal(written.length, 1);
  assert.equal(written[0], text);

  delete w.win.navigator.clipboard;
  assert.equal(typeof w.win.__CLN__.copy(), "string");
});

test("跟随：左栏条目高度已知时，激活项始终落在可视区内", async () => {
  const w = await createWorld();
  await w.mount();
  const list = w.doc.querySelector(".cln-list");
  for (const y of [0, 200, 320, 480, 24 * ROW_H - 400]) {
    await w.flush(() => { w.setScroll(y); w.dispatchScroll(); });
    const on = w.activeTab();
    const er = on.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    assert.ok(er.top >= lr.top - 1 && er.top + ITEM_H <= lr.bottom + 1,
      "scroll=" + y + " 时激活项应可见，实际 top=" + er.top);
  }
});

test("诊断 trace：消息行有两层内层元素时会继续下钻", async () => {
  const w = await createWorld({ deepRows: true });
  await w.mount();
  const text = w.win.__CLN__.trace();
  assert.equal(text.includes("ROW> "), true);
  assert.equal(text.includes("ROW>> "), true);
});

test("重扫：同一行从回复变成我的话时，旧的分隔标记会被摘掉", async () => {
  const w = await createWorld();
  await w.mount();

  const reply = w.rows[1];
  assert.equal(reply.getAttribute("data-cln-start"), "");
  // 变成"我的话"（属性变更不被观察，所以同时动一下文本触发重扫）
  reply.setAttribute("data-chat-flow-kind", "user");
  reply.firstElementChild.textContent = "改成我的一句话";
  await new Promise((r) => setTimeout(r, 0)); // 等 MutationObserver 的回调投递
  w.runTimeout();
  await w.flush();
  assert.equal(reply.hasAttribute("data-cln-start"), false);
  assert.equal(reply.hasAttribute("data-cln-label"), false);
});

test("扫描：行内用 innerText 时优先取 innerText", async () => {
  const w = await createWorld();
  await w.mount();
  const row = w.rows[0];
  Object.defineProperty(row, "innerText", { configurable: true, value: "  来自 innerText   的一句  " });
  Object.defineProperty(row, "textContent", { configurable: true, value: "不该被读到的一句话" });
  w.rows[2].firstElementChild.textContent = "动一下触发重扫";
  await new Promise((r) => setTimeout(r, 0));
  w.runTimeout();
  await w.flush();
  assert.equal(w.tabs()[0].textContent.includes("来自 innerText 的一句"), true);
});

test("扫描：轮次外壳没有 data-chat-turn 时只写正文", async () => {
  const w = await createWorld({
    rows: [
      { kind: "user", text: "没有轮次号的一句", anchor: "a-1", turnEmpty: true },
      { kind: "assistant-step", text: "回复" }
    ]
  });
  await w.mount();
  assert.equal(w.rows[1].getAttribute("data-cln-label"), "没有轮次号的一句");
});

test("滚到底：连续两次到底时第二次不再改动当前项", async () => {
  const w = await createWorld();
  await w.mount();
  await w.flush(() => { w.setScroll(24 * ROW_H - 400); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-12");
  await w.flush(() => { w.setScroll(24 * ROW_H - 400); w.dispatchScroll(); });
  assert.equal(activeId(w), "chat-anchor-12");
});

test("诊断 trace：输入框没有布局信息时用 ? 兜底", async () => {
  const w = await createWorld();
  await w.mount();
  w.composer.getBoundingClientRect = undefined;
  assert.equal(w.win.__CLN__.trace().includes("COMPOSER ?"), true);
});

test("跟随：激活项被移出列表后不再尝试滚动", async () => {
  const w = await createWorld();
  await w.mount();
  await w.flush(() => { w.tabs()[3].dispatchEvent(new w.win.MouseEvent("click", { bubbles: true })); });
  assert.equal(activeId(w), "chat-anchor-4");
  const list0 = w.doc.querySelector(".cln-list");
  const before = list0.scrollTop;
  // 摘掉激活的那一条，不派发滚动事件：重扫后激活项仍然指向一个已不存在的 id
  w.tabs()[3].remove();
  await new Promise((r) => setTimeout(r, 0));
  w.runTimeout();
  await w.flush();
  assert.equal(w.doc.querySelector(".cln-list").scrollTop, before);
});

test("留白：正文被宿主的 max-width 居中包裹时，包裹被摊平", async () => {
  const w = await createWorld({ centerWrap: 600 });
  await w.mount();
  assert.equal(w.centerWrap.style.maxWidth, "none");
  // jsdom 会把 0 规范化成 0px
  assert.match(w.centerWrap.style.marginLeft, /^0(px)?$/);
  assert.match(w.centerWrap.style.marginRight, /^0(px)?$/);
});

test("留白：包裹本来就占满容器时不去动它", async () => {
  const w = await createWorld({ centerWrap: 1000 });
  await w.mount();
  assert.equal(w.centerWrap.style.maxWidth, "");
});

// ── 搜索：查询走 Host 半，结果点一下就跳 ──────────────────────────────
const HITS = [
  { turn: 3, seq: 40, snippet: "手续费按两倍算，所以 full-C 的门槛更高", why: "这一轮给了口径" },
  { turn: 5, seq: 70, snippet: "max_bid 还卖出，是因为口径不一致", why: "" }
];

function setQuery(w, text) {
  const input = w.doc.querySelector(".cln-q");
  const setter = Object.getOwnPropertyDescriptor(w.win.HTMLInputElement.prototype, "value").set;
  setter.call(input, text);
  input.dispatchEvent(new w.win.Event("input", { bubbles: true }));
  return input;
}

function fakeFetch(w, reply) {
  const calls = [];
  w.win.fetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({ json: () => Promise.resolve(reply) });
  };
  return calls;
}

test("搜索：只打字不发请求，回车才问；结果显示轮次与理由，点一下跳过去", async () => {
  const w = await createWorld();
  const calls = fakeFetch(w, { ok: true, hits: HITS });
  await w.mount();

  await w.flush(() => setQuery(w, "手续费怎么算"));
  // 打字不发请求，提示"按回车搜索"
  assert.equal(calls.length, 0);
  assert.equal(w.doc.querySelector(".cln-note").textContent, "按回车搜索");

  await w.flush(() => w.doc.querySelector(".cln-q").dispatchEvent(new w.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/hellmage/dsh-chat-lanes/search");
  assert.deepEqual(JSON.parse(calls[0].init.body), { sessionId: "s1", query: "手续费怎么算" });
  await w.flush();

  const hits = w.doc.querySelectorAll(".cln-hit");
  assert.equal(hits.length, 2);
  assert.equal(hits[0].querySelector(".h").textContent, "第 3 轮");
  assert.match(hits[0].querySelector(".s").textContent, /手续费/);
  assert.equal(hits[0].querySelector(".w").textContent, "这一轮给了口径");
  assert.equal(hits[1].querySelector(".w"), null);

  // 点第 3 轮：轮次外壳里的第一行在 4*ROW_H 处
  await w.click(hits[0]);
  assert.equal(w.getScroll(), 4 * ROW_H - 12);
});

test("搜索：回车立刻问，少于两个字不发；Esc 清空回到时间轴", async () => {
  const w = await createWorld();
  const calls = fakeFetch(w, { ok: true, hits: HITS });
  await w.mount();

  await w.flush(() => setQuery(w, "手"));
  await w.flush(() => w.doc.querySelector(".cln-q").dispatchEvent(new w.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  assert.equal(calls.length, 0);

  await w.flush(() => setQuery(w, "手续费"));
  await w.flush(() => w.doc.querySelector(".cln-q").dispatchEvent(new w.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  assert.equal(calls.length, 1);
  await w.flush();
  assert.equal(w.doc.querySelectorAll(".cln-hit").length, 2);

  // 别的键不管
  await w.flush(() => w.doc.querySelector(".cln-q").dispatchEvent(new w.win.KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
  assert.equal(calls.length, 1);

  await w.flush(() => w.doc.querySelector(".cln-q").dispatchEvent(new w.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(w.doc.querySelectorAll(".cln-hit").length, 0);
  assert.equal(w.doc.querySelectorAll(".cln-t").length, 12);
});

test("搜索：键入后清空，回到时间轴且不发请求", async () => {
  const w = await createWorld();
  const calls = fakeFetch(w, { ok: true, hits: HITS });
  await w.mount();

  await w.flush(() => setQuery(w, "手续费"));
  await w.flush(() => setQuery(w, "  "));
  w.runTimeout();
  await w.flush();
  assert.equal(calls.length, 0);
  assert.equal(w.doc.querySelectorAll(".cln-t").length, 12);
});

test("搜索：会话外壳在但没有 id 属性时，当成换了一个会话（它是空白的）", async () => {
  const w = await createWorld();
  fakeFetch(w, { ok: true, hits: HITS });
  await w.mount();
  await w.enter("手续费");
  assert.equal(w.doc.querySelectorAll(".cln-hit").length, 2);

  const holder = w.doc.querySelector("[data-conversation-session]");
  holder.removeAttribute("data-conversation-session");
  await w.flush(() => w.doc.querySelector("[data-conversation-scroll]").appendChild(w.doc.createElement("div")));
  w.runTimeout();
  await w.flush();

  assert.equal(w.doc.querySelector(".cln-q").value, "");
  assert.equal(w.doc.querySelectorAll(".cln-t").length, 12);
});

test("搜索：切走再切回来，搜索词和结果都还在", async () => {
  const w = await createWorld();
  fakeFetch(w, { ok: true, hits: HITS });
  await w.mount();

  await w.enter("手续费");
  assert.equal(w.doc.querySelectorAll(".cln-hit").length, 2);

  const holder = w.doc.querySelector("[data-conversation-session]");
  const other = (id) => { holder.setAttribute("data-conversation-session", id); return w.flush(() => w.doc.querySelector("[data-conversation-scroll]").appendChild(w.doc.createElement("div"))); };

  // 切到另一个会话：它是空白的
  await other("s2");
  w.runTimeout();
  await w.flush();
  assert.equal(w.doc.querySelector(".cln-q").value, "");
  assert.equal(w.doc.querySelectorAll(".cln-hit").length, 0);

  // 切回 s1：词和结果都回来
  await other("s1");
  w.runTimeout();
  await w.flush();
  assert.equal(w.doc.querySelector(".cln-q").value, "手续费");
  assert.equal(w.doc.querySelectorAll(".cln-hit").length, 2);
});

test("搜索：两个会话各记各的，互不覆盖", async () => {
  const w = await createWorld();
  fakeFetch(w, { ok: true, hits: HITS });
  await w.mount();

  const holder = w.doc.querySelector("[data-conversation-session]");
  const other = (id) => { holder.setAttribute("data-conversation-session", id); return w.flush(() => w.doc.querySelector("[data-conversation-scroll]").appendChild(w.doc.createElement("div"))); };

  await w.enter("手续费");
  await other("s2");
  w.runTimeout();
  await w.flush();
  // 第二个会话里只打字、不回车
  await w.flush(() => setQuery(w, "口径"));
  assert.equal(w.doc.querySelector(".cln-note").textContent, "按回车搜索");

  await other("s1");
  w.runTimeout();
  await w.flush();
  assert.equal(w.doc.querySelector(".cln-q").value, "手续费");
  assert.equal(w.doc.querySelectorAll(".cln-hit").length, 2);

  await other("s2");
  w.runTimeout();
  await w.flush();
  // 切回 s2：只打了一半没搜的词也要在
  assert.equal(w.doc.querySelector(".cln-q").value, "口径");
  assert.equal(w.doc.querySelector(".cln-note").textContent, "按回车搜索");
});


test("搜索：没有会话 id、后端报错、网络失败、空结果，各说各的", async () => {
  const bare = await createWorld({ bareScope: true });
  fakeFetch(bare, { ok: true, hits: HITS });
  await bare.mount();
  await bare.enter("手续费");
  assert.equal(bare.doc.querySelector(".cln-note").textContent, "找不到会话 id");
  assert.equal(bare.doc.querySelectorAll(".cln-hit").length, 0);

  const failed = await createWorld();
  fakeFetch(failed, { ok: false, error: "索引没建好" });
  await failed.mount();
  await failed.enter("手续费");
  assert.equal(failed.doc.querySelector(".cln-note").textContent, "索引没建好");

  const silent = await createWorld();
  fakeFetch(silent, { ok: false });
  await silent.mount();
  await silent.enter("手续费");
  assert.equal(silent.doc.querySelector(".cln-note").textContent, "检索失败");

  const offline = await createWorld();
  offline.win.fetch = () => Promise.reject(new Error("boom"));
  await offline.mount();
  await offline.enter("手续费");
  assert.equal(offline.doc.querySelector(".cln-note").textContent, "网络错误");

  const empty = await createWorld();
  fakeFetch(empty, { ok: true, hits: [] });
  await empty.mount();
  await empty.enter("手续费");
  assert.equal(empty.doc.querySelector(".cln-note").textContent, "没找到相关的轮次");
});

test("搜索：点一个还没载入的轮次，直说没载入", async () => {
  const w = await createWorld({ noSessions: true });
  fakeFetch(w, { ok: true, hits: [{ turn: 99, seq: 900, snippet: "很远的一轮", why: "" }] });
  await w.mount();
  await w.enter("手续费");
  await w.click(w.doc.querySelector(".cln-hit"));
  assert.equal(w.doc.querySelector(".cln-note").textContent, "第 99 轮还没载入");
  assert.equal(w.getScroll(), 0);
});

test("搜索：慢回来的旧结果不覆盖新查询", async () => {
  const w = await createWorld();
  let releaseFirst = null;
  w.win.fetch = () => new Promise((resolve) => {
    if (releaseFirst === null) releaseFirst = () => resolve({ json: () => Promise.resolve({ ok: true, hits: HITS }) });
    else resolve({ json: () => Promise.resolve({ ok: true, hits: [{ turn: 5, seq: 70, snippet: "新查询的结果", why: "" }] }) });
  });
  await w.mount();

  await w.enter("手续费");
  await w.enter("口径");
  assert.match(w.doc.querySelector(".cln-hit .s").textContent, /新查询/);

  // 第一次查询这时才回来：必须被丢掉
  await w.flush(() => releaseFirst());
  await new Promise((r) => setTimeout(r, 0));
  await w.flush();
  assert.match(w.doc.querySelector(".cln-hit .s").textContent, /新查询/);

  // 迟到的失败同理
  const w2 = await createWorld();
  let rejectFirst = null;
  w2.win.fetch = () => new Promise((resolve, reject) => {
    if (rejectFirst === null) rejectFirst = () => reject(new Error("boom"));
    else resolve({ json: () => Promise.resolve({ ok: true, hits: [{ turn: 5, seq: 70, snippet: "第二次", why: "" }] }) });
  });
  await w2.mount();
  await w2.enter("手续费");
  await w2.enter("口径");
  await w2.flush(() => rejectFirst());
  await new Promise((r) => setTimeout(r, 0));
  await w2.flush();
  assert.match(w2.doc.querySelector(".cln-hit .s").textContent, /第二次/);
});

test("搜索：路由没挂上（404 拿到 HTML）时说清楚要重启，而不是笼统报网络错误", async () => {
  const w = await createWorld();
  w.win.fetch = () => Promise.resolve({
    status: 404,
    json: () => Promise.reject(new SyntaxError("Unexpected token <"))
  });
  await w.mount();
  await w.enter("手续费");
  assert.equal(w.doc.querySelector(".cln-note").textContent, "搜索服务没启动，重启 DSH 之后再来");

  const w2 = await createWorld();
  w2.win.fetch = () => Promise.resolve({ status: 502, json: () => Promise.reject(new SyntaxError("bad gateway")) });
  await w2.mount();
  await w2.enter("手续费");
  assert.equal(w2.doc.querySelector(".cln-note").textContent, "搜索服务返回了 502");
});

test("搜索：点没载入的轮次，先让宿主翻到那一轮，再滚过去", async () => {
  const w = await createWorld();
  w.win.fetch = () => Promise.resolve({
    json: () => Promise.resolve({ ok: true, hits: [{ turn: 23, seq: 641, snippet: "旧的 basline", why: "" }] })
  });
  await w.mount();
  await w.enter("baseline");
  await w.flush(() => w.doc.querySelector(".cln-hit").click());

  // 这一轮还不在 DOM 里：请求翻日志，而不是直接报错
  assert.deepEqual(w.loads, [{ id: "s1", seq: 641 }]);
  assert.match(w.doc.querySelector(".cln-note").textContent, /正在翻日志/);

  // 宿主把那一轮渲染出来之后，轮询接管：清掉提示并滚过去
  const turn = w.doc.createElement("div");
  turn.setAttribute("data-chat-turn", "23");
  const row = w.doc.createElement("div");
  row.setAttribute("data-chat-flow-kind", "assistant-step");
  turn.appendChild(row);
  row.getBoundingClientRect = () => ({ top: 900, bottom: 940 });
  w.scope.appendChild(turn);
  while (w.doc.querySelector(".cln-note")) {
    if (!w.runTimeout()) break;
    await w.flush();
  }
  assert.equal(w.doc.querySelector(".cln-note"), null);
  assert.equal(w.getScroll(), 900 - 100 - 12);
});

test("搜索：翻完日志还是没有那一轮，就直说没载入", async () => {
  const w = await createWorld();
  w.win.fetch = () => Promise.resolve({
    json: () => Promise.resolve({ ok: true, hits: [{ turn: 23, seq: 641, snippet: "旧的", why: "" }] })
  });
  await w.mount();
  await w.enter("baseline");
  await w.flush(() => w.doc.querySelector(".cln-hit").click());
  assert.deepEqual(w.loads.map((l) => l.seq), [641]);
  for (let i = 0; i < 41; i += 1) {
    await w.flush(() => w.runTimeout());
  }
  assert.equal(w.doc.querySelector(".cln-note").textContent, "第 23 轮还没载入");
});

test("搜索：拿不到会话绑定（没有 sessions 服务）时不去翻日志", async () => {
  const w = await createWorld({ noSessions: true });
  w.win.fetch = () => Promise.resolve({
    json: () => Promise.resolve({ ok: true, hits: [{ turn: 23, seq: 641, snippet: "旧的", why: "" }] })
  });
  await w.mount();
  await w.enter("baseline");
  await w.flush(() => w.doc.querySelector(".cln-hit").click());
  assert.deepEqual(w.loads, []);
  assert.equal(w.doc.querySelector(".cln-note").textContent, "第 23 轮还没载入");
});

test("搜索：翻日志失败也说明白", async () => {
  const w = await createWorld({ loadThrough: () => Promise.reject(new Error("host gone")) });
  w.win.fetch = () => Promise.resolve({
    json: () => Promise.resolve({ ok: true, hits: [{ turn: 23, seq: 641, snippet: "旧的", why: "" }] })
  });
  await w.mount();
  await w.enter("baseline");
  await w.flush(() => w.doc.querySelector(".cln-hit").click());
  await new Promise((r) => setTimeout(r, 0));
  await w.flush();
  assert.equal(w.doc.querySelector(".cln-note").textContent, "第 23 轮还没载入");
});

test("搜索：跳到某一轮之后，左栏那一条就是当前（高亮跟着跳）", async () => {
  const w = await createWorld();
  w.win.fetch = () => Promise.resolve({
    json: () => Promise.resolve({ ok: true, hits: [{ turn: 4, seq: 41, snippet: "第四轮", why: "" }] })
  });
  await w.mount();
  await w.enter("第四轮");
  await w.flush(() => w.doc.querySelectorAll(".cln-hit")[0].click());
  assert.equal(w.doc.querySelector(".cln-hit.on").getAttribute("data-cln-hit"), "4");
});

test("搜索：跳到的那一轮在左栏里没有对应条目时不硬点高亮", async () => {
  const w = await createWorld();
  w.win.fetch = () => Promise.resolve({
    json: () => Promise.resolve({ ok: true, hits: [{ turn: 99, seq: 941, snippet: "九十九轮", why: "" }] })
  });
  await w.mount();
  const before = w.doc.querySelector(".cln-t.on").getAttribute("data-cln-id");
  await w.enter("九十九");
  await w.flush(() => w.doc.querySelectorAll(".cln-hit")[0].click());
  assert.equal(w.doc.querySelector(".cln-hit.on"), null);
  await w.flush(() => w.doc.querySelector(".cln-q").dispatchEvent(new w.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(w.doc.querySelector(".cln-t.on").getAttribute("data-cln-id"), before);
});

test("搜索：对话容器被摘掉之后点结果，退回旧节点也不会炸", async () => {
  const w = await createWorld();
  w.win.fetch = () => Promise.resolve({
    json: () => Promise.resolve({ ok: true, hits: [{ turn: 23, seq: 641, snippet: "旧的", why: "" }] })
  });
  await w.mount();
  await w.enter("baseline");
  w.scope.remove();
  w.doc.querySelector(".cln-hit").click();
  await w.flush();
  assert.match(w.doc.querySelector(".cln-note").textContent, /正在翻日志/);
  assert.deepEqual(w.loads.map((l) => l.seq), [641]);
});
