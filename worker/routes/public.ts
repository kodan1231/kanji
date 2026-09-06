import type { Env } from "../env";
import { jsonResponse } from "../http";
import { SPICE_RANGES } from "../spice";
import {
  getSessionUser,
  hashPassword,
  verifyPassword,
  parseCookies,
  SESSION_COOKIE,
  SESSION_DURATION_SECONDS,
} from "../auth";
import { lookupTagIdsByName } from "../tags";

// マッチしなければnullを返す（index.tsが管理者API等にフォールバックできるように）
export async function handlePublicRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const pathname = url.pathname;
  const method = request.method;

  if (pathname === "/api/ping") {
    const result = await env.DB
      .prepare("SELECT character, reading_on, reading_kun FROM kanji LIMIT 1")
      .first();
    return jsonResponse({ status: "ok", sample: result });
  }

  if (pathname === "/api/tags" && method === "GET") {
    const { results } = await env.DB
      .prepare("SELECT id, name FROM tags ORDER BY name")
      .all<{ id: number; name: string }>();
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
      SELECT DISTINCT q.id, q.kanji_id, q.type, q.prompt, k.hint,
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
      .all<{ id: number; kanji_id: number; type: string; prompt: string; hint: string | null; accuracy: number }>();

    const questions = results.map((row) => ({
      id: row.id,
      kanjiId: row.kanji_id,
      type: row.type,
      prompt: row.prompt,
      hint: row.hint,
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
    await env.DB
      .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .bind(username, passwordHash)
      .run();
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
    await env.DB
      .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(token, user.id, expiresAt)
      .run();

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

  return null;
}
