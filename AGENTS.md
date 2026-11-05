# AGENTS.md

给在这个仓库里干活的人（和 agent）看的规矩。**改代码之前先读这一页。**

## 这个项目是什么

`dsh-chat-lanes` 是一个 DSH 客户端插件：把对话窗口切成两列 —— 「我说的」常驻左栏（可点击跳转），模型的话在右侧单轴流动。它**不接管** `conversation.chat.flow`，只在宿主已经渲染好的 DOM 上加一层。

```
index.js            Host 半的入口：只调 lib/host.js 的 registerSearch(ctx)
lib/host.js         Host 半：/api/hellmage/dsh-chat-lanes/search（扩词 → 召回 → 重排）
lib/client.js       Client 半：注入样式 + 常驻左栏 + 搜索框 + 读滚动 + 跳转
cordis.patch.yml    bundle 声明，把插件插进 profile
test/harness.js     jsdom 世界 + 假宿主，约 300 行，是这个项目最贵的资产之一
test/client.test.js 客户端行为测试
test/host.test.js   Host 半测试（假 llm / 假 sessionQuery / 假 webServer）
design/             设计稿（HTML 方案对比），只作参考，不参与构建
```

两半的分工：Host 半跑在 Node 主进程（拿得到 `llm`、`sessionQuery`、`webServer`），
Client 半跑在浏览器（拿得到 DOM、React、slot）。两者只通过一条同源 HTTP 路由通话。

## 硬规则

1. **客户端逻辑必须带测试，覆盖率必须是 100%（行 / 分支 / 函数）。**
   `npm run coverage` 不过就是没做完。这不是"尽量"，是验收条件。

2. **100% 分支覆盖是设计约束，不是装饰。**
   如果你写了一条分支却写不出测试，说明它是死代码 —— 删掉它。v0.1.1 就是靠这条删掉了 5 处"万一呢"的空判断。
   例外是**能写出测试的真实状态**：跟随 effect 里的 `if (!el) return` 留着，因为"宿主把消息行全清掉、列表空了但 active 还指着旧条目"真的会发生，由「跟随：宿主把消息行全清掉时不会崩」守着。

3. **不写吞异常的 `try/catch`。**
   2026-11-05 那次回归（左栏不跟随）就是被一个空 catch 吞掉的：`CSS.escape` 抛了 TypeError，catch 一盖，用户只看到"点了不滚"。要失败就让它响，让测试红。

4. **不要遮蔽全局名。**
   `var CSS = [...]` 遮蔽了 `window.CSS` 而崩，就是这个 bug 的成因。注入的样式文本叫 `CSS_TEXT`。同理别去重新声明 `setTimeout`、`fetch`、`CSS`、`navigator`。

5. **只依赖宿主的 DOM 契约，不碰 React 内部。**
   ```
   [data-conversation-session]   会话外壳
   [data-conversation-scroll]    真正的滚动容器
   [data-chat-flow-kind]         每一行的 kind（user / steering / assistant-step / tool-call …）
   [data-chat-turn]              轮次外壳（用来写"第 N 轮"）
   [data-chat-anchor-key]        稳定锚点（当条目 id 用）
   [data-composer-seat]          输入框座位（左栏底边要在它上面）
   ```
   不要锁 class 名。DSH 0.1.7 曾静默改掉图标的导出名，靠 class 或内部结构写的插件整片判崩。

6. **样式只用 `--dsw-alias-*` 主题变量**（`bg-base`、`label-primary`、`brand-primary`、`border-l1..l4`、`state-*` 等），别写死颜色 —— 深浅色主题都要能看。

7. **两半只通过 HTTP 路由通话。** Host 半 `webServer.register({kind:"exact", path, handler})`，
   Client 半 `fetch` 同源路径；不要在客户端里 require 宿主服务，也不要把 Host 逻辑塞进 client.js。

8. **不接管 `conversation.chat.flow`。** 那是 single + `shadows-shipped-ui` 的槽，接管了就要自己重写滚动跟随、折叠动画、锚点恢复。我们要的东西一个常驻左栏 + 读宿主 `scrollTop` 就够了。

9. **每次改动之后自动提交并推到 origin，不要攒在本地。**
   一个改动做完（代码、测试、文档都算），就立刻提交并推送：
   ```bash
   npm run check && npm test        # 动了 lib/ 还必须 npm run coverage 全绿
   git add <本次改动涉及的路径>      # 显式列路径，别用 git add -A 把无关文件一起卷进来
   git commit -m "fix: 一句话说清症状与根因"
   git push origin main
   ```
   - 提交信息沿用现有风格：`feat:` / `fix:` / `docs:` / `style:`；Host 半的路由与依赖注入用 `host:`，召回相关用 `recall:`。标题写"改了什么"，需要时在 body 里补"为什么"。
   - 测试红了就别提交到 `main`：先修到全绿；确实修不动要停下来，明确告诉用户"没有提交，因为 X"。
   - 远端拒绝（non-fast-forward）就 `git pull --rebase` 再来；任何情况下都不 `push --force`。

