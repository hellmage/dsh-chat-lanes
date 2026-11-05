// Host half of dsh-chat-lanes: the in-conversation semantic search endpoint.
//
// Two model calls, one retrieval call:
//   1. rewrite   — turn "基线这东西到底靠不靠谱" into terms that actually appear in a log
//   2. recall    — the harness's own full-text index (sessionQuery.searchEvents), one call per term
//   3. rerank    — the model picks the turns that really answer the question
//
// Everything here is plain ESM with injected dependencies, so the test harness can drive it
// without a running harness.

export const SEARCH_PATH = "/api/hellmage/dsh-chat-lanes/search";

const MAX_QUERY_CHARS = 200;
const MAX_BODY_BYTES = 8 * 1024;
const PER_TERM_LIMIT = 12;
const MAX_CANDIDATES = 24;
const MAX_HITS = 6;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 40;

/** Trim and bound one user query; returns null when it is not worth a model call. */
export function normalizeQuery(raw) {
  if (typeof raw !== "string") return null;
  var text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 2) return null;
  if (text.length > MAX_QUERY_CHARS) text = text.slice(0, MAX_QUERY_CHARS);
  return text;
}

/** System + user prompt that asks for retrieval terms, not for an answer. */
export function buildRewritePrompt(query) {
  var system = [
    "You help search one long chat log. You do not answer the question.",
    "Rewrite the user's question into 2-4 short statements that would plausibly appear in the log,",
    "then list the concrete terms (identifiers, jargon, Chinese and English variants) a full-text",
    "search should try. Prefer rare, specific words over common ones. Return JSON only:",
    '{"statements":["..."],"terms":["...","..."]}',
    "Up to 10 terms. No prose outside the JSON.",
  ].join(" ");
  var user = "问题：" + query + "\n\n只返回 JSON。";
  return { system: system, user: user };
}

/** Strip markdown fences and pull the first JSON object out of a model reply. */
export function parseModelJson(text) {
  if (typeof text !== "string") return null;
  var cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  var start = cleaned.indexOf("{");
  if (start < 0) return null;
  var depth = 0;
  for (var i = start; i < cleaned.length; i++) {
    var ch = cleaned[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function strings(value, cap) {
  if (!Array.isArray(value)) return [];
  var out = [];
  for (var i = 0; i < value.length && out.length < cap; i++) {
    var item = value[i];
    if (typeof item !== "string") continue;
    var text = item.replace(/\s+/g, " ").trim();
    if (text.length < 2 || text.length > 60) continue;
    if (out.indexOf(text) < 0) out.push(text);
  }
  return out;
}

/** Parse a rewrite reply into search terms; null when nothing usable came back. */
export function parseRewrite(text) {
  var parsed = parseModelJson(text);
  if (parsed === null) return null;
  var terms = strings(parsed.terms, 10);
  if (terms.length === 0) return null;
  return { terms: terms, statements: strings(parsed.statements, 4) };
}

/** Rerank prompt: the model sees snippets, it never sees the whole log. */
export function buildRerankPrompt(query, candidates) {
  var system = [
    "You rank chat-log excerpts for one question. Return JSON only:",
    '{"hits":[{"turn":123,"why":"一句话说明为什么这轮回答了问题"}]}',
    "At most " + MAX_HITS + " hits, best first. Omit excerpts that only mention the topic.",
    'Return {"hits":[]} when nothing really answers the question.',
  ].join(" ");
  var lines = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    lines.push("#" + c.turn + " " + c.snippet);
  }
  var user = "问题：" + query + "\n\n候选摘录：\n" + lines.join("\n");
  return { system: system, user: user };
}

/** Parse a rerank reply, keeping only turns that were actually offered. */
export function parseRerank(text, candidates) {
  var parsed = parseModelJson(text);
  if (parsed === null || !Array.isArray(parsed.hits)) return [];
  var known = {};
  for (var i = 0; i < candidates.length; i++) known[candidates[i].turn] = candidates[i];
  var out = [];
  var seen = {};
  for (var j = 0; j < parsed.hits.length && out.length < MAX_HITS; j++) {
    var hit = parsed.hits[j];
    if (hit === null || typeof hit !== "object") continue;
    var turn = Number(hit.turn);
    var candidate = known[turn];
    if (candidate === undefined || seen[turn]) continue;
    seen[turn] = true;
    out.push({
      turn: turn,
      snippet: candidate.snippet,
      seq: candidate.seq,
      why: typeof hit.why === "string" ? hit.why.slice(0, 120) : "",
    });
  }
  return out;
}

/**
 * Merge per-term retrieval pages into ranked turns.
 * `pageFor(term)` returns `{ items: [{ seq, snippet }], turnOf(seq) }` shaped data.
 */
export function mergeHits(pages) {
  var byTurn = new Map();
  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    var items = page.items;
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var turn = item.turn;
      var entry = byTurn.get(turn);
      if (entry === undefined) {
        entry = { turn: turn, seq: item.seq, snippet: item.snippet, terms: 0, rank: 0 };
        byTurn.set(turn, entry);
      }
      entry.terms += 1;
      entry.rank += 1 / (j + 1);
      if (entry.snippet === "" && item.snippet !== "") entry.snippet = item.snippet;
    }
  }
  var ranked = Array.from(byTurn.values());
  ranked.sort(function (a, b) {
    if (b.terms !== a.terms) return b.terms - a.terms;
    if (b.rank !== a.rank) return b.rank - a.rank;
    return b.seq - a.seq;
  });
  return ranked.slice(0, MAX_CANDIDATES);
}

/** Read a bounded JSON body from a node request. */
export async function readJsonBody(request, limit) {
  var total = 0;
  var chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new Error("body too large");
    chunks.push(chunk);
  }
  var text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};
  return JSON.parse(text);
}

