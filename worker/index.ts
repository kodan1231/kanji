export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface SessionUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

interface TagRef {
  id: number;
  name: string;
}

const SESSION_COOKIE = "session_token";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30日

// スパイス難易度 → 正答率レンジ（意図的に隣接帯とオーバーラップさせている）
const SPICE_RANGES: Record<string, [number, number]> = {
  mild: [0.65, 1.01],
  medium: [0.5, 0.8],
  hot: [0.35, 0.65],
  veryhot: [0.2, 0.5],
  extreme: [0, 0.35],
};

async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
}

function bufferToHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${bufferToHex(salt)}:${bufferToHex(hash)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  const salt = hexToBuffer(saltHex);
  const hash = await pbkdf2(password, salt);
  return bufferToHex(hash) === hashHex;
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const cookies: Record<string, string> = {};
  header.split(";").forEach((pair) => {
    const [k, v] = pair.trim().split("=");
    if (k) cookies[k] = decodeURIComponent(v || "");
  });
  return cookies;
}

async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await env.DB
    .prepare(
      `SELECT u.id, u.username, u.is_admin FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .bind(token)
    .first<{ id: number; username: string; is_admin: number }>();

  if (!session) return null;
  return { id: session.id, username: session.username, isAdmin: session.is_admin === 1 };
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function kataToHira(s: string): string {
  let result = "";
  for (const c of s) {
    const code = c.codePointAt(0) ?? 0;
    if (code >= 0x30a1 && code <= 0x30f6) {
      result += String.fromCodePoint(code - 0x60);
    } else {
      result += c;
    }
  }
  return result;
}

function readingVariants(on: string | null, kun: string | null): string[] {
  const variants: string[] = [];
  if (kun) {
    for (const part of kun.split("・")) {
      const base = kataToHira(part.split("(")[0].trim());
      if (base && !variants.includes(base)) variants.push(base);
    }
  }
  if (on) {
    for (const part of on.split("・")) {
      const hira = kataToHira(part).trim();
      if (hira && !variants.includes(hira)) variants.push(hira);
    }
  }
  return variants;
}

function analyzeKun(kun: string | null): { base: string; okuri: string; full: string; hasOkuri: boolean } | null {
  if (!kun) return null;
  const first = kataToHira(kun.split("・")[0]);
  const parenIndex = first.indexOf("(");
  if (parenIndex >= 0) {
    const base = first.slice(0, parenIndex);
    const rest = first.slice(parenIndex + 1);
    const okuri = rest.split(")")[0];
    return { base, okuri, full: base + okuri, hasOkuri: true };
  }
  return { base: first, okuri: "", full: first, hasOkuri: false };
}

// 音読み・訓読みから「読み問題」を自動生成する。読みが1つも無ければnullを返す。
function buildReadingQuestion(
  character: string,
  readingOn: string | null,
  readingKun: string | null
): { prompt: string; correctAnswer: string; acceptedAnswers: string[] } | null {
  const kunInfo = analyzeKun(readingKun);
  let displayChar: string;
  let correct: string;
  let accepted: string[];

  if (kunInfo && kunInfo.hasOkuri) {
    displayChar = character + kunInfo.okuri;
    correct = kunInfo.full;
    accepted = [correct];
  } else {
    displayChar = character;
    if (kunInfo) {
      correct = kunInfo.base;
    } else if (readingOn) {
      correct = kataToHira(readingOn.split("・")[0]);
    } else {
      correct = "";
    }
    accepted = readingVariants(readingOn, readingKun);
    if (accepted.length === 0 && correct) accepted = [correct];
  }

  if (!correct) return null;

  return {
    prompt: `「${displayChar}」の読み方を答えてください。`,
    correctAnswer: correct,
    acceptedAnswers: accepted,
  };
}

async function resolveTagIds(env: Env, tagNames: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const rawName of tagNames) {
    const name = rawName.trim();
    if (!name) continue;
    const existing = await env.DB.prepare("SELECT id FROM tags WHERE name = ?").bind(name).first<{ id: number }>();
    if (existing) {
      ids.push(existing.id);
    } else {
      const result = await env.DB.prepare("INSERT INTO tags (name) VALUES (?)").bind(name).run();
      ids.push(Number(result.meta.last_row_id));
    }
  }
  return ids;
}

async function lookupTagIdsByName(env: Env, tagNames: string[]): Promise<number[]> {
  if (tagNames.length === 0) return [];
  const placeholders = tagNames.map(() => "?").join(",");
  const { results } = await env.DB
    .prepare(`SELECT id FROM tags WHERE name IN (${placeholders})`)
    .bind(...tagNames)
    .all<{ id: number }>();
  return results.map((r) => r.id);
}

async function setKanjiTags(env: Env, kanjiId: number, tagIds: number[]): Promise<void> {
  await env.DB.prepare("DELETE FROM kanji_tags WHERE kanji_id = ?").bind(kanjiId).run();
  for (const tagId of tagIds) {
    await env.DB
      .prepare("INSERT INTO kanji_tags (kanji_id, tag_id) VALUES (?, ?)")
      .bind(kanjiId, tagId)
      .run();
  }
}

async function getTagsForKanjiIds(env: Env, kanjiIds: number[]): Promise<Map<number, TagRef[]>> {
  const map = new Map<number, TagRef[]>();
  if (kanjiIds.length === 0) return map;

  const chunkSize = 50;
  for (let i = 0; i < kanjiIds.length; i += chunkSize) {
    const chunk = kanjiIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await env.DB
      .prepare(
        `SELECT kt.kanji_id AS kanji_id, t.id AS tag_id, t.name AS tag_name
         FROM kanji_tags kt
         JOIN tags t ON kt.tag_id = t.id
         WHERE kt.kanji_id IN (${placeholders})
         ORDER BY t.name`
      )
      .bind(...chunk)
      .all<{ kanji_id: number; tag_id: number; tag_name: string }>();

    for (const row of results) {
      const list = map.get(row.kanji_id) || [];
      list.push({ id: row.tag_id, name: row.tag_name });
      map.set(row.kanji_id, list);
    }
  }
  return map;
}

interface AdminKanjiInput {
  character?: string;
  reading_on?: string | null;
  reading_kun?: string | null;
  meaning?: string | null;
  tags?: string[] | null;
}

interface AdminQuestionInput {
  kanjiId?: number;
  prompt?: string;
  correct_answer?: string;
  accepted_answers?: string[] | null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    // ---------- 公開API ----------

    if (pathname === "/api/ping") {
      const result = await env.DB
        .prepare("SELECT character, reading_on, reading_kun FROM kanji LIMIT 1")
        .first();
      return jsonResponse({ status: "ok", sample: result });
    }

    if (pathname === "/api/tags" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, name FROM tags ORDER BY name").all<TagRef>();
      return jsonResponse({ tags: results });
    }

    if (pathname === "/api/questions/challenge") {
      const spiceParam = url.searchParams.get("spice") || "medium";

      const tagsParam = url.searchParams.get("tags");
      const tagNames = tagsParam
        ? tagsParam
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];

      let tagIds: number[] = [];
      if (tagNames.length > 0) {
        tagIds = await lookupTagIdsByName(env, tagNames);
        if (tagIds.length === 0) {
          // 指定されたタグが1つも存在しない場合は該当なしとする
          return jsonResponse({ questions: [] });
        }
      }

      // タグを指定した場合は、辛さの指定に関わらず全難易度から出題する
      const range = tagIds.length > 0 ? [0, 1.01] : SPICE_RANGES[spiceParam] || SPICE_RANGES.medium;

      let innerQuery = `
        SELECT DISTINCT q.id, q.kanji_id, q.type, q.prompt,
          COALESCE((SELECT AVG(a.is_correct) FROM attempts a WHERE a.question_id = q.id), 0.5) AS accuracy
        FROM questions q
        JOIN kanji k ON q.kanji_id = k.id
      `;
      const params: (string | number)[] = [];

      if (tagIds.length > 0) {
        const placeholders = tagIds.map(() => "?").join(",");
        innerQuery += ` JOIN kanji_tags kt ON kt.kanji_id = k.id AND kt.tag_id IN (${placeholders})`;
        params.push(...tagIds);
      }

      const outerQuery = `
        SELECT * FROM (${innerQuery}) sub
        WHERE accuracy BETWEEN ? AND ?
        ORDER BY RANDOM()
        LIMIT 10
      `;
      params.push(range[0], range[1]);

      const { results } = await env.DB
        .prepare(outerQuery)
        .bind(...params)
        .all<{ id: number; kanji_id: number; type: string; prompt: string; accuracy: number }>();

      const questions = results.map((row) => ({
        id: row.id,
        kanjiId: row.kanji_id,
        type: row.type,
        prompt: row.prompt,
      }));
      return jsonResponse({ questions });
    }

    if (pathname === "/api/auth/register" && method === "POST") {
      const body = await request.json<{ username?: string; password?: string }>();
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

    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await request.json<{ username?: string; password?: string }>();
      const { username, password } = body;
      if (!username || !password) {
        return jsonResponse({ error: "username and password are required" }, { status: 400 });
      }
      const user = await env.DB
        .prepare("SELECT id, password_hash FROM users WHERE username = ?")
        .bind(username)
        .first<{ id: number; password_hash: string }>();
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return jsonResponse({ error: "invalid username or password" }, { status: 401 });
      }
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000).toISOString();
      await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user.id, expiresAt).run();

      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
      headers.append(
        "Set-Cookie",
        `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION_SECONDS}`
      );
      return new Response(JSON.stringify({ status: "ok" }), { headers });
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      const cookies = parseCookies(request);
      const token = cookies[SESSION_COOKIE];
      if (token) {
        await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      }
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
      headers.append("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      return new Response(JSON.stringify({ status: "ok" }), { headers });
    }

    if (pathname === "/api/auth/me") {
      const user = await getSessionUser(request, env);
      return jsonResponse({ user });
    }

    if (pathname === "/api/questions/answer" && method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return jsonResponse({ error: "login required" }, { status: 401 });
      }

      const body = await request.json<{ questionId?: number; answer?: string }>();
      const { questionId, answer } = body;
      if (!questionId || answer === undefined) {
        return jsonResponse({ error: "questionId and answer are required" }, { status: 400 });
      }

      const question = await env.DB
        .prepare("SELECT correct_answer, accepted_answers FROM questions WHERE id = ?")
        .bind(questionId)
        .first<{ correct_answer: string; accepted_answers: string | null }>();

      if (!question) {
        return jsonResponse({ error: "question not found" }, { status: 404 });
      }

      const acceptedAnswers: string[] = question.accepted_answers
        ? JSON.parse(question.accepted_answers)
        : [question.correct_answer];

      const trimmedAnswer = answer.trim();
      const isCorrect = trimmedAnswer === question.correct_answer || acceptedAnswers.includes(trimmedAnswer);

      await env.DB
        .prepare("INSERT INTO attempts (user_id, question_id, is_correct) VALUES (?, ?, ?)")
        .bind(user.id, questionId, isCorrect ? 1 : 0)
        .run();

      return jsonResponse({
        correct: isCorrect,
        correctAnswer: question.correct_answer,
      });
    }

    if (pathname === "/api/questions/stats") {
      const idsParam = url.searchParams.get("ids");
      if (!idsParam) {
        return jsonResponse({ error: "ids is required" }, { status: 400 });
      }
      const ids = idsParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => !isNaN(n));
      if (ids.length === 0) {
        return jsonResponse({ error: "invalid ids" }, { status: 400 });
      }

      const user = await getSessionUser(request, env);
      const placeholders = ids.map(() => "?").join(",");

      const overallRows = await env.DB
        .prepare(
          `SELECT question_id, AVG(is_correct) AS accuracy, COUNT(*) AS attempts
           FROM attempts
           WHERE question_id IN (${placeholders})
           GROUP BY question_id`
        )
        .bind(...ids)
        .all<{ question_id: number; accuracy: number; attempts: number }>();

      const overallMap = new Map(overallRows.results.map((r) => [r.question_id, r]));

      let userMap = new Map<number, { accuracy: number; attempts: number }>();
      if (user) {
        const userRows = await env.DB
          .prepare(
            `SELECT question_id, AVG(is_correct) AS accuracy, COUNT(*) AS attempts
             FROM attempts
             WHERE user_id = ? AND question_id IN (${placeholders})
             GROUP BY question_id`
          )
          .bind(user.id, ...ids)
          .all<{ question_id: number; accuracy: number; attempts: number }>();
        userMap = new Map(userRows.results.map((r) => [r.question_id, r]));
      }

      const stats = ids.map((id) => ({
        questionId: id,
        overallAccuracy: overallMap.get(id)?.accuracy ?? null,
        overallAttempts: overallMap.get(id)?.attempts ?? 0,
        userAccuracy: userMap.get(id)?.accuracy ?? null,
        userAttempts: userMap.get(id)?.attempts ?? 0,
      }));

      return jsonResponse({ stats });
    }

    if (pathname === "/api/stats/by-spice") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return jsonResponse({ error: "login required" }, { status: 401 });
      }

      const results = [];
      for (const spice of Object.keys(SPICE_RANGES)) {
        const [min, max] = SPICE_RANGES[spice];
        const row = await env.DB
          .prepare(
            `SELECT AVG(a.is_correct) AS accuracy, COUNT(*) AS attempts
             FROM attempts a
             JOIN questions q ON a.question_id = q.id
             WHERE a.user_id = ?
               AND (
                 SELECT COALESCE(AVG(a2.is_correct), 0.5)
                 FROM attempts a2
                 WHERE a2.question_id = q.id
               ) BETWEEN ? AND ?`
          )
          .bind(user.id, min, max)
          .first<{ accuracy: number | null; attempts: number }>();

        results.push({
          spice,
          accuracy: row?.accuracy ?? null,
          attempts: row?.attempts ?? 0,
        });
      }

      return jsonResponse({ stats: results });
    }

    // ---------- 管理者専用API ----------

    if (pathname.startsWith("/api/admin/")) {
      const user = await getSessionUser(request, env);
      if (!user) {
        return jsonResponse({ error: "login required" }, { status: 401 });
      }
      if (!user.isAdmin) {
        return jsonResponse({ error: "admin only" }, { status: 403 });
      }

      // ---- タグ ----

      if (pathname === "/api/admin/tags" && method === "GET") {
        const { results } = await env.DB
          .prepare(
            `SELECT t.id, t.name, COUNT(kt.kanji_id) AS usage_count
             FROM tags t
             LEFT JOIN kanji_tags kt ON kt.tag_id = t.id
             GROUP BY t.id
             ORDER BY t.name`
          )
          .all<{ id: number; name: string; usage_count: number }>();
        return jsonResponse({ tags: results });
      }

      const tagIdMatch = pathname.match(/^\/api\/admin\/tags\/(\d+)$/);
      if (tagIdMatch && method === "DELETE") {
        const tagId = Number(tagIdMatch[1]);
        await env.DB.prepare("DELETE FROM kanji_tags WHERE tag_id = ?").bind(tagId).run();
        await env.DB.prepare("DELETE FROM tags WHERE id = ?").bind(tagId).run();
        return jsonResponse({ status: "ok" });
      }

      // ---- 漢字マスタ CRUD ----

      if (pathname === "/api/admin/kanji" && method === "GET") {
        const q = url.searchParams.get("q");
        const tagId = url.searchParams.get("tagId");

        let query =
          "SELECT DISTINCT k.id, k.character, k.reading_on, k.reading_kun, k.meaning FROM kanji k";
        const params: (string | number)[] = [];

        if (tagId) {
          query += " JOIN kanji_tags kt ON kt.kanji_id = k.id AND kt.tag_id = ?";
          params.push(Number(tagId));
        }

        query += " WHERE 1=1";
        if (q) {
          query += " AND (k.character LIKE ? OR k.reading_on LIKE ? OR k.reading_kun LIKE ?)";
          const like = `%${q}%`;
          params.push(like, like, like);
        }
        query += " ORDER BY k.id";

        const { results } = await env.DB
          .prepare(query)
          .bind(...params)
          .all<{
            id: number;
            character: string;
            reading_on: string | null;
            reading_kun: string | null;
            meaning: string | null;
          }>();

        const ids = results.map((r) => r.id);
        const tagsMap = await getTagsForKanjiIds(env, ids);

        const kanji = results.map((row) => ({
          ...row,
          tags: tagsMap.get(row.id) || [],
        }));

        return jsonResponse({ kanji });
      }

      if (pathname === "/api/admin/kanji" && method === "POST") {
        const body = await request.json<AdminKanjiInput>();
        if (!body.character) {
          return jsonResponse({ error: "character is required" }, { status: 400 });
        }
        const result = await env.DB
          .prepare(
            `INSERT INTO kanji (character, reading_on, reading_kun, meaning)
             VALUES (?, ?, ?, ?)`
          )
          .bind(
            body.character,
            body.reading_on ?? null,
            body.reading_kun ?? null,
            body.meaning ?? null
          )
          .run();
        const newId = Number(result.meta.last_row_id);

        if (body.tags && body.tags.length > 0) {
          const tagIds = await resolveTagIds(env, body.tags);
          await setKanjiTags(env, newId, tagIds);
        }

        const question = buildReadingQuestion(body.character, body.reading_on ?? null, body.reading_kun ?? null);
        if (question) {
          await env.DB
            .prepare(
              `INSERT INTO questions (kanji_id, type, prompt, correct_answer, accepted_answers)
               VALUES (?, 'reading', ?, ?, ?)`
            )
            .bind(newId, question.prompt, question.correctAnswer, JSON.stringify(question.acceptedAnswers))
            .run();
        }

        return jsonResponse({ status: "ok", id: newId }, { status: 201 });
      }

      const draftMatch = pathname.match(/^\/api\/admin\/kanji\/(\d+)\/draft-question$/);
      if (draftMatch && method === "GET") {
        const kanjiId = Number(draftMatch[1]);
        const kanji = await env.DB
          .prepare("SELECT character, reading_on, reading_kun FROM kanji WHERE id = ?")
          .bind(kanjiId)
          .first<{ character: string; reading_on: string | null; reading_kun: string | null }>();
        if (!kanji) {
          return jsonResponse({ error: "kanji not found" }, { status: 404 });
        }
        const draft = buildReadingQuestion(kanji.character, kanji.reading_on, kanji.reading_kun);
        return jsonResponse({ character: kanji.character, draft });
      }

      const kanjiIdMatch = pathname.match(/^\/api\/admin\/kanji\/(\d+)$/);
      if (kanjiIdMatch) {
        const kanjiId = Number(kanjiIdMatch[1]);

        if (method === "PUT") {
          const body = await request.json<AdminKanjiInput>();
          if (!body.character) {
            return jsonResponse({ error: "character is required" }, { status: 400 });
          }
          await env.DB
            .prepare(
              `UPDATE kanji SET character = ?, reading_on = ?, reading_kun = ?, meaning = ?
               WHERE id = ?`
            )
            .bind(
              body.character,
              body.reading_on ?? null,
              body.reading_kun ?? null,
              body.meaning ?? null,
              kanjiId
            )
            .run();

          if (body.tags !== undefined) {
            const tagIds = body.tags && body.tags.length > 0 ? await resolveTagIds(env, body.tags) : [];
            await setKanjiTags(env, kanjiId, tagIds);
          }

          return jsonResponse({ status: "ok" });
        }

        if (method === "DELETE") {
          await env.DB
            .prepare(
              `DELETE FROM attempts WHERE question_id IN (SELECT id FROM questions WHERE kanji_id = ?)`
            )
            .bind(kanjiId)
            .run();
          await env.DB.prepare("DELETE FROM questions WHERE kanji_id = ?").bind(kanjiId).run();
          await env.DB.prepare("DELETE FROM kanji_tags WHERE kanji_id = ?").bind(kanjiId).run();
          await env.DB.prepare("DELETE FROM kanji WHERE id = ?").bind(kanjiId).run();
          return jsonResponse({ status: "ok" });
        }
      }

      // ---- 問題 CRUD ----

      if (pathname === "/api/admin/questions" && method === "GET") {
        const kanjiId = url.searchParams.get("kanjiId");
        let query = `
          SELECT q.id, q.kanji_id, k.character, q.type, q.prompt, q.correct_answer, q.accepted_answers,
            COALESCE((SELECT AVG(a.is_correct) FROM attempts a WHERE a.question_id = q.id), 0.5) AS accuracy,
            (SELECT COUNT(*) FROM attempts a WHERE a.question_id = q.id) AS attempts
          FROM questions q
          JOIN kanji k ON q.kanji_id = k.id
          WHERE 1=1
        `;
        const params: (string | number)[] = [];
        if (kanjiId) {
          query += " AND q.kanji_id = ?";
          params.push(Number(kanjiId));
        }
        query += " ORDER BY k.id, q.id";
        const { results } = await env.DB
          .prepare(query)
          .bind(...params)
          .all<{
            id: number;
            kanji_id: number;
            character: string;
            type: string;
            prompt: string;
            correct_answer: string;
            accepted_answers: string | null;
            accuracy: number;
            attempts: number;
          }>();

        const questions = results.map((row) => {
          const spiceLevels = Object.keys(SPICE_RANGES).filter((spice) => {
            const [min, max] = SPICE_RANGES[spice];
            return row.accuracy >= min && row.accuracy <= max;
          });
          return {
            id: row.id,
            kanjiId: row.kanji_id,
            character: row.character,
            type: row.type,
            prompt: row.prompt,
            correctAnswer: row.correct_answer,
            acceptedAnswers: row.accepted_answers ? JSON.parse(row.accepted_answers) : null,
            accuracy: row.accuracy,
            attempts: row.attempts,
            spiceLevels,
          };
        });
        return jsonResponse({ questions });
      }

      if (pathname === "/api/admin/questions" && method === "POST") {
        const body = await request.json<AdminQuestionInput>();
        if (!body.kanjiId || !body.prompt || !body.correct_answer) {
          return jsonResponse(
            { error: "kanjiId, prompt and correct_answer are required" },
            { status: 400 }
          );
        }
        const result = await env.DB
          .prepare(
            `INSERT INTO questions (kanji_id, type, prompt, correct_answer, accepted_answers)
             VALUES (?, 'reading', ?, ?, ?)`
          )
          .bind(
            body.kanjiId,
            body.prompt,
            body.correct_answer,
            body.accepted_answers ? JSON.stringify(body.accepted_answers) : null
          )
          .run();
        return jsonResponse({ status: "ok", id: result.meta.last_row_id }, { status: 201 });
      }

      const questionIdMatch = pathname.match(/^\/api\/admin\/questions\/(\d+)$/);
      if (questionIdMatch) {
        const questionId = Number(questionIdMatch[1]);

        if (method === "PUT") {
          const body = await request.json<AdminQuestionInput>();
          if (!body.prompt || !body.correct_answer) {
            return jsonResponse({ error: "prompt and correct_answer are required" }, { status: 400 });
          }
          await env.DB
            .prepare(
              `UPDATE questions SET prompt = ?, correct_answer = ?, accepted_answers = ?
               WHERE id = ?`
            )
            .bind(
              body.prompt,
              body.correct_answer,
              body.accepted_answers ? JSON.stringify(body.accepted_answers) : null,
              questionId
            )
            .run();
          return jsonResponse({ status: "ok" });
        }

        if (method === "DELETE") {
          await env.DB.prepare("DELETE FROM attempts WHERE question_id = ?").bind(questionId).run();
          await env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(questionId).run();
          return jsonResponse({ status: "ok" });
        }
      }

      return jsonResponse({ error: "Not Found" }, { status: 404 });
    }

    if (pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};