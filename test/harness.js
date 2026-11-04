// 测试夹具：把一个假对话窗口装进 jsdom，再把 lib/client.js 注册进来的 Rail 渲染上去。
//
// 为什么要这么多桩：客户端插件跑在宿主的网页里，我们没有那份 DOM。
// 这里用 jsdom + 一层"布局替身"（元素位置、滚动高度都由本文件给出）把它撑起来，
// 这样点击跳转、滚动跟随这类几何逻辑才能被真实断言，而不是"看着像对"。

import path from "node:path";
import { pathToFileURL } from "node:url";

const CLIENT_URL = pathToFileURL(path.resolve(import.meta.dirname, "../lib/client.js")).href;

export const SCOPE = { top: 100, left: 0, width: 1000, height: 400 };
export const ROW_H = 40;
export const ITEM_H = 50;
export const LIST_H = 200;
export const RAIL = { left: 6, top: 106, width: 180, height: 300 };

let ReactNS = null;
let ReactDOM = null;
let clientFactory = null;
let shared = null;
let activeRoot = null;

// 当前这"一张世界"的布局状态；jsdom 只建一次（react-dom 会缓存 document）
const live = { scope: null, rowIndex: new WeakMap(), scrollTops: new WeakMap(), rowCount: 0 };

export function defaultRows(n = 12) {
  // 一轮 = 我的一句话 + 模型的一条回复；anchor-key 模拟宿主给的稳定锚点
  const out = [];
  for (let k = 1; k <= n; k++) {
    out.push({ kind: "user", text: "第 " + k + " 轮的问题", anchor: "chat-anchor-" + k, turn: String(k) });
    out.push({ kind: "assistant-step", text: "第 " + k + " 轮的回复" });
  }
  return out;
}

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

