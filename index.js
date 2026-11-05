// Host half: registers the semantic-search route used by the client rail.
// All the logic lives in lib/host.js so it can be tested without a running harness.
import { registerSearch } from "./lib/host.js";

export const name = "dsh-chat-lanes";

// 声明的服务会在 apply 之前就绪；不声明的话 ctx.webServer 是 undefined，
// apply 会直接抛 TypeError —— 那样整条路由都不会挂上（客户端只会看到 404）。
export const inject = ["webServer", "sessionQuery"];

export function apply(ctx) {
  // 必须走 ctx.effect：插件被停用/重载时要回收这条路由，
  // 否则再启用会撞上 "duplicate exact route"（webServer 按 (kind, path) 去重）。
  ctx.effect(() => registerSearch(ctx));
}