/** One model call → text. Chunks are raw deltas, so we only keep text. */
export async function streamText(llm, options) {
  var text = "";
  var finish = null;
  for await (const chunk of llm.stream(options)) {
    if (chunk.type === "text-delta") text += chunk.text;
    else if (chunk.type === "finish") finish = chunk.reason;
  }
  if (finish !== null && finish.kind !== "stop") {
    throw new Error("model stopped early: " + finish.kind);
  }
  return text;
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function cacheGet(cache, key, now) {
  var entry = cache.get(key);
  if (entry === undefined) return null;
  if (entry.expires <= now) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(cache, key, value, now) {
  if (cache.size >= CACHE_MAX) {
    var oldest = null;
    for (const k of cache.keys()) {
      oldest = k;
      break;
    }
    cache.delete(oldest);
  }
  cache.set(key, { value: value, expires: now + CACHE_TTL_MS });
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

/**
 * Build the POST handler. `deps` carries the live services so tests can drive it:
 * `{ sessionQuery, llm, model, now }`.
 */
export function createHandler(deps) {
  var cache = new Map();

  return async function handle(request, response) {
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" });
      response.end();
      return;
    }

    var body;
    try {
      body = await readJsonBody(request, MAX_BODY_BYTES);
    } catch {
      sendJson(response, 400, { ok: false, error: "invalid body" });
      return;
    }

    var sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    var query = normalizeQuery(body.query);
    if (sessionId === "" || query === null) {
      sendJson(response, 400, { ok: false, error: "sessionId and query are required" });
      return;
    }

    var now = deps.now();
    var key = sessionId + "::" + query;
    var cached = cacheGet(cache, key, now);
    if (cached !== null) {
      sendJson(response, 200, cached);
      return;
    }

    try {
      var payload = await runSearch(deps, sessionId, query);
      if (payload.ok) cacheSet(cache, key, payload, now);
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, { ok: false, error: errorText(error) });
    }
  };
}

async function runSearch(deps, sessionId, query) {
  var started = deps.now();
  var rewrite = null;
  var rewriteError = null;

  if (deps.llm !== undefined) {
    try {
      var prompt = buildRewritePrompt(query);
      var raw = await streamText(deps.llm, {
        provider: deps.model.provider,
        model: deps.model.model,
        messages: [{ role: "user", content: [{ type: "text", text: prompt.user }] }],
        system: prompt.system,
        temperature: 0,
        maxTokens: 400,
      });
      rewrite = parseRewrite(raw);
    } catch (error) {
      rewriteError = errorText(error);
    }
  }

  var mode = rewrite === null ? "lexical" : "semantic";
  var terms = rewrite === null ? [query] : rewrite.terms;

  var pages = [];
  for (var i = 0; i < terms.length; i++) {
    var term = terms[i];
    var page = await deps.sessionQuery.searchEvents({
      sessionId: sessionId,
      query: term,
      filters: [{ kind: "surface", values: ["current"] }],
      limit: PER_TERM_LIMIT,
    });
    var items = [];
    for (var j = 0; j < page.items.length; j++) {
      var hit = page.items[j];
      var turn = await deps.turnOf(sessionId, hit.seq);
      items.push({ turn: turn, seq: hit.seq, snippet: hit.snippet });
    }
    pages.push({ term: term, items: items });
  }

  var candidates = mergeHits(pages);
  var hits = [];

  if (candidates.length > 0 && deps.llm !== undefined && mode === "semantic") {
    var rerankPrompt = buildRerankPrompt(query, candidates);
    var reranked = await streamText(deps.llm, {
      provider: deps.model.provider,
      model: deps.model.model,
      messages: [{ role: "user", content: [{ type: "text", text: rerankPrompt.user }] }],
      system: rerankPrompt.system,
      temperature: 0,
      maxTokens: 600,
    });
    hits = parseRerank(reranked, candidates);
    if (hits.length === 0) {
      hits = candidates.slice(0, 3).map(function (c) {
        return { turn: c.turn, snippet: c.snippet, seq: c.seq, why: "" };
      });
    }
  } else {
    hits = candidates.slice(0, 3).map(function (c) {
      return { turn: c.turn, snippet: c.snippet, seq: c.seq, why: "" };
    });
  }

  return {
    ok: true,
    query: query,
    mode: mode,
    terms: terms,
    statements: rewrite === null ? [] : rewrite.statements,
    rewriteError: rewriteError,
    hits: hits,
    tookMs: deps.now() - started,
  };
}

/** Wire the route into the harness; returns the disposer. */
export function registerSearch(ctx) {
  var sessionQuery = ctx.get("sessionQuery");
  var llm = ctx.get("llm");
  var defaultModel = ctx.get("agentDefaultModel");
  var selection = defaultModel === undefined ? undefined : defaultModel.currentSelection();

  var turns = new Map();

  var handler = createHandler({
    sessionQuery: sessionQuery,
    llm: llm,
    model: selection === undefined ? { provider: "", model: "" } : selection,
    now: function () {
      return Date.now();
    },
    turnOf: async function (sessionId, seq) {
      var map = turns.get(sessionId);
      if (map === undefined) {
        var events = await sessionQuery.listEvents(sessionId);
        map = new Map();
        var turn = 0;
        for (var i = 0; i < events.length; i++) {
          if (events[i].type === "turn/start") turn += 1;
          map.set(events[i].seq, turn);
        }
        turns.set(sessionId, map);
      }
      var found = map.get(seq);
      return found === undefined ? 0 : found;
    },
  });

  return ctx.webServer.register({ kind: "exact", path: SEARCH_PATH, handler: handler });
}
