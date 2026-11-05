import test from "node:test";
import assert from "node:assert/strict";

import {
  SEARCH_PATH,
  normalizeQuery,
  buildRewritePrompt,
  parseModelJson,
  parseRewrite,
  buildRerankPrompt,
  parseRerank,
  mergeHits,
  readJsonBody,
  streamText,
  createHandler,
  registerSearch,
} from "../lib/host.js";

function body(text) {
  return (async function* () {
    if (text !== "") yield Buffer.from(text, "utf8");
  })();
}

function iterable(text) {
  return body(text)[Symbol.asyncIterator]();
}

function postRequest(text) {
  return { method: "POST", [Symbol.asyncIterator]: () => iterable(text) };
}

function fakeResponse() {
  var out = { status: 0, headers: null, body: "" };
  out.writeHead = function (status, headers) {
    out.status = status;
    out.headers = headers || null;
  };
  out.end = function (chunk) {
    if (chunk !== undefined) out.body += chunk;
  };
  return out;
}

// One rewrite call, then one rerank call, forever: every request gets a usable reply,
// so cache behaviour is what the test measures.
function fakeLlm(rewrite, rerank) {
  var calls = [];
  return {
    calls: calls,
    stream: function (options) {
      calls.push(options);
      var reply = calls.length % 2 === 1 ? rewrite : rerank;
      return (async function* () {
        if (reply instanceof Error) throw reply;
        yield { type: "text-delta", index: 0, text: reply.slice(0, 2) };
        yield { type: "text-delta", index: 0, text: reply.slice(2) };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  };
}

function fakeQuery(pages) {
  var calls = [];
  return {
    calls: calls,
    searchEvents: async function (request) {
      calls.push(request);
      var page = pages[request.query];
      if (page instanceof Error) throw page;
      return { items: page || [] };
    },
  };
}

function hits() {
  return function hit(seq, snippet) {
    return { sessionId: "s1", seq: seq, type: "assistant/message", time: 1, surface: "current", snippet: snippet };
  };
}

test("normalizeQuery: bounds and trims", () => {
  assert.equal(normalizeQuery(undefined), null);
  assert.equal(normalizeQuery(42), null);
  assert.equal(normalizeQuery("  a "), null);
  assert.equal(normalizeQuery("  基线   靠不靠谱  "), "基线 靠不靠谱");
  var long = "问".repeat(400);
  assert.equal(normalizeQuery(long).length, 200);
});

test("buildRewritePrompt: asks for terms, not an answer", () => {
  var prompt = buildRewritePrompt("手续费怎么算");
  assert.match(prompt.system, /do not answer the question/);
  assert.match(prompt.user, /手续费怎么算/);
});

test("parseModelJson: fences, prose around the object, broken json", () => {
  assert.equal(parseModelJson(null), null);
  assert.equal(parseModelJson("no braces here"), null);
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('前言 {"a":{"b":2}} 后记'), { a: { b: 2 } });
  assert.equal(parseModelJson('{"a":1'), null);
  assert.equal(parseModelJson('{"a": oops}'), null);
});

test("parseRewrite: keeps usable terms only", () => {
  assert.equal(parseRewrite("nothing"), null);
  assert.equal(parseRewrite('{"terms":[]}'), null);
  assert.equal(parseRewrite('{"terms":"nope"}'), null);
  var parsed = parseRewrite(
    '{"statements":["a 陈述","",42],"terms":["手续费 口径","x","手续费 口径","很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很很"]}',
  );
  assert.deepEqual(parsed.terms, ["手续费 口径"]);
  assert.deepEqual(parsed.statements, ["a 陈述"]);
});

test("buildRerankPrompt: numbered candidates", () => {
  var prompt = buildRerankPrompt("问题", [
    { turn: 3, snippet: "甲" },
    { turn: 9, snippet: "乙" },
  ]);
  assert.match(prompt.user, /#3 甲/);
  assert.match(prompt.user, /#9 乙/);
});

test("parseRerank: only offered turns, deduped, capped", () => {
  var candidates = [
    { turn: 3, snippet: "甲", seq: 30 },
    { turn: 9, snippet: "乙", seq: 90 },
  ];
  assert.deepEqual(parseRerank("nope", candidates), []);
  assert.deepEqual(parseRerank('{"hits":"x"}', candidates), []);
  var parsed = parseRerank(
    '{"hits":[null,{"turn":77},{"turn":9,"why":"这一轮给了口径"},{"turn":9},{"turn":3,"why":5}]}',
    candidates,
  );
  assert.deepEqual(parsed, [
    { turn: 9, snippet: "乙", seq: 90, why: "这一轮给了口径" },
    { turn: 3, snippet: "甲", seq: 30, why: "" },
  ]);
});

test("mergeHits: ranks by term coverage, then rank, then recency", () => {
  var merged = mergeHits([
    {
      items: [
        { turn: 5, seq: 50, snippet: "" },
        { turn: 7, seq: 70, snippet: "七" },
      ],
    },
    {
      items: [
        { turn: 7, seq: 70, snippet: "" },
        { turn: 5, seq: 50, snippet: "五" },
      ],
    },
  ]);
  assert.deepEqual(
    merged.map(function (m) {
      return m.turn;
    }),
    [7, 5],
  );
  assert.equal(merged[0].snippet, "七");
  assert.equal(merged[1].snippet, "五");
});

test("mergeHits: more matching terms outranks a better single rank", () => {
  var merged = mergeHits([
    { items: [{ turn: 1, seq: 10, snippet: "一" }] },
    { items: [{ turn: 1, seq: 10, snippet: "" }, { turn: 2, seq: 20, snippet: "二" }] },
  ]);
  assert.deepEqual(
    merged.map(function (m) {
      return m.turn;
    }),
    [1, 2],
  );
});

test("mergeHits: caps candidates", () => {
  var items = [];
  for (var i = 0; i < 40; i++) items.push({ turn: i, seq: i, snippet: "s" + i });
  assert.equal(mergeHits([{ items: items }]).length, 24);
});

test("readJsonBody: parses, accepts empty, rejects oversize", async () => {
  assert.deepEqual(await readJsonBody(body('{"a":1}'), 100), { a: 1 });
  assert.deepEqual(await readJsonBody(body(""), 100), {});
  await assert.rejects(() => readJsonBody(body("x".repeat(64)), 16), /body too large/);
});

test("streamText: concatenates deltas, refuses early finish", async () => {
  var llm = fakeLlm('{"terms":["a"]}', '{"hits":[]}');
  assert.equal(await streamText(llm, {}), '{"terms":["a"]}');

  var aborted = {
    stream: function () {
      return (async function* () {
        yield { type: "text-delta", index: 0, text: "半" };
        yield { type: "finish", reason: { kind: "max-tokens" } };
      })();
    },
  };
  await assert.rejects(() => streamText(aborted, {}), /stopped early: max-tokens/);

  var noFinish = {
    stream: function () {
      return (async function* () {
        yield { type: "text-delta", index: 0, text: "整" };
      })();
    },
  };
  assert.equal(await streamText(noFinish, {}), "整");
});

function makeDeps(overrides) {
  var now = overrides && typeof overrides.now === "number" ? overrides.now : 1000;
  var hit = hits();
  var deps = {
    llm: fakeLlm(
      (overrides && overrides.rewrite) || '{"terms":["手续费"]}',
      (overrides && overrides.rerank) || '{"hits":[{"turn":3,"why":"命中"}]}',
    ),
    sessionQuery: fakeQuery({
      手续费: [hit(30, "手续费按 2 倍算")],
      口径: [hit(90, "口径不一致")],
    }),
    model: { provider: "p1", model: "m1" },
    now: function () {
      return now;
    },
    turnOf: async function (sessionId, seq) {
      return seq === 30 ? 3 : 9;
    },
  };
  return deps;
}

test("handler: method, body and required fields", async () => {
  var handler = createHandler(makeDeps({}));

  var res = fakeResponse();
  await handler({ method: "GET" }, res);
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, "POST");

  res = fakeResponse();
  await handler(postRequest("not json"), res);
  assert.equal(res.status, 400);

  res = fakeResponse();
  await handler(postRequest('{"query":"手续费"}'), res);
  assert.equal(res.status, 400);

  res = fakeResponse();
  await handler(postRequest('{"sessionId":"s1","query":" "}'), res);
  assert.equal(res.status, 400);
  assert.match(res.body, /sessionId and query/);
});

test("handler: semantic path rewrites, recalls and reranks, then caches", async () => {
  var deps = makeDeps({
    rewrite: '{"statements":["手续费怎么算"],"terms":["手续费","口径"]}',
    rerank: '{"hits":[{"turn":9,"why":"口径不同"},{"turn":3,"why":""}]}',
  });
  var handler = createHandler(deps);

  var res = fakeResponse();
  await handler(
    postRequest('{"sessionId":"s1","query":"手续费怎么算"}'),
    res,
  );
  assert.equal(res.status, 200);
  var payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "semantic");
  assert.deepEqual(payload.terms, ["手续费", "口径"]);
  assert.equal(payload.hits.length, 2);
  assert.equal(payload.hits[0].turn, 9);
  assert.equal(payload.hits[0].why, "口径不同");

  assert.equal(deps.sessionQuery.calls.length, 2);
  assert.equal(deps.sessionQuery.calls[0].filters[0].values[0], "current");

  // second identical query is served from cache: no new retrieval
  var res2 = fakeResponse();
  await handler(
    postRequest('{"sessionId":"s1","query":"手续费怎么算"}'),
    res2,
  );
  assert.equal(deps.sessionQuery.calls.length, 2);
  assert.deepEqual(JSON.parse(res2.body), payload);
});

test("handler: lexical fallback when the model is absent, broken or useless", async () => {
  var deps = makeDeps({});
  deps.llm = undefined;
  var res = fakeResponse();
  await createHandler(deps)(
    postRequest('{"sessionId":"s1","query":"手续费"}'),
    res,
  );
  var payload = JSON.parse(res.body);
  assert.equal(payload.mode, "lexical");
  assert.deepEqual(payload.terms, ["手续费"]);
  assert.equal(payload.statements.length, 0);
  assert.equal(payload.hits[0].why, "");

  var throwing = makeDeps({});
  throwing.llm = {
    stream: function () {
      return (async function* () {
        throw new Error("provider down");
      })();
    },
  };
  res = fakeResponse();
  await createHandler(throwing)(
    postRequest('{"sessionId":"s1","query":"手续费"}'),
    res,
  );
  payload = JSON.parse(res.body);
  assert.equal(payload.mode, "lexical");
  assert.equal(payload.rewriteError, "provider down");

  var gibberish = makeDeps({ rewrite: "不知道", rerank: '{"hits":[]}' });
  res = fakeResponse();
  await createHandler(gibberish)(
    postRequest('{"sessionId":"s1","query":"手续费"}'),
    res,
  );
  payload = JSON.parse(res.body);
  assert.equal(payload.mode, "lexical");
});

test("handler: empty rerank falls back to the recall order", async () => {
  var deps = makeDeps({ rewrite: '{"terms":["手续费","口径"]}', rerank: '{"hits":[]}' });
  var res = fakeResponse();
  await createHandler(deps)(
    postRequest('{"sessionId":"s1","query":"手续费怎么算"}'),
    res,
  );
  var payload = JSON.parse(res.body);
  assert.equal(payload.mode, "semantic");
  assert.equal(payload.hits.length, 2);
  assert.equal(payload.hits[0].why, "");
});

test("handler: a thrown non-Error still becomes a readable message", async () => {
  var deps = makeDeps({ rewrite: '{"terms":["手续费"]}' });
  deps.sessionQuery = {
    searchEvents: async function () {
      throw "索引没建好";
    },
  };
  var res = fakeResponse();
  await createHandler(deps)(postRequest('{"sessionId":"s1","query":"手续费"}'), res);
  assert.equal(res.status, 500);
  assert.equal(JSON.parse(res.body).error, "索引没建好");
});

test("handler: a rewrite call that throws a string is reported verbatim", async () => {
  var deps = makeDeps({});
  deps.llm = {
    stream: function () {
      return (async function* () {
        throw "quota";
      })();
    },
  };
  var res = fakeResponse();
  await createHandler(deps)(postRequest('{"sessionId":"s1","query":"手续费"}'), res);
  var payload = JSON.parse(res.body);
  assert.equal(payload.mode, "lexical");
  assert.equal(payload.rewriteError, "quota");
});

test("handler: retrieval failure is a 500, not a silent empty list", async () => {
  var deps = makeDeps({ rewrite: '{"terms":["手续费"]}' });
  deps.sessionQuery = fakeQuery({ 手续费: new Error("index unavailable") });
  var res = fakeResponse();
  await createHandler(deps)(
    postRequest('{"sessionId":"s1","query":"手续费"}'),
    res,
  );
  assert.equal(res.status, 500);
  assert.match(JSON.parse(res.body).error, /index unavailable/);
});

test("handler: cache expires and evicts the oldest entry", async () => {
  var clock = { now: 0 };
  var deps = makeDeps({ rewrite: '{"terms":["手续费"]}' });
  deps.now = function () {
    return clock.now;
  };
  var handler = createHandler(deps);
  var post = function (query) {
    var text = JSON.stringify({ sessionId: "s1", query: query });
    return handler(postRequest(text), fakeResponse());
  };

  var first = fakeResponse();
  var text = JSON.stringify({ sessionId: "s1", query: "q one" });
  await handler(postRequest(text), first);
  assert.equal(first.status, 200);
  assert.equal(deps.sessionQuery.calls.length, 1);

  clock.now = 5 * 60 * 1000 + 1;
  await post("q one");
  assert.equal(deps.sessionQuery.calls.length, 2);

  for (var i = 0; i < 40; i++) await post("q" + i);
  var before = deps.sessionQuery.calls.length;
  await post("q one");
  assert.equal(deps.sessionQuery.calls.length, before + 1);
});

test("registerSearch: builds turns from the log, caches per session, wires the route", async () => {
  var registered = [];
  var listCalls = 0;
  var ctx = {
    get: function (name) {
      if (name === "sessionQuery") {
        return {
          searchEvents: async function () {
            return {
              items: [
                { seq: 4, snippet: "第一条" },
                { seq: 8, snippet: "第二条" },
                { seq: 99, snippet: "尽头" },
              ],
            };
          },
          listEvents: async function () {
            listCalls += 1;
            return [
              { seq: 1, type: "turn/start" },
              { seq: 4, type: "assistant/message" },
              { seq: 6, type: "turn/start" },
              { seq: 8, type: "assistant/message" },
            ];
          },
        };
      }
      if (name === "llm") return undefined;
      if (name === "agentDefaultModel") return { currentSelection: function () { return { provider: "p1", model: "m1" }; } };
      return undefined;
    },
    webServer: {
      register: function (route) {
        registered.push(route);
        return function () {};
      },
    },
  };

  registerSearch(ctx);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].kind, "exact");
  assert.equal(registered[0].path, SEARCH_PATH);

  var res = fakeResponse();
  var text = JSON.stringify({ sessionId: "s1", query: "手续费" });
  await registered[0].handler(
    postRequest(text),
    res,
  );
  var payload = JSON.parse(res.body);
  assert.equal(payload.mode, "lexical");
  assert.deepEqual(
    payload.hits.map(function (h) {
      return h.turn;
    }),
    [1, 2, 0],
  );
  assert.equal(listCalls, 1);

  await registered[0].handler(
    postRequest(JSON.stringify({ sessionId: "s1", query: "又一次" })),
    fakeResponse(),
  );
  assert.equal(listCalls, 1);
});

