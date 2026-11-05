# dsh-chat-lanes

**中文** | [English](README.en.md)

把 DSH 对话窗口切成两列：**我说的常驻左栏，模型的话在右侧单轴流动**。

DSH 的对话里，我说话少、模型说得多，我的话被夹在一屏又一屏的工具调用和长回复之间，翻起来很难找。这个插件把「我说的」抽成左侧一条常驻窄栏，正文只留模型与工具的流动 —— 想看我说过什么，扫一眼左边即可。

## 它做了什么

- **左栏**：本会话里我说过的每一句，一条一行，带「第 N 轮」；点任意一条 → 右侧滚到该轮回复的开头；右侧滚动时左栏自动点亮当前那条，并把它拉进可视区。
- **隐藏行内的用户消息**（`[data-chat-flow-kind="user"|"steering"]`），正文整体右移让出左栏 —— 我的话只有一个入口，不会两处重复。
- **每轮的行头**：回复起点有一枚绿底小标签，写着「第 N 轮 · 我这句的开头」；点开是**完整原句**（可选中、可复制，右上角有一枚复制图标），点面板外面就收起，同一时刻只开一枚。
- **当前轮按方向判定**，不是一条死的阅读线：往下滚时要等下一条的回复开头越过视口上沿才交棒（上一条整条已离开视口），往上滚时当前这条的开头还在上半屏就不动 —— 避免「还在读这一轮就被换走」和「刚露头就切换过快」。
- **滚动到底**直接点亮最新一条；**切到「插件」「定时任务」这类内置页**时左栏自动收摊。
- 只依赖宿主公开的 DOM 契约（`data-conversation-scroll`、`data-chat-flow-kind`、`data-chat-anchor-key`、`data-chat-turn`、`data-composer-seat`），不碰 React 内部、不接管 `conversation.chat.flow` —— 滚动跟随、折叠动画、锚点恢复仍归宿主。

## 会话内搜索（v0.2）

左栏表头常驻一个搜索框，输入关键词或直接问一句话（例：「为什么 max_bid 还会卖出？」），**按回车**后得到按相关度排序的轮次，点一下跳到那一轮的回复。

- 只搜当前会话，我的消息和模型的回复都进候选。
- 走「扩词 → 召回 → 重排」三步，不依赖 embedding；模型不可用时自动退回字面检索（`mode: "lexical"`）。
- 搜索框按会话记忆：切走再切回来，词和结果都还在；换个没搜过的会话就是空的。
- 结果里的轮次如果还没载入（长会话通常只渲染最近几轮），插件会让宿主 `loadThrough` 翻日志再滚过去；翻不到就明说「第 N 轮还没载入」，结果列表保持不动，可以接着点别的。
- 每条结果给一句理由（`why`），方便判断「是词对上了还是意思对上了」。
- 延迟预算约 2.5 秒，所以**只认回车**，不做「停 600ms 自动搜」—— 每敲一个字就起一次模型调用，既慢又贵。

## 安装

```bash
plugin_manager install_bundle target=/path/to/dsh-chat-lanes
```

本地开发时 profile 里记的是 `link:` 指向源码目录，改完刷新窗口即可生效。

与 `dsh-user-message-timeline` 的左缘药丸导轨位置重叠，两个别同时开：

```bash
plugin_manager set_plugin target=include:user-message-timeline enabled=false
```

## 开发

```bash
npm install
npm run check      # 语法检查
npm test           # 105 条行为测试（jsdom，约 1 秒）
npm run coverage   # 带 100% 阈值门禁
```

客户端逻辑（`lib/client.js`）的测试覆盖率必须保持 **行/分支/函数 100%**，规矩写在 [AGENTS.md](AGENTS.md) 里 —— 包括这个仓库踩过的每个坑（`CSS.escape` 被遮蔽、MutationObserver 自触发、`assert.equal` 打印 jsdom 节点会挂死进程……）。

```
index.js            Host 半入口：只调 registerSearch
lib/host.js         Host 半：/api/hellmage/dsh-chat-lanes/search（扩词 → 召回 → 重排）
lib/client.js       Client 半：注入样式 + 左栏 + 搜索框 + 读滚动 + 跳转
cordis.patch.yml    bundle 声明
test/harness.js     jsdom 世界 + 假宿主
test/*.test.js      客户端与 Host 半的行为测试
design/             最初那张三方案对比设计稿，只作参考，不参与构建
```

## 已知限制

- 左栏宽度按面板宽的比例算（18%，夹在 196–288px），还没有配置项；
- 用户消息被整体隐藏，暂无「同时保留行内」的开关；
- 行头的「第 N 轮」依赖宿主的 `data-chat-turn`，没有它会退化成只显示那句我的原话；
- 搜索的重排依赖宿主的 `llm` 服务，模型不可用时结果会退化成字面检索（仍可用，但召回质量下降）。

## License

MIT