## 怎么跑

```bash
npm run check      # 语法检查
npm test           # 105 条行为测试（约 1 秒）
npm run coverage   # 带 100% 阈值门禁，覆盖率不达标直接 exit 1
```

装进 DSH（profile 里是 `link:` 指向本目录，改完刷新页面即可生效）：

```
plugin_manager install_bundle target=/Users/luyun/projects/dsh-chat-lanes
plugin_manager set_plugin     target=include:chat-lanes enabled=false   # 停用
```

`set_plugin` 的 target 必须是 `include:<patch id>`，用裸包名会报 `unknown-plugin`。

## 测试怎么组织的

`test/harness.js` 用 jsdom + react-dom 造一个**单例世界**：假布局（`getBoundingClientRect` 现算）、假定时器（手动推进，测试里不睡觉）、假宿主（`__ModuleLoader__`、`slots`、`ctx.effect` 全部记录）。`createWorld()` 每次都重建 DOM 并卸载上一个 React 根。

### 六个坑（harness 里已经处理，别推翻）

1. **`assert.equal(a, domElement)` 会挂死进程。** 断言失败时 Node 用 `util.inspect` 打印 jsdom 节点，会去遍历巨大的对象图（实测挂 50s 后被 SIGKILL）。一律比较 `data-cln-id` 这类字符串。
2. **上一个世界的 React 根不卸载，act 队列残留会让后续用例永久挂住。** `createWorld()` 开头必须 `await act(() => prev.unmount())`。
3. **`globalThis.navigator` 是只读访问器**，只能 `Object.defineProperty`，直接赋值会抛 `Cannot set property navigator of #<Object> which has only a getter`。
4. **MutationObserver 的回调要等一个宏任务才投递**：改完 DOM 后 `await new Promise((r) => setTimeout(r, 0))`，再 `w.runTimeout()` 推进防抖。
5. **`node --test test/` 会报 `Cannot find module .../test`**，必须传 glob：`"test/*.test.js"`。
6. **`__CLN__.trace()` 里的 `console` 是 Node 全局**，不是 `window.console`。想断言它输出，替换 `console.log`。

### 断言尽量断言"行为"，不要断言"实现"

比如"点第 4 条，右侧滚到它对应的回复"——断言 `scope.scrollTop === 280 - 12`，而不是断言某个内部变量。这样重写实现时测试仍然有意义。

## 搜索（v0.2）

- 入口：左栏表头那个常驻输入框（`搜这个会话…`）。空查询时下面还是时间轴。
- 触发：**只认回车**（少于 2 字不问）；打字只更新输入框、发请求前显示「按回车搜索」；Esc 清空回时间轴。
  曾经做过"停 600ms 自动问"，用户明确否掉了 —— 每敲一个字就起一次 2.5 秒的模型调用，既慢又贵。
- 状态按会话隔离：重扫时比较 `data-conversation-session`，变化时把离开的那个会话的
  `{q, hits, busy, error, asked}` 存进 `bySession`（Map，sessionId → 状态），再把目标会话的状态恢复出来。
  用户要的是"切回来还是上次那个词"，所以是恢复不是清空；没搜过的会话恢复成空。
  恢复时 `busy` 一律置 false（上一个会话挂着的"正在理解…"不属于这个视图），但只打了一半、
  还没回车的那句话要留着 —— 所以 `asked` 也得存。
- Host 半（`lib/host.js`）：`POST /api/hellmage/dsh-chat-lanes/search`，body `{sessionId, query}`。
  1. **扩词**：让模型把问题改写成 3–4 句"对话里可能出现的陈述"，抽成 `terms`（≤10 个）。
     实测：原查询直接字面检索命中率接近 0，同义词扩词几乎没用，改写成句再抽词才有效。
  2. **召回**：每个 term 调一次 `sessionQuery.searchEvents`，`mergeHits` 按"命中词数 → 名次和 → seq"排序取前 24。
  3. **重排**：让模型从候选里挑最多 6 条，给一句 `why`；只保留候选里真有的 turn。
  4. 任何一步失败都退回 `mode:"lexical"`（直接用原查询召回），照样给结果。结果缓存 5 分钟（最多 40 条）。