test("registerSearch: works when no default model service is mounted", async () => {
  var registered = [];
  var ctx = {
    get: function (name) {
      if (name === "sessionQuery") {
        return {
          searchEvents: async function () {
            return { items: [] };
          },
          listEvents: async function () {
            return [];
          },
        };
      }
      return undefined;
    },
    webServer: {
      register: function (route) {
        registered.push(route);
        return function () {};
      },
    },
  };
  registerSearch(ctx);
  var res = fakeResponse();
  var text = JSON.stringify({ sessionId: "s1", query: "手续费" });
  await registered[0].handler(
    postRequest(text),
    res,
  );
  assert.equal(JSON.parse(res.body).hits.length, 0);
});

test("registerSearch: webServer 没注入时直接抛错，不要静默不注册", () => {
  assert.throws(
    () => registerSearch({ get: () => undefined, webServer: undefined }),
    /webServer 服务不可用/
  );
});

test("registerSearch: 正常把 exact 路由注册到 /api/hellmage/dsh-chat-lanes/search", () => {
  const calls = [];
  const off = () => {};
  const ctx = {
    get: (name) => (name === "webServer" ? { register: (opts) => { calls.push(opts); return off; } } : undefined),
    webServer: { register: (opts) => { calls.push(opts); return off; } }
  };
  assert.equal(registerSearch(ctx), off);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "exact");
  assert.equal(calls[0].path, "/api/hellmage/dsh-chat-lanes/search");
  assert.equal(typeof calls[0].handler, "function");
});
