window.__ModuleLoader__.load({
  id: "dsh-chat-lanes",
  factory: (require) => {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;

    // v0.1：把对话窗口切成两列 —— 我的话常驻左栏，模型的话在右侧单轴流动。
    // 只依赖宿主公开的 DOM 契约（data-* 属性），不碰 React 内部、不接管 chat.flow。
    //
    // 约定：这里不写"吞异常"的 try/catch。上一次 bug 就是被空的 catch 吞掉的，
    // 结果是跟随逻辑静默失效、用户只能看到"左栏不滚"。要失败就让它响。

    var SEL = {
      CONV_SCROLL: "[data-conversation-scroll]",
      SESSION: "[data-conversation-session]",
      ROW: "[data-chat-flow-kind]",
      TURN: "[data-chat-turn]"
    };
    var USER_KINDS = { user: 1, steering: 1 };
    var LANE_MIN = 196;
    var LANE_MAX = 288;
    var LANE_RATIO = 0.18;
    var MAX_TEXT = 2000;
    var SEARCH_PATH = "/api/hellmage/dsh-chat-lanes/search";
    var openHead = null;   // 同一时刻只允许开一个

    var CSS_TEXT = [
      /* 正文整体让出左栏：给滚动容器加左内边距，而不是逐行缩进 */
      '[data-chat-lanes]{padding-left:var(--cln-rail, 240px) !important;transition:padding-left .12s ease}',
      /* 我的话只在左栏出现 */
      '[data-chat-lanes] [data-chat-flow-kind="user"],[data-chat-lanes] [data-chat-flow-kind="steering"]{display:none !important}',
      /* 左栏：一条有底色的走廊 */
      '.cln-rail{position:fixed;z-index:6;display:flex;flex-direction:column;overflow:hidden;pointer-events:auto;box-sizing:border-box;',
      'color:var(--dsw-alias-label-primary,#1a1a1a);border-radius:10px;padding:6px 0 8px;',
      'background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4.5%,var(--dsw-alias-bg-base,#fff))}',
      '.cln-hd{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 12px 8px;',
      'font-size:11px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#8a8a8a);flex:0 0 auto}',
      '.cln-n{font-variant-numeric:tabular-nums}',
      '.cln-list{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;',
      'gap:4px;padding:2px 0 10px 8px;scrollbar-width:thin}',
      '.cln-t{display:block;width:100%;box-sizing:border-box;text-align:left;font:inherit;cursor:pointer;color:var(--dsw-alias-label-secondary,#444);',
      'padding:8px 10px;border:0;border-left:2px solid transparent;border-radius:8px 0 0 8px;background:transparent;',
      'margin:0;transition:background .12s ease,color .12s ease}',
      '.cln-t:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 7%,transparent)}',
      /* 当前条：与正文同色，右边不留线，看起来是正文这一列向左伸出的一个页签 */
      '.cln-t.on{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);',
      'border-left-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
      /* 每一轮回复的起点：一道实线 + 一枚"这一轮在答什么"的标签 */
      '[data-chat-lanes] [data-cln-start]{position:relative;border-top:1px solid color-mix(in srgb, var(--dsw-alias-label-primary, #000) 18%, transparent) !important;',
      // 标签绝对定位进 padding 让出的那一条空白里：行内怎么排都不会压到正文
      'padding-top:34px !important;margin-top:26px !important}',
      // 行头是真实 DOM（不是 ::before）：要能点开、能把原文选中复制
      '.cln-rhead{position:absolute;left:0;right:0;top:9px;z-index:4}',
      '.cln-rh{display:flex;align-items:center;gap:8px;width:fit-content;max-width:100%;box-sizing:border-box;cursor:pointer;',
      'font-size:11px;line-height:1.5;font-weight:500;letter-spacing:.01em;padding:2px 9px;border-radius:6px;user-select:none;',
      'color:color-mix(in srgb, var(--dsw-alias-state-success-primary,#2f9e63) 76%, var(--dsw-alias-label-primary,#1a1a1a));',
      'background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#2f9e63) 15%, transparent)}',
      '.cln-rh:hover{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#2f9e63) 24%, transparent)}',
      '.cln-rl{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cln-rb{flex:0 0 auto;font-size:10px;opacity:.72}',
      '.cln-rf{position:absolute;top:calc(100% + 4px);left:0;z-index:5;box-sizing:border-box;width:min(560px,100%);max-height:46vh;overflow:auto;',
      'padding:9px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
      'background:var(--dsw-alias-bg-overlay,#fff);box-shadow:0 8px 24px rgba(0,0,0,.16);cursor:text;user-select:text}',
      '.cln-rf[hidden]{display:none}',
      '.cln-rt{font-size:12px;line-height:1.65;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#1a1a1a);padding-right:24px}',
      /* 复制：面板右上角一枚小图标（两个叠起来的小方块），不占一行 */
      '.cln-rc{position:absolute;top:5px;right:5px;width:22px;height:22px;padding:0;margin:0;border:0;border-radius:5px;',
      'background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
      '.cln-rc:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 8%,transparent);color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.cln-rc::before,.cln-rc::after{content:"";position:absolute;box-sizing:border-box;width:8px;height:8px;',
      'border:1.3px solid currentColor;border-radius:2px}',
      '.cln-rc::before{left:5px;top:4px}',
      '.cln-rc::after{left:8px;top:7px;background:var(--dsw-alias-bg-overlay,#fff)}',
      '.cln-rc.ok{color:var(--dsw-alias-state-success-primary,#2f9e63)}',
      '.cln-x{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:12.5px;line-height:1.5;word-break:break-word}',
      '.cln-m{display:block;margin-top:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums}',
      /* 搜索框：常驻表头，占满剩下的宽度 */
      /* 输入框要能一眼看出是个框：底色 + 边框，别跟左栏的灰底融在一起 */
      '.cln-q{flex:1 1 auto;min-width:0;box-sizing:border-box;height:28px;padding:0 9px 0 26px;font:inherit;font-size:12px;',
      'color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-base,#fff);',
      'border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary,#000) 16%,transparent);border-radius:7px;outline:none;',
      '-webkit-appearance:none;appearance:none;transition:border-color .12s ease,box-shadow .12s ease}',
      '.cln-q:hover{border-color:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 26%,transparent)}',
      '.cln-q:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);',
      'box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 15%,transparent)}',
      '.cln-q::placeholder{color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
      /* 放大镜：两笔 CSS 画的，不引图标包 */
      '.cln-mag{position:absolute;left:19px;top:11px;width:9px;height:9px;border:1.5px solid var(--dsw-alias-label-tertiary,#8a8a8a);',
      'border-radius:50%;pointer-events:none}',
      '.cln-mag::after{content:"";position:absolute;right:-4px;bottom:-3px;width:5px;height:1.5px;border-radius:1px;',
      'background:var(--dsw-alias-label-tertiary,#8a8a8a);transform:rotate(45deg)}',
      '.cln-hit{display:block;width:100%;box-sizing:border-box;text-align:left;font:inherit;cursor:pointer;color:inherit;',
      'padding:7px 9px 8px;margin:0;border:0;border-radius:8px;background:transparent}',
      '.cln-hit:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 6%,transparent)}',
      '.cln-hit .h{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);margin-bottom:3px;font-variant-numeric:tabular-nums}',
      '.cln-hit .s{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;line-height:1.55;',
      'color:var(--dsw-alias-label-secondary,#4a4a4a);word-break:break-word}',
      '.cln-hit .w{display:block;margin-top:4px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
      '.cln-note{padding:8px 10px;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8a8a8a)}'
    ].join("");

    // 只认"真的在屏幕上"的对话容器：切到内置页时它可能被整个卸载，
    // 也可能只是被藏起来（尺寸归零），两种都当成没有对话
    function visible(el) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 40 ? el : null;
    }

    function scopeRoot() {
      var session = document.querySelector(SEL.SESSION);
      if (session) {
        var el = session.matches(SEL.CONV_SCROLL) ? session : session.querySelector(SEL.CONV_SCROLL);
        if (visible(el)) return el;
      }
      return visible(document.querySelector(SEL.CONV_SCROLL));
    }

    function nextContentRow(rows, i) {
      for (var j = i + 1; j < rows.length; j++) {
        if (!USER_KINDS[rows[j].getAttribute("data-chat-flow-kind")]) return rows[j];
      }
      return null;
    }

    function buildEntries(scope) {
      var rows = Array.prototype.slice.call(scope.querySelectorAll(SEL.ROW));
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!USER_KINDS[row.getAttribute("data-chat-flow-kind")]) continue;
        // innerText 才会跳过被隐藏的内容；jsdom 没实现，退回 textContent
        var raw = row.innerText;
        if (raw == null) raw = row.textContent;
        var text = raw.replace(/\s+/g, " ").trim();
        if (!text || text.length > MAX_TEXT) continue;
        var anchor = row.getAttribute("data-chat-anchor-key") || "";
        var turnEl = row.closest(SEL.TURN);
        var turn = turnEl ? (turnEl.getAttribute("data-chat-turn") || "") : "";
        out.push({
          id: anchor || ("cln-" + i),
          text: text.length > 200 ? text.slice(0, 200) + "…" : text,
          full: text.length > 600 ? text.slice(0, 600) + "…" : text,
          turn: turn,
          row: row,
          target: nextContentRow(rows, i) || row
        });
      }
      return out;
    }

    function Rail() {
      var state = React.useState([]);
      var entries = state[0];
      var setEntries = state[1];
      var activeState = React.useState("");
      var active = activeState[0];
      var setActive = activeState[1];
      var boxState = React.useState(null);
      var box = boxState[0];
      var setBox = boxState[1];
      var listRef = React.useRef(null);
      var scopeRef = React.useRef(null);
      // 搜索：空查询 = 常驻时间轴，非空 = 语义结果
      // asked: 用户按下回车之后才去问；只打字不发请求
      var searchState = React.useState({ q: "", hits: [], busy: false, error: "", asked: false });
      var search = searchState[0];
      var setSearch = searchState[1];
      var qRef = React.useRef("");
      // 每个会话记住自己的搜索：切走再切回来要清空，别把上一个会话的结果留着
      var sessionRef = React.useRef("");
      var entriesRef = React.useRef(entries);
      entriesRef.current = entries;
      var activeRef = React.useRef("");
      activeRef.current = active;

      React.useEffect(function () {
        var disposed = false;
        var mo = null;
        var ro = null;
        var debounce = 0;

        function applyLayout(scope) {
          var r = scope.getBoundingClientRect();
          var w = Math.round(Math.max(LANE_MIN, Math.min(LANE_MAX, r.width * LANE_RATIO)));
          scope.style.setProperty("--cln-rail", w + "px");
          scope.setAttribute("data-chat-lanes", "");
          fitWrappers(scope, r);

          // 底边两道上限：输入框顶边、窗口底边。宁可短也不要溢出——溢出会让左栏内部不再滚动。
          var bottom = r.top + r.height;
          var composer = document.querySelector("[data-composer-seat]");
          if (composer) {
            var cr = composer.getBoundingClientRect();
            if (cr.top > r.top + 40) bottom = Math.min(bottom, cr.top - 6);
          }
          bottom = Math.min(bottom, window.innerHeight - 10);

          var next = {
            left: Math.round(r.left) + 6,
            top: Math.round(r.top) + 6,
            height: Math.max(120, Math.round(bottom - r.top) - 12),
            width: Math.max(120, w - 12)
          };
          setBox(function (prev) {
            if (!prev) return next;
            if (prev.left === next.left && prev.top === next.top && prev.height === next.height && prev.width === next.width) return prev;
            return next;
          });
        }

        // 宿主爱把正文塞进一个 max-width + 居中的包裹里：左栏占走宽度后它又在新宽度里
        // 重新居中，于是正文左边凭空多出一大块留白。这里把"明显窄于容器"的那几层摊平。
        function fitWrappers(scope, scopeRect) {
          var row = scope.querySelector(SEL.ROW);
          if (!row) return;
          var node = row.parentElement;
          while (node && node !== scope) {
            if (node.getBoundingClientRect().width < scopeRect.width - 48) {
              node.style.maxWidth = "none";
              node.style.marginLeft = "0";
              node.style.marginRight = "0";
            }
            node = node.parentElement;
          }
        }

        // 上一次的 scrollTop：用来分辨滚动方向（向上滚要加滞回，见 syncActive）
        var lastTop = -1;

        // list 可传：rescan 里刚扫出来的那份比 entriesRef 新一帧
        function holdActive(id) {
          activeRef.current = id;
          setActive(function (prev) { return prev === id ? prev : id; });
        }

        function syncActive(list) {
          var scope = scopeRef.current;
          list = list || entriesRef.current;
          if (!scope || !list.length) return;
          var sr = scope.getBoundingClientRect();

          // 已经滚到底：直接认最后一条，别管阅读线（流式输出时也可能贴着底）
          var atBottom = scope.scrollHeight - (scope.scrollTop + scope.clientHeight) <= 8;
          if (atBottom) {
            lastTop = scope.scrollTop;
            holdActive(list[list.length - 1].id);
            return;
          }

          // "回复开头在视口里的位置"，往上为正
          function relTop(item) { return item.target.getBoundingClientRect().top - sr.top; }

          var idx = -1;
          for (var i = 0; i < list.length; i++) {
            if (list[i].id === activeRef.current) { idx = i; break; }
          }
          var prevTop = lastTop;
          lastTop = scope.scrollTop;
          var half = sr.height / 2;

          if (idx < 0) {
            // 第一次同步（刚打开会话），或者当前那条已经被宿主换掉了：
            // 兜底按"视口上沿往下 56px 那一行"来认，避免一进来高亮到屏幕中间那条
            for (var j = 0; j < list.length; j++) {
              if (relTop(list[j]) <= 56) idx = j;
            }
          } else if (prevTop >= 0 && scope.scrollTop > prevTop) {
            // 往下滚：上一条的回复整条离开视口（下一条的开头越过视口上沿）才交棒。
            // 用 56px 阅读线时，下一轮的头刚露出来就把还在读的这轮换走了 —— 就是"切换过快"。
            while (idx + 1 < list.length && relTop(list[idx + 1]) <= 0) idx++;
          } else if (prevTop >= 0 && scope.scrollTop < prevTop) {
            // 往上滚：当前这轮的回复开头还在上半屏就按住不动，掉到下半屏才退给上一条
            while (idx > 0 && relTop(list[idx]) > half) idx--;
          }
          holdActive(list[idx].id);
        }

        var marks = [];

        function closeHead(head) {
          head.__cln.panel.hidden = true;
          head.__cln.toggle.textContent = "展开";
          head.__cln.copy.classList.remove("ok");
          head.__cln.copy.title = "复制";
          if (openHead === head) openHead = null;
        }

        function dropHead(row) {
          row.removeAttribute("data-cln-start");
          row.removeAttribute("data-cln-label");
          var head = row.querySelector(".cln-rhead");
          if (head) head.remove();
        }

        // 行头：一行绿底小标签（点开能看完整的那句话，文字可选中、可一键复制）。
        // 幂等 —— 重扫时只在文案变了才动 DOM，否则 MutationObserver 会被自己触发成死循环。
        function roundHead(row, label, full) {
          var head = row.querySelector(".cln-rhead");
          // 宿主可能整体克隆/重建过这一行：DOM 还在，挂在上面的引用没了 —— 当作没有，重来
          if (head && !head.__cln) {
            head.remove();
            head = null;
          }
          if (!head) {
            head = document.createElement("div");
            head.className = "cln-rhead";
            var bar = document.createElement("div");
            bar.className = "cln-rh";
            var text = document.createElement("span");
            text.className = "cln-rl";
            var toggle = document.createElement("span");
            toggle.className = "cln-rb";
            var panel = document.createElement("div");
            panel.className = "cln-rf";
            panel.hidden = true;
            var body = document.createElement("div");
            body.className = "cln-rt";
            var copy = document.createElement("button");
            copy.type = "button";
            copy.className = "cln-rc";
            copy.title = "复制";
            bar.appendChild(text);
            bar.appendChild(toggle);
            panel.appendChild(body);
            panel.appendChild(copy);
            head.appendChild(bar);
            head.appendChild(panel);
            head.__cln = { text: text, toggle: toggle, panel: panel, body: body, copy: copy };
            toggle.textContent = "展开";
            bar.addEventListener("click", function () {
              if (panel.hidden) {
                openHead = head;
                panel.hidden = false;
                toggle.textContent = "收起";
              } else {
                closeHead(head);
              }
            });
            copy.addEventListener("click", function (ev) {
              ev.stopPropagation();
              copy.classList.add("ok");
              copy.title = "已复制";
              if (!navigator.clipboard) return;
              navigator.clipboard.writeText(head.__full);
            });
            row.appendChild(head);
          }
          var parts = head.__cln;
          if (parts.text.textContent !== label) parts.text.textContent = label;
          if (parts.body.textContent !== full) parts.body.textContent = full;
          head.__full = full;
        }

        function markTurns(list) {
          var next = [];
          for (var j = 0; j < list.length; j++) {
            var e = list[j];
            if (e.target === e.row) continue;
            var label = (e.turn ? "第 " + e.turn + " 轮 · " : "") + (e.text.length > 48 ? e.text.slice(0, 48) + "…" : e.text);
            e.target.setAttribute("data-cln-start", "");
            e.target.setAttribute("data-cln-label", label);
            roundHead(e.target, label, e.full);
            next.push(e.target);
            // 行头节点本身要留住：重扫时先拆后建会把"展开"状态一起拆掉
          }
          for (var i = 0; i < marks.length; i++) {
            if (next.indexOf(marks[i]) < 0) dropHead(marks[i]);
          }
          marks = next;
        }

        function rescan() {
          var scope = scopeRef.current;
          // 对话容器整个不见了（切到插件/定时任务这类内置页）：左栏必须跟着消失
          if (disposed || !scope) {
            setEntries([]);
            setBox(null);
            return;
          }
          var holder = scope.closest(SEL.SESSION);
          var sessionId = holder ? holder.getAttribute("data-conversation-session") : "";
          if (sessionId !== sessionRef.current) {
            sessionRef.current = sessionId;
            qRef.current = "";
            setSearch({ q: "", hits: [], busy: false, error: "", asked: false });
          }
          applyLayout(scope);
          var list = buildEntries(scope);
          markTurns(list);
          setEntries(list);
          syncActive(list);
        }

        function bind(scope) {
          scopeRef.current = scope;
          if (mo) mo.disconnect();
          if (!scope) return;
          mo = new MutationObserver(function () {
            if (debounce) return;
            debounce = window.setTimeout(function () { debounce = 0; rescan(); }, 150);
          });
          mo.observe(scope, { childList: true, subtree: true, characterData: true });
        }

        function tick() {
          if (disposed) return;
          var scope = scopeRoot();
          if (scope !== scopeRef.current) {
            bind(scope);
            rescan();
          } else if (scope) {
            applyLayout(scope);
          }
        }

        bind(scopeRoot());
        rescan();

        var onScroll = function () { syncActive(); };
        document.addEventListener("scroll", onScroll, true);
        // 点面板外面任何地方都收起来（capture 阶段先判，别等宿主/React 处理完）
        var onDocClick = function (ev) {
          if (!openHead) return;
          if (openHead.contains(ev.target)) return;
          closeHead(openHead);
        };
        document.addEventListener("click", onDocClick, true);
        window.addEventListener("resize", tick);
        if (window.ResizeObserver && scopeRef.current) {
          ro = new ResizeObserver(function () { tick(); });
          ro.observe(scopeRef.current);
        }
        var iv = window.setInterval(tick, 800);

        // 800ms 的 tick 太重（每次都要量布局），但换页时又不能让左栏多留半秒：
        // 单开一个轻心跳，只判断"对话容器还是不是原来那个"，变了才走完整 tick。
        // 清理时会 clearInterval，所以这里不用再看 disposed
        var watch = window.setInterval(function () {
          if (scopeRoot() !== scopeRef.current) tick();
        }, 250);

        return function () {
          disposed = true;
          document.removeEventListener("scroll", onScroll, true);
          document.removeEventListener("click", onDocClick, true);
          window.removeEventListener("resize", tick);
          window.clearInterval(iv);
          window.clearInterval(watch);
          if (debounce) window.clearTimeout(debounce);
          for (var mi = 0; mi < marks.length; mi++) dropHead(marks[mi]);
          marks = [];
          if (mo) mo.disconnect();
          if (ro) ro.disconnect();
          var s = scopeRef.current;
          if (s) {
            s.removeAttribute("data-chat-lanes");
            s.style.removeProperty("--cln-rail");
            s.style.removeProperty("padding-left");
          }
        };
      }, []);

      // 激活项始终留在左栏可视区（表头在列表外，不需要额外 inset）
      React.useEffect(function () {
        var list = listRef.current;
        if (!list || !active) return;
        var el = list.querySelector('[data-cln-id="' + window.CSS.escape(String(active)) + '"]');
        // 宿主可能在这一帧里换掉了那一行（重扫还没跟上）：没有可跟随的目标就直接收手
        if (!el) return;
        var lr = list.getBoundingClientRect();
        var er = el.getBoundingClientRect();
        if (er.top < lr.top + 4) list.scrollTop -= lr.top - er.top + 8;
        else if (er.bottom > lr.bottom - 4) list.scrollTop += er.bottom - lr.bottom + 8;
      }, [active, entries.length]);

      function jump(entry) {
        var scope = scopeRef.current;
        var target = entry.target;
        var sr = scope.getBoundingClientRect();
        var tr = target.getBoundingClientRect();
        scope.scrollTop = Math.max(0, scope.scrollTop + (tr.top - sr.top) - 12);
        // 跳过去就把高亮交给它，别等滚动事件去猜（往下跳时新位置的开头压在顶上，
        // 交给方向判定反而不切）
        activeRef.current = entry.id;
        setActive(entry.id);
      }

      // 问一次：Host 半负责扩词 → 召回 → 重排，这里只管发请求和展示
      function ask(q) {
        var scope = scopeRef.current;
        var holder = scope.closest(SEL.SESSION);
        var sessionId = holder ? holder.getAttribute("data-conversation-session") : "";
        qRef.current = q;
        if (!sessionId) {
          setSearch({ q: q, hits: [], busy: false, error: "找不到会话 id", asked: true });
          return;
        }
        setSearch({ q: q, hits: [], busy: true, error: "", asked: true });
        window.fetch(SEARCH_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId, query: q })
        }).then(function (res) {
          // 路由没挂上时拿到的是 HTML（会 JSON 解析失败）：说清楚，别笼统报"网络错误"
          return res.json().then(null, function () {
            return {
              ok: false,
              error: res.status === 404 ? "搜索服务没启动，重启 DSH 之后再来" : "搜索服务返回了 " + res.status
            };
          });
        }).then(function (data) {
          if (qRef.current !== q) return;
          if (!data.ok) {
            setSearch({ q: q, hits: [], busy: false, error: data.error || "检索失败", asked: true });
            return;
          }
          setSearch({ q: q, hits: data.hits, busy: false, error: "", asked: true });
        }, function () {
          if (qRef.current !== q) return;
          setSearch({ q: q, hits: [], busy: false, error: "网络错误", asked: true });
        });
      }

      function clearAsk() {
        qRef.current = "";
        setSearch({ q: "", hits: [], busy: false, error: "", asked: false });
      }

      // 只更新输入框里的字，不发请求 —— 搜索由回车触发
      function onQueryInput(ev) {
        var q = ev.target.value;
        if (q.trim() === "") {
          clearAsk();
          return;
        }
        qRef.current = "";
        setSearch({ q: q, hits: [], busy: false, error: "", asked: false });
      }

      function onQueryKey(ev) {
        if (ev.key === "Escape") {
          clearAsk();
          return;
        }
        if (ev.key !== "Enter") return;
        var q = ev.target.value.trim();
        if (q.length < 2) return;
        ask(q);
      }

      // 结果里的轮次可能还没载入（长会话只渲染了最近几轮），那就直说
      function jumpToTurn(turn) {
        var scope = scopeRef.current;
        var turnEl = scope.querySelector('[data-chat-turn="' + window.CSS.escape(String(turn)) + '"]');
        var anchor = turnEl ? turnEl.querySelector(SEL.ROW) : null;
        if (!anchor) {
          setSearch(function (prev) {
            return { q: prev.q, hits: prev.hits, busy: false, error: "第 " + turn + " 轮还没载入", asked: true };
          });
          return;
        }
        var sr = scope.getBoundingClientRect();
        var tr = anchor.getBoundingClientRect();
        scope.scrollTop = Math.max(0, scope.scrollTop + (tr.top - sr.top) - 12);
      }

      function searchItems() {
        if (!search.asked) return [h("div", { key: "idle", className: "cln-note" }, "按回车搜索")];
        if (search.busy) return [h("div", { key: "busy", className: "cln-note" }, "正在理解…")];
        if (search.error) return [h("div", { key: "err", className: "cln-note" }, search.error)];
        if (search.hits.length === 0) return [h("div", { key: "none", className: "cln-note" }, "没找到相关的轮次")];
        return search.hits.map(function (hit) {
          return h("button", {
            key: "hit-" + hit.turn + "-" + hit.seq,
            type: "button",
            className: "cln-hit",
            "data-cln-hit": String(hit.turn),
            onClick: function () { jumpToTurn(hit.turn); }
          },
            h("span", { className: "h" }, "第 " + hit.turn + " 轮"),
            h("span", { className: "s" }, hit.snippet),
            hit.why ? h("span", { className: "w" }, hit.why) : null
          );
        });
      }

      if (!box) return null;

      var items = search.q === "" ? entries.map(function (e) {
        return h("button", {
          key: e.id,
          type: "button",
          "data-cln-id": e.id,
          className: "cln-t" + (e.id === active ? " on" : ""),
          title: e.full,
          onClick: function () { jump(e); }
        },
          h("span", { className: "cln-x" }, e.text),
          h("span", { className: "cln-m" }, e.turn ? "第 " + e.turn + " 轮" : "")
        );
      }) : searchItems();

      return h("div", {
        className: "cln-rail",
        style: { left: box.left + "px", top: box.top + "px", height: box.height + "px", width: box.width + "px" }
      },
        h("div", { className: "cln-hd" },
          h("span", { className: "cln-mag", "aria-hidden": "true" }),
          h("input", {
            className: "cln-q",
            type: "search",
            placeholder: "搜这个会话…",
            value: search.q,
            onChange: onQueryInput,
            onKeyDown: onQueryKey
          }),
          h("span", { className: "cln-n" }, search.q === "" ? entries.length + " 条" : (search.busy ? "…" : search.hits.length + " 条"))
        ),
        h("div", { className: "cln-list", ref: listRef }, items)
      );
    }
    Rail.displayName = "ChatLanesRail";

    function apply(ctx) {
      Array.prototype.forEach.call(document.querySelectorAll('style[data-plugin-css="dsh-chat-lanes"]'), function (el) { el.remove(); });
      var styleEl = document.createElement("style");
      styleEl.setAttribute("data-plugin-css", "dsh-chat-lanes");
      styleEl.textContent = CSS_TEXT;
      document.head.appendChild(styleEl);
      ctx.effect(function () {
        return function () { styleEl.remove(); };
      });

      // 现场诊断：控制台执行 __CLN__.report() 看命中情况
      window.__CLN__ = {
        scope: function () { return scopeRoot(); },
        report: function () {
          var s = scopeRoot();
          if (!s) return { scope: null, note: "找不到 [data-conversation-scroll]" };
          var rows = s.querySelectorAll(SEL.ROW);
          var entries = buildEntries(s);
          var r = s.getBoundingClientRect();
          return {
            scope: { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) },
            rows: rows.length,
            kinds: Array.prototype.map.call(rows, function (x) { return x.getAttribute("data-chat-flow-kind"); }).join(","),
            entries: entries.length,
            first: entries.slice(0, 3).map(function (x) { return x.text; })
          };
        },
        trace: function () {
          function d(el) {
            if (!el || !el.getBoundingClientRect) return "?";
            var r = el.getBoundingClientRect();
            var c = window.getComputedStyle(el);
            var cls = (el.className && String(el.className).trim().split(/\s+/).slice(0, 2).join(".")) || "";
            return [
              el.tagName.toLowerCase() + (cls ? "." + cls : ""),
              "x=" + Math.round(r.left) + " w=" + Math.round(r.width) + " h=" + Math.round(r.height),
              "maxW=" + c.maxWidth, "ml=" + c.marginLeft, "mr=" + c.marginRight,
              "pl=" + c.paddingLeft, "pr=" + c.paddingRight, "pad=" + c.paddingLeft + "/" + c.paddingRight
            ].join(" ");
          }
          var scope = scopeRoot();
          var out = [];
          if (!scope) return "no [data-conversation-scroll]";
          out.push("SCOPE " + d(scope));
          // 从容器往下逐层走到第一条消息行
          var node = scope;
          var guard = 0;
          while (node && guard++ < 12) {
            var next = null;
            for (var i = 0; i < node.children.length; i++) {
              var ch = node.children[i];
              if (ch.querySelector && (ch.matches(SEL.ROW) || ch.querySelector(SEL.ROW))) { next = ch; break; }
            }
            if (!next) break;
            node = next;
            out.push("  " + ">".repeat(guard) + " " + d(node));
            if (node.matches(SEL.ROW)) break;
          }
          var row = scope.querySelector(SEL.ROW);
          if (row) {
            out.push("ROW " + d(row) + " kind=" + row.getAttribute("data-chat-flow-kind"));
            if (row.firstElementChild) out.push("  ROW> " + d(row.firstElementChild));
            if (row.firstElementChild && row.firstElementChild.firstElementChild) {
              out.push("  ROW>> " + d(row.firstElementChild.firstElementChild));
            }
          }
          var composer = document.querySelector("[data-composer-seat]");
          out.push("COMPOSER " + (composer ? d(composer) : "none"));
          var text = out.join("\n");
          console.log(text);
          return text;
        },
        state: function () {
          var scope = scopeRoot();
          var list = document.querySelector(".cln-list");
          var railEl = document.querySelector(".cln-rail");
          var on = document.querySelector(".cln-t.on");
          var vis = null;
          if (on && list) {
            var a = on.getBoundingClientRect();
            var l = list.getBoundingClientRect();
            vis = a.top >= l.top - 1 && a.bottom <= l.bottom + 1;
          }
          var rb = railEl ? railEl.getBoundingClientRect() : null;
          return {
            pane: scope ? { top: Math.round(scope.scrollTop), client: scope.clientHeight, scroll: scope.scrollHeight } : null,
            rail: rb ? { top: Math.round(rb.top), height: Math.round(rb.height), width: Math.round(rb.width) } : null,
            list: list ? { top: Math.round(list.scrollTop), client: list.clientHeight, scroll: list.scrollHeight } : null,
            entries: document.querySelectorAll(".cln-t").length,
            active: on ? on.getAttribute("data-cln-id") : null,
            activeVisible: vis
          };
        },
        copy: function () {
          var t = window.__CLN__.trace();
          if (navigator.clipboard) navigator.clipboard.writeText(t);
          return t;
        }
      };

      var slots = ctx.get("slots");
      if (!slots) return;
      slots.inject("shell.overlay", function () {
        return slots.register({ name: "shell.overlay", id: "chat-lanes" }, function () { return h(Rail); });
      });
    }

    module.exports.inject = ["slots"];
    module.exports.apply = apply;
    return module.exports;
  }
});
