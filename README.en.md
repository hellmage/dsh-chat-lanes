# dsh-chat-lanes

[中文](README.md) | **English**

Splits the DSH conversation window into two columns: **everything I said stays pinned in a left rail, while the model's replies flow in a single column on the right**.

In a DSH conversation I speak rarely and the model talks a lot, so my messages end up buried between screen after screen of tool calls and long replies and are hard to find. This plugin pulls "what I said" out into a narrow persistent rail on the left and leaves only the model/tool flow in the main column — one glance left, and you know what you asked.

## What it does

- **Left rail**: every message I sent in this conversation, one line each, labelled "turn N"; clicking any of them scrolls the reply side to the start of that turn's answer, and scrolling the reply side highlights the current entry and scrolls it into view inside the rail.
- **Inline user messages are hidden** (`[data-chat-flow-kind="user"|"steering"]`) and the body shifts right to make room for the rail — my messages have exactly one entry point instead of appearing twice.
- **A per-turn header**: each reply starts with a small green label reading "turn N · the beginning of my message"; clicking it opens the **full original message** (selectable and copyable, with a copy icon in the top-right corner). Clicking outside closes it, and only one panel is open at a time.
- **The active turn is chosen by scroll direction**, not by a fixed reading line: scrolling down hands the highlight over only once the next reply's top crosses above the viewport (the previous turn has fully left the viewport); scrolling up keeps the current turn as long as its start is still in the upper half of the screen — avoiding both "switched away while I was still reading" and "switched too eagerly as soon as it peeks in".
- **Scrolled to the bottom** highlights the newest entry immediately; **switching to built-in pages** such as Plugins or Scheduled Tasks folds the rail away.
- Only relies on the host's public DOM contract (`data-conversation-scroll`, `data-chat-flow-kind`, `data-chat-anchor-key`, `data-chat-turn`, `data-composer-seat`). It does not touch React internals and does not take over `conversation.chat.flow` — scroll following, collapse animations and anchor restoration stay with the host.

## In-conversation search (v0.2)

The rail header hosts a persistent search box: type keywords or just ask a question in plain language (e.g. "why did it still sell even though max_bid was set?") and **press Enter** to get turns ranked by relevance; click one to jump to that turn's reply.

- Searches the current conversation only; both my messages and the model's replies are candidates.
- Runs "rewrite → recall → rerank" in three steps with no embeddings; when the model is unavailable it falls back to literal lexical retrieval (`mode: "lexical"`).
- The search box is remembered per session: switch away and back, and the query and results are still there; a session you never searched in stays empty.
- If a result's turn isn't loaded yet (long conversations usually render only the last few turns), the plugin asks the host to `loadThrough` the log and then scrolls there. If that fails it says "turn N is not loaded yet" and leaves the result list untouched so you can keep clicking others.
- Each result carries a one-line `why`, so you can tell whether the words matched or the meaning did.
- The latency budget is about 2.5 s, which is why search **only fires on Enter** — there is deliberately no "search 600 ms after you stop typing", because that would start a model call for every keystroke: slow and expensive.

## Install

```bash
plugin_manager install_bundle target=/path/to/dsh-chat-lanes
```

During local development the profile records a `link:` to the source directory; refresh the window to pick up changes.

Its left-edge rail overlaps the pill rail of `dsh-user-message-timeline`, so don't run both:

```bash
plugin_manager set_plugin target=include:user-message-timeline enabled=false
```

## Development

```bash
npm install
npm run check      # syntax check
npm test           # 105 behaviour tests (jsdom, ~1 s)
npm run coverage   # gated at 100%
```

Test coverage for the client logic (`lib/client.js`) must stay at **100% lines / branches / functions**. The rules live in [AGENTS.md](AGENTS.md), including every pit this repo has stepped in (`CSS.escape` being shadowed, MutationObserver self-triggering, `assert.equal` on a jsdom node hanging the process…).

```
index.js            Host entry: just calls registerSearch
lib/host.js         Host half: /api/hellmage/dsh-chat-lanes/search (rewrite → recall → rerank)
lib/client.js       Client half: style injection + rail + search box + scroll reading + jumps
cordis.patch.yml    bundle declaration
test/harness.js     jsdom world + fake host
test/*.test.js      behaviour tests for the client and host halves
design/             the original three-way design comparison; reference only, not built
```

## Known limitations

- Rail width is a ratio of the panel width (18%, clamped to 196–288 px); there is no setting yet.
- User messages are hidden entirely; there's no "keep them inline as well" toggle yet.
- The "turn N" label depends on the host's `data-chat-turn`; without it the header degrades to just showing my message.
- Reranking depends on the host `llm` service; when the model is unavailable results degrade to lexical retrieval (still usable, but with weaker recall).

## License

MIT
