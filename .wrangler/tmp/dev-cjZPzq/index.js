var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
var SESSION_COOKIE = "session_token";
var SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;
async function pbkdf2(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    256
  );
}
__name(pbkdf2, "pbkdf2");
function bufferToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(bufferToHex, "bufferToHex");
function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
__name(hexToBuffer, "hexToBuffer");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${bufferToHex(salt)}:${bufferToHex(hash)}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  const salt = hexToBuffer(saltHex);
  const hash = await pbkdf2(password, salt);
  return bufferToHex(hash) === hashHex;
}
__name(verifyPassword, "verifyPassword");
function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const cookies = {};
  header.split(";").forEach((pair) => {
    const [k, v] = pair.trim().split("=");
    if (k) cookies[k] = decodeURIComponent(v || "");
  });
  return cookies;
}
__name(parseCookies, "parseCookies");
async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await env.DB.prepare(
    `SELECT u.id, u.username FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();
  return session || null;
}
__name(getSessionUser, "getSessionUser");
function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}
__name(jsonResponse, "jsonResponse");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    if (url.pathname === "/api/ping") {
      const result = await env.DB.prepare("SELECT character, reading_on, reading_kun FROM kanji LIMIT 1").first();
      return jsonResponse({ status: "ok", sample: result });
    }
    if (url.pathname === "/api/questions/challenge") {
      const level = url.searchParams.get("level");
      if (!level) {
        return jsonResponse({ error: "level is required" }, { status: 400 });
      }
      const { results } = await env.DB.prepare(
        `SELECT q.id, q.kanji_id, q.type, q.prompt, q.choices
           FROM questions q
           JOIN kanji k ON q.kanji_id = k.id
           WHERE k.level = ?
           ORDER BY RANDOM()
           LIMIT 10`
      ).bind(Number(level)).all();
      const questions = results.map((row) => ({
        id: row.id,
        kanjiId: row.kanji_id,
        type: row.type,
        prompt: row.prompt,
        choices: row.choices ? JSON.parse(row.choices) : null
      }));
      return jsonResponse({ questions });
    }
    if (url.pathname === "/api/kanji/study") {
      const level = url.searchParams.get("level");
      const q = url.searchParams.get("q");
      let query = "SELECT id, character, level, reading_on, reading_kun, radical, stroke_count, meaning FROM kanji WHERE 1=1";
      const params = [];
      if (level) {
        query += " AND level = ?";
        params.push(Number(level));
      }
      if (q) {
        query += " AND (character LIKE ? OR reading_on LIKE ? OR reading_kun LIKE ?)";
        const like = `%${q}%`;
        params.push(like, like, like);
      }
      query += " ORDER BY id";
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return jsonResponse({ kanji: results });
    }
    if (url.pathname === "/api/auth/register" && method === "POST") {
      const body = await request.json();
      const { username, password } = body;
      if (!username || !password) {
        return jsonResponse({ error: "username and password are required" }, { status: 400 });
      }
      if (password.length < 8) {
        return jsonResponse({ error: "password must be at least 8 characters" }, { status: 400 });
      }
      const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
      if (existing) {
        return jsonResponse({ error: "username already taken" }, { status: 409 });
      }
      const passwordHash = await hashPassword(password);
      await env.DB.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").bind(username, passwordHash).run();
      return jsonResponse({ status: "ok" }, { status: 201 });
    }
    if (url.pathname === "/api/auth/login" && method === "POST") {
      const body = await request.json();
      const { username, password } = body;
      if (!username || !password) {
        return jsonResponse({ error: "username and password are required" }, { status: 400 });
      }
      const user = await env.DB.prepare("SELECT id, password_hash FROM users WHERE username = ?").bind(username).first();
      if (!user || !await verifyPassword(password, user.password_hash)) {
        return jsonResponse({ error: "invalid username or password" }, { status: 401 });
      }
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1e3).toISOString();
      await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user.id, expiresAt).run();
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
      headers.append(
        "Set-Cookie",
        `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION_SECONDS}`
      );
      return new Response(JSON.stringify({ status: "ok" }), { headers });
    }
    if (url.pathname === "/api/auth/logout" && method === "POST") {
      const cookies = parseCookies(request);
      const token = cookies[SESSION_COOKIE];
      if (token) {
        await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      }
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
      headers.append("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      return new Response(JSON.stringify({ status: "ok" }), { headers });
    }
    if (url.pathname === "/api/auth/me") {
      const user = await getSessionUser(request, env);
      return jsonResponse({ user });
    }
    if (url.pathname === "/api/questions/answer" && method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return jsonResponse({ error: "login required" }, { status: 401 });
      }
      const body = await request.json();
      const { questionId, answer } = body;
      if (!questionId || answer === void 0) {
        return jsonResponse({ error: "questionId and answer are required" }, { status: 400 });
      }
      const question = await env.DB.prepare("SELECT correct_answer FROM questions WHERE id = ?").bind(questionId).first();
      if (!question) {
        return jsonResponse({ error: "question not found" }, { status: 404 });
      }
      const isCorrect = question.correct_answer === answer;
      await env.DB.prepare("INSERT INTO attempts (user_id, question_id, is_correct) VALUES (?, ?, ?)").bind(user.id, questionId, isCorrect ? 1 : 0).run();
      return jsonResponse({
        correct: isCorrect,
        correctAnswer: question.correct_answer
      });
    }
    if (url.pathname === "/api/questions/stats") {
      const idsParam = url.searchParams.get("ids");
      if (!idsParam) {
        return jsonResponse({ error: "ids is required" }, { status: 400 });
      }
      const ids = idsParam.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
      if (ids.length === 0) {
        return jsonResponse({ error: "invalid ids" }, { status: 400 });
      }
      const user = await getSessionUser(request, env);
      const placeholders = ids.map(() => "?").join(",");
      const overallRows = await env.DB.prepare(
        `SELECT question_id, AVG(is_correct) AS accuracy, COUNT(*) AS attempts
           FROM attempts
           WHERE question_id IN (${placeholders})
           GROUP BY question_id`
      ).bind(...ids).all();
      const overallMap = new Map(
        overallRows.results.map((r) => [r.question_id, r])
      );
      let userMap = /* @__PURE__ */ new Map();
      if (user) {
        const userRows = await env.DB.prepare(
          `SELECT question_id, AVG(is_correct) AS accuracy, COUNT(*) AS attempts
             FROM attempts
             WHERE user_id = ? AND question_id IN (${placeholders})
             GROUP BY question_id`
        ).bind(user.id, ...ids).all();
        userMap = new Map(userRows.results.map((r) => [r.question_id, r]));
      }
      const stats = ids.map((id) => ({
        questionId: id,
        overallAccuracy: overallMap.get(id)?.accuracy ?? null,
        overallAttempts: overallMap.get(id)?.attempts ?? 0,
        userAccuracy: userMap.get(id)?.accuracy ?? null,
        userAttempts: userMap.get(id)?.attempts ?? 0
      }));
      return jsonResponse({ stats });
    }
    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// .wrangler/tmp/bundle-WACL6J/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-WACL6J/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
