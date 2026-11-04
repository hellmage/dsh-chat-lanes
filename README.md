# dsh-chat-lanes

把 DSH 对话窗口切成两列：**我的话常驻左栏，模型的话在右侧单轴流动**。

DSH 的对话里，我说话少、模型说得多，我的话被夹在一屏又一屏的工具调用和长回复之间，翻起来很难找。这个插件把「我说的」抽成左侧一条常驻窄栏，正文只留模型与工具的流动 —— 想看我说过什么，扫一眼左边即可。

## 它做了什么

- **左栏**：本会话里我说过的每一句，一条一行，带「第 N 轮 · 时间」；点任意一条 → 右侧滚到该轮回复的开头；右侧滚动时左栏自动点亮当前那条并把它拉进可视区。
- **隐藏行内的用户消息**（`[data-chat-flow-kind="user"|"steering"]`），正文整体右移让出左栏 —— 我的话只有一个入口，不会两处重复。
- **每轮的行头**：回复起点有一枚绿底小标签，写着「第 N 轮 · 我这句的开头」；点开是**完整原句**（可选中、可复制，右上角有一枚复制图标），点面板外面就收起。
- **当前轮按方向判定**，不是一条死的阅读线：往下滚时要等下一条的回复开头越过视口上沿才交棒（上一条整条已离开视口），往上滚时当前这条的开头还在上半屏就不动 —— 避免「还在读这一轮就被换走」和「刚露头就切换过快」。
- **滚动到底**直接点亮最新一条；**切到「插件」「定时任务」这类内置页**时左栏自动收摊。
- 只依赖宿主公开的 DOM 契约（`data-conversation-scroll`、`data-chat-flow-kind`、`data-chat-anchor-key`、`data-chat-turn`、`data-composer-seat`），不碰 React 内部、不接管 `conversation.chat.flow` —— 滚动跟随、折叠动画、锚点恢复仍归宿主。

## 装

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
npm test           # 57 条行为测试（jsdom，约 1 秒）
npm run coverage   # 带 100% 阈值门禁
```

客户端逻辑（`lib/client.js`）的测试覆盖率必须保持 **行/分支/函数 100%**，规矩写在 [AGENTS.md](AGENTS.md) 里 —— 包括这个仓库踩过的每个坑（`CSS.escape` 被遮蔽、MutationObserver 自触发、`assert.equal` 打印 jsdom 节点会挂死进程……）。

`design/` 是最初那张三方案对比设计稿，只作参考，不参与构建。

## 已知限制

- 左栏宽度按面板宽的比例算（18%，夹在 196–288px），还没有配置项；
- 用户消息被整体隐藏，暂无「同时保留行内」的开关；
- 行头的「第 N 轮」依赖宿主的 `data-chat-turn`，没有它会退化成只显示那句我的原话。

## License

MIT
