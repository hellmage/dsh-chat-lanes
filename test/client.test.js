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
