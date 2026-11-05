// Host half: registers the semantic-search route used by the client rail.
// All the logic lives in lib/host.js so it can be tested without a running harness.
import { registerSearch } from "./lib/host.js";

export function apply(ctx) {
  registerSearch(ctx);
}