- Client 半：`qRef` 丢弃过期响应（慢回来的旧结果不许覆盖新查询）；点结果滚到那一轮；
  那一轮如果还没载入（长会话只渲染最近几轮），直说「第 N 轮还没载入」——不假装能跳。
- 延迟预算：改写 0.8–1.2s + 召回 0.1s + 重排 1.2–2s ≈ 2.5s，所以必须"回车才触发"，不能按键就发。
- 没有 embedding：宿主 `llm` 服务只有 `stream()`，没有向量接口。要把召回换成向量检索，
  只需要替换 `runSearch` 里的召回这一层（`searchEvents` → cosine top-k），其余不动。

- **点结果要能落到那一轮**：长会话的 DOM 里只有最近几轮，搜索结果却可能是几十轮以前的。目标行用 `targetOfTurn(turn)` 定：先 `rowOfTurn()` 按"行→`closest([data-chat-turn])`"反查出这一轮里**第一条不是 user/steering** 的行（轮次外壳里的第一行往往是我的话，被 `display:none` 收起来了，rect 是 0×0，拿它去滚等于滚到顶）；没有这样的行就退回外壳本身，但只在外壳 `height > 0` 时才算数，否则当它不在。之前直接 `turnEl.querySelector(SEL.ROW)` 拿到 null 会让 `scrollToRow` 抛 `Cannot read properties of null`。没有就 `ctx.get("sessions").binding(sessionId).session.loadThrough(hit.seq)` 让宿主翻日志，再用 `waitForTurn()`（80ms × 40 次）等它渲染，然后 `scrollToRow()`。翻不到、没有绑定、翻失败，都只改一行提示（`.cln-note`），不要动结果列表 —— 用户要能接着点别的。
- **跳转里三个"别信缓存"**（2026-11-05 用户报"只有第一条能跳"）：
  1. **滚动容器每次现取**：`liveScope()` = `scopeRoot() || scopeRef.current`。宿主翻日志时会换掉 `[data-conversation-scroll]` 节点，缓存的那份上面 `querySelector`/`scrollTop` 全是空转（这正是"第一条能跳、后面都不动"）。
  2. **会话 id 用 `ask()` 当时记下的** `askedSession.current`，不要再从 DOM 里 `closest("[data-conversation-session]")` 找一个可能已经被换掉的壳。
  3. **轮次号统一成数字**：`entries[].turn` 原来存的是 `getAttribute` 的字符串，而命中里的 `turn` 是数字，`!==` 永远成立 → 高亮认领不上。现在 `buildEntries` 里 `Number(...)`，属性缺失记 0。
- **命中列表也有"当前这条"**：`searchItems()` 里 `hit.turn === activeTurn` 的那条加 `on`（白底 + 左侧品牌色竖条），跟左栏 tab 同一套视觉；跳转成功后 `focusTurn(turn)` 把 `activeRef`/`active` 认领过去，所以滚到哪儿、亮点就跟到哪儿。

## 已知行为（改之前先确认不是有意为之）

- **到底判定**：`scrollHeight - (scrollTop + clientHeight) <= 8` 视为到底，直接点亮最后一条。8px 容差是为了流式输出过程中 `scrollHeight` 一直在长高、永远差几像素到不了底。
- **当前轮是按方向判定的，不是一条固定的阅读线**（前后改过两版，最后落在这个形式）：
  - 第一次同步（刚打开会话）或者当前那条已经被宿主换掉：兜底取"回复开头在视口上沿往下 56px 以内"的最后一条 —— 只用于这个兜底，不再参与滚动判定。
  - 往下滚：下一条的回复开头越过**视口上沿**（`relTop <= 0`）才交棒，也就是说上一条整条已经离开视口。用 56px 线时，下一轮的头刚露头就把还在读的这轮换走，用户报的就是"切换过快"。
  - 往上滚：当前这条的回复开头还在**上半屏**（`relTop < sr.height / 2`）就按住不动，掉到下半屏才退给上一条。
  - `lastTop` 记住上一次的 `scrollTop` 只用来判方向；`activeRef` 存当前条目 id，方向判定从它出发做 `while` 步进，所以一次大幅滚动会连着跨过好几条，而不会跳错。
  - 点击跳转由 `jump()` 自己认领高亮（`activeRef.current = entry.id` + `setActive`）：往下跳到新位置时，目标行的开头正好压在视口顶上，交给方向判定反而不切。