async function boot() {
  if (shared) return shared;
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true
  });
  const win = dom.window;
  const doc = win.document;

  // Node 里有些全局是只读访问器（navigator 就是），只能 defineProperty
  const defineGlobal = (name, value) => Object.defineProperty(globalThis, name, {
    configurable: true, writable: true, value
  });
  defineGlobal("window", win);
  defineGlobal("document", doc);
  defineGlobal("navigator", win.navigator);
  defineGlobal("self", win);
  defineGlobal("MutationObserver", win.MutationObserver);
  defineGlobal("Element", win.Element);
  defineGlobal("HTMLElement", win.HTMLElement);
  defineGlobal("Node", win.Node);
  defineGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  win.innerHeight = 800;
  win.CSS = { escape: (s) => String(s).replace(/["\\]/g, "\\$&") };

  ReactNS = await import("react");
  ReactDOM = await import("react-dom/client");

  win.Element.prototype.getBoundingClientRect = function () {
    const scope = live.scope;
    if (scope && this === scope) {
      return rect(SCOPE.left, SCOPE.top, live.scopeW == null ? SCOPE.width : live.scopeW, SCOPE.height);
    }
    if (live.rowIndex.has(this)) {
      const i = live.rowIndex.get(this);
      const top = SCOPE.top + i * ROW_H - (scope ? live.scrollTops.get(scope) || 0 : 0);
      return rect(0, top, 1000, ROW_H);
    }
    if (this.classList && this.classList.contains("cln-rail")) {
      return rect(RAIL.left, RAIL.top, RAIL.width, RAIL.height);
    }
    if (this.classList && this.classList.contains("cln-list")) {
      return rect(RAIL.left, RAIL.top + 8, RAIL.width, LIST_H);
    }
    if (this.dataset && this.dataset.clnId) {
      const parent = this.parentElement;
      const i = parent ? Array.prototype.indexOf.call(parent.children, this) : 0;
      const list = doc.querySelector(".cln-list");
      const top = RAIL.top + 8 + i * ITEM_H - (list ? live.scrollTops.get(list) || 0 : 0);
      return rect(RAIL.left, top, RAIL.width, ITEM_H);
    }
    return rect(0, 0, 0, 0);
  };

  const getter = (name, fn) => Object.defineProperty(win.Element.prototype, name, { configurable: true, get: fn, set() {} });
  getter("clientHeight", function () {
    if (this === live.scope) return SCOPE.height;
    if (this.classList && this.classList.contains("cln-list")) return LIST_H;
    return 0;
  });
  getter("scrollHeight", function () {
    if (this === live.scope) return live.rowCount * ROW_H;
    if (this.classList && this.classList.contains("cln-list")) return this.children.length * ITEM_H;
    return 0;
  });
  Object.defineProperty(win.Element.prototype, "scrollTop", {
    configurable: true,
    get() { return live.scrollTops.get(this) || 0; },
    set(v) { live.scrollTops.set(this, Math.max(0, Number(v) || 0)); }
  });

  win.__ModuleLoader__ = { load(def) { clientFactory = def.factory; } };
  await import(CLIENT_URL);
  if (!clientFactory) throw new Error("client.js 没有调用 window.__ModuleLoader__.load");

  shared = { dom, win, doc };
  return shared;
}

function makeTimers(win) {
  const timers = { timeouts: [], intervals: [] };
  win.setTimeout = (fn, ms) => { const id = { fn, ms, cleared: false }; timers.timeouts.push(id); return id; };
  win.clearTimeout = (id) => { if (id) id.cleared = true; };
  win.setInterval = (fn, ms) => { const id = { fn, ms, cleared: false }; timers.intervals.push(id); return id; };
  win.clearInterval = (id) => { if (id) id.cleared = true; };
  return timers;
}

export async function createWorld(options = {}) {
  const { win, doc } = await boot();

  // 上一张世界的 React 根要正经卸载，否则 act 队列里会留着没人处理的更新
  if (activeRoot) {
    const prev = activeRoot;
    activeRoot = null;
    await ReactNS.act(async () => { prev.unmount(); });
  }

  // 上一张世界残留的节点、监听、根统统清掉
  doc.body.innerHTML = "";
  doc.querySelectorAll("style[data-plugin-css]").forEach((el) => el.remove());

  const rows = options.rows || defaultRows();
  live.rowIndex = new WeakMap();
  live.scrollTops = new WeakMap();
  live.rowCount = rows.length;
  live.scope = null;
  live.scopeW = options.scopeW == null ? null : options.scopeW;

  const app = doc.createElement("div");
  app.id = "app";
  doc.body.appendChild(app);

  const composerEl = doc.createElement("div");
  composerEl.setAttribute("data-composer-seat", "");
  composerEl.getBoundingClientRect = () => rect(0, options.composerTop == null ? 600 : options.composerTop, 1000, 120);
  if (options.composer !== false) app.appendChild(composerEl);

  // 消息行挂在哪：没有会话滚动容器时挂在一个"裸"容器里，用来验证降级路径
  const rowHost = doc.createElement("div");
  app.appendChild(rowHost);

  let scope = null;
  if (options.bareScope) {
    scope = doc.createElement("div");
    scope.setAttribute("data-conversation-scroll", "");
    app.insertBefore(scope, rowHost);
    rowHost.remove();
    live.scope = scope;
  } else if (!options.noScope) {
    const session = doc.createElement("div");
    session.setAttribute("data-conversation-session", "s1");
    session.setAttribute("data-not-scroll", "");
    scope = doc.createElement("div");
    scope.setAttribute("data-conversation-scroll", "");
    session.appendChild(scope);
    app.insertBefore(session, rowHost);
    if (options.sessionIsScroll) {
      // 宿主的一种形态：会话容器自身就是滚动容器
      session.setAttribute("data-conversation-scroll", "");
      scope.removeAttribute("data-conversation-scroll");
      live.scope = session;
    } else {
      live.scope = scope;
    }
    rowHost.remove();
  }
  const host = live.scope || app;

  const rowEls = [];
  let turnHost = null;
  // 宿主常见的那层"max-width + 居中"包裹，用来验证正文左侧留白有没有被摊平
  let centerWrap = null;
  if (options.centerWrap) {
    centerWrap = doc.createElement("div");
    centerWrap.className = "center";
    centerWrap.getBoundingClientRect = () => rect(SCOPE.left, SCOPE.top, options.centerWrap, SCOPE.height);
    host.appendChild(centerWrap);
  }

  rows.forEach((spec, i) => {
    if (spec.turn === null) turnHost = null;
    if (spec.turn || spec.turnEmpty) {
      turnHost = doc.createElement("div");
      turnHost.setAttribute("data-chat-turn", spec.turnEmpty ? "" : spec.turn);
      (centerWrap || host).appendChild(turnHost);
    }
    const el = doc.createElement("div");
    el.setAttribute("data-chat-flow-kind", spec.kind);
    if (spec.anchor) el.setAttribute("data-chat-anchor-key", spec.anchor);
    // 真宿主里一行是有内层元素的，这里也造一层，顺带覆盖 trace 的逐层下钻
    const inner = doc.createElement("div");
    inner.className = "ln";
    const text = spec.empty ? "" : (spec.text == null ? "row " + i : spec.text);
    if (options.deepRows) {
      // 两层内层元素，用来验证 trace 的 >> 下钻
      const deep = doc.createElement("span");
      deep.className = "tx";
      deep.textContent = text;
      inner.appendChild(deep);
    } else {
      inner.textContent = text;
    }
    el.appendChild(inner);
    (turnHost || centerWrap || host).appendChild(el);
    live.rowIndex.set(el, i);
    rowEls.push(el);
  });

  if (options.extraStyle) {
    const oldStyle = doc.createElement("style");
    oldStyle.setAttribute("data-plugin-css", "dsh-chat-lanes");
    doc.head.appendChild(oldStyle);
  }

  const timers = makeTimers(win);

  const defineGlobalObj = (name, value) => Object.defineProperty(globalThis, name, {
    configurable: true, writable: true, value
  });

  if (options.globalThisResize) {
    const sink = options.roSink || [];
    defineGlobalObj("ResizeObserver", class {
      constructor(cb) { this.cb = cb; sink.push(this); }
      observe(el) { this.el = el; }
      disconnect() { this.disconnected = true; }
    });
    win.ResizeObserver = globalThis.ResizeObserver;
  } else {
    delete globalThis.ResizeObserver;
    delete win.ResizeObserver;
  }

  const commonjs = clientFactory((name) => {
    if (name === "react") return ReactNS;
    throw new Error("unexpected require: " + name);
  });

  const slots = {
    injected: [],
    registered: [],
    inject(name, fn) { slots.injected.push(name); fn(); },
    register(desc, factory) { slots.registered.push({ desc, factory }); return { dispose() {} }; }
  };
  const effects = [];
  const ctx = {
    get: options.getOverride || ((name) => (name === "slots" ? slots : undefined)),
    effect(fn) { effects.push(fn()); }
  };

  const container = doc.createElement("div");
  container.id = "lane-root";
  doc.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  activeRoot = root;
  const act = ReactNS.act;

  return {
    win, doc, scope: live.scope, rows: rowEls, composer: composerEl, centerWrap,
    commonjs, slots, ctx, effects, container, timers, scopeEl: live.scope,
    setScroll(y) { if (live.scope) live.scrollTops.set(live.scope, y); },
    // 换掉滚动容器（模拟切会话时宿主的节点替换）：新节点接管布局替身与行索引
    reattach(el) {
      live.scope = el;
      live.rowIndex = new Map(
        Array.from(el.querySelectorAll("[data-chat-flow-kind]")).map((r, i) => [r, i])
      );
    },
    getScroll() { return live.scope ? live.scrollTops.get(live.scope) || 0 : 0; },
    dispatchScroll() { doc.dispatchEvent(new win.Event("scroll")); },
    async mount() {
      commonjs.apply(ctx);
      await act(async () => { root.render(slots.registered[0].factory()); });
    },
    async unmount() { await act(async () => { root.unmount(); }); },
    async flush(fn) { await act(async () => { if (fn) fn(); }); },
    runTimeout() {
      const pending = timers.timeouts.filter((t) => !t.cleared).pop();
      if (!pending) return null;
      pending.cleared = true;
      timers.timeouts = timers.timeouts.filter((t) => t !== pending);
      pending.fn();
      return pending;
    },
    // ms 省略 = 跑所有还活着的定时器；forceTick 连已清理的也跑（测 dispose 后的兜底）
    tick(ms) {
      const run = timers.intervals.filter((t) => !t.cleared && (ms == null || t.ms === ms));
      for (const iv of run) iv.fn();
    },
    forceTick() { for (const iv of timers.intervals) iv.fn(); },
    rail() { return doc.querySelector(".cln-rail"); },
    tabs() { return Array.prototype.slice.call(doc.querySelectorAll(".cln-t")); },
    activeTab() { return doc.querySelector(".cln-t.on"); },
    tabById(id) { return doc.querySelector('[data-cln-id="' + win.CSS.escape(id) + '"]'); },
    async click(tab) { await act(async () => { tab.dispatchEvent(new win.MouseEvent("click", { bubbles: true })); }); }
  };
}