- **换页要收摊**：切到「插件」「定时任务」这类内置页时，对话滚动容器会被卸载（或者被藏起来、尺寸归零），两种都得让左栏消失。`scopeRoot()` 只认屏幕上真的有尺寸（>40px）的容器；容器没了就 `setBox(null)`，Rail 返回 null。为此单开一颗 250ms 的轻心跳，只做"容器还是不是原来那个"的比较，变了才走完整的 `tick()`（800ms 那颗太重，每次都要量布局，用它来做换页检测会慢半秒）。
- **每轮的行头是真实 DOM，不是 `::before`**：它得能点开、能把用户原话选中复制，伪元素做不到。`.cln-rhead` 绝对定位进行为它让出的 34px 空白带（`top:9px`），所以不参与宿主那一行的排版 —— 之前用 `::before` 时，宿主行是 flex/行内排版，标签怎么都会压住"正在分析请求…"。
  行头是**幂等**渲染的：`roundHead()` 只在文案变了才写 `textContent`，否则 MutationObserver 会被自己触发成死循环（写相同文本也会算一次 characterData 变更）。同理，宿主整体克隆过节点时（DOM 还在、挂在上面的 `__cln` 没了）要重建，别指望 expando 还在。
  **重扫时不许先拆后建**：`markTurns()` 只为"不再是某一轮起点"的行调 `dropHead()`，还在的行必须原样留着 —— 行头里装着"展开/收起"这种只存在于 DOM 上的状态，拆了重建就等于把它收起来。（点击展开时改按钮文案本身就会招来一次重扫，这条踩过。）
- **行头配色用 `--dsw-alias-state-success-primary` 的浅色混合**（15% 底 / 76% 字），深浅色主题都能看。
- **展开的面板只开一个，点外面就收**：`openHead` 记住当前打开的那一枚；`document` 上挂 capture 阶段的 `click`，目标不在 `openHead` 里就 `closeHead()`（连同"已复制"的图标状态一起复位）。开另一轮时会先收掉前一枚。
- **复制是一枚右上角小图标，不是按钮**：`.cln-rc` 用两个伪元素画叠起来的小方块（不引外部图标包、不吃字形），复制成功加 `.ok` 变绿 —— 不用定时器复位，下次收起/重开时清掉，省掉一个"卸载时还要 clearTimeout"的分支。
- **宿主塞进来的时间戳要剥掉**：『我的话』那一行里除了正文还有一个时间元素（例如 `11月4日 13:00`），它是独立元素、整块就是时间。`cleanText()` 只剥"text 内容完整匹配时间/日期格式"的子元素（`META_ONLY`），而且是从行文本里**最后一次出现**的位置删掉；正文里正常提到 `15:30` 不会被删（那个元素不是纯时间）。真 innerText 会跳过 `display:none` 的内容，那种情况这个元素本来就不在行文本里，`at === -1` 直接跳过。
- **我的话在宿主 DOM 里是被隐藏的行**（插件用 CSS `display:none` 收起来），左栏是它们的唯一入口；所以跳转目标取"其后的第一条非 user 行"，落在模型回复上。
- **左栏跟随**：`active` 变化时把该条滚进左栏可视区（`list.scrollTop` 加减 8px 边距）。
- **正文留白**：宿主把正文包在 `max-width + 居中` 的容器里；左栏占走宽度后它会在新宽度里重新居中，凭空多出一大块左边距。`fitWrappers()` 在每次布局时把「比容器窄 48px 以上」的那几层包裹的 `max-width`/左右 `margin` 摊平（inline style，宿主重建节点后靠 tick 重新补）。测试：「留白：正文被宿主的 max-width 居中包裹时，包裹被摊平」。

## 回归记录

| 症状 | 根因 | 现在由哪条测试守着 |
| --- | --- | --- |
| 长会话向下滚，左栏不跟随 | `var CSS = [...]` 遮蔽 `window.CSS`，`CSS.escape` 抛错被空 catch 吞掉 | 「跟随：激活项始终落在可视区内」 |
| 首屏进入会话不高亮，要滚一下才亮 | `syncActive` 读的 `entriesRef` 比 `setEntries` 落后一帧 | 「左栏：每句我的话一条，带轮次标签，第一条默认选中」 |
| 切到插件/定时任务页，左栏还挂在屏幕上 | 容器消失后没人把 `box` 置空（`rescan` 只在有 scope 时才跑） | 「换页：对话容器消失时左栏跟着消失」 |
| 点行头「展开」，面板闪一下就消失 | 点开时改按钮文案触发 characterData → 150ms 后重扫；`markTurns` 先把所有行头拆掉再重建，展开状态跟着没了 | 「行头：展开之后重扫不会把它收起来」 |
| 点了没反应（上游 `dsh-user-message-timeline` 0.4.4） | `setPointerCapture` 设在根容器上，pointerup/click 被重定向 | 不在本仓库；补丁在 `~/Documents/deepseek-harness/default-workspace/patches/dsh-user-message-timeline/`（`0.4.4-click-jump.patch` + `reapply.sh`） |
