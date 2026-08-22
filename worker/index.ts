export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface QuestionRow {
  id: number;
  kanji_id: number;
  type: string;
  prompt: string;
  choices: string | null;
}

const SESSION_COOKIE = "session_token";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30日

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

async function getSessionUser(
  request: Request,
  env: Env
): Promise<{ id: number; username: string } | null> {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await env.DB
    .prepare(
      `SELECT u.id, u.username FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .bind(token)
    .first<{ id: number; username: string }>();

  return session || null;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    if (url.pathname === "/api/ping") {
      const result = await env.DB
        .prepare("SELECT character, reading_on, reading_kun FROM kanji LIMIT 1")
        .first();
      return Response.json({ status: "ok", sample: result });
    }

    if (url.pathname === "/api/questions/challenge") {
      const level = url.searchParams.get("level");
      if (!level) {
        return Response.json({ error: "level is required" }, { status: 400 });
      }
      const { results } = await env.DB
        .prepare(
          `SELECT q.id, q.kanji_id, q.type, q.prompt, q.choices
           FROM questions q
           JOIN kanji k ON q.kanji_id = k.id
           WHERE k.level = ?
           ORDER BY RANDOM()
           LIMIT 10`
        )
        .bind(Number(level))
        .all<QuestionRow>();

      const questions = results.map((row) => ({
        id: row.id,
        kanjiId: row.kanji_id,
        type: row.type,
        prompt: row.prompt,
        choices: row.choices ? JSON.parse(row.choices) : null,
      }));
      return Response.json({ questions });
    }

    if (url.pathname === "/api/kanji/study") {
      const level = url.searchParams.get("level");
      const q = url.searchParams.get("q");
      let query =
        "SELECT id, character, level, reading_on, reading_kun, radical, stroke_count, meaning FROM kanji WHERE 1=1";
      const params: (string | number)[] = [];
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
      return Response.json({ kanji: results });
    }

    if (url.pathname === "/api/auth/register" && method === "POST") {
      const body = await request.json<{ username?: string; password?: string }>();
      const { username, password } = body;
      if (!username || !password) {
        return Response.json({ error: "username and password are required" }, { status: 400 });
      }
      if (password.length < 8) {
        return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
      }
      const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
      if (existing) {
        return Response.json({ error: "username already taken" }, { status: 409 });
      }
      const passwordHash = await hashPassword(password);
      await env.DB.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").bind(username, passwordHash).run();
      return Response.json({ status: "ok" }, { status: 201 });
    }

    if (url.pathname === "/api/auth/login" && method === "POST") {
      const body = await request.json<{ username?: string; password?: string }>();
      const { username, password } = body;
      if (!username || !password) {
        return Response.json({ error: "username and password are required" }, { status: 400 });
      }
      const user = await env.DB
        .prepare("SELECT id, password_hash FROM users WHERE username = ?")
        .bind(username)
        .first<{ id: number; password_hash: string }>();
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return Response.json({ error: "invalid username or password" }, { status: 401 });
      }
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000).toISOString();
      await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user.id, expiresAt).run();

      const headers = new Headers({ "Content-Type": "application/json" });
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
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.append("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      return new Response(JSON.stringify({ status: "ok" }), { headers });
    }

	if (url.pathname === "/api/auth/me") {
	const user = await getSessionUser(request, env);
	return Response.json({ user });
	}

	if (url.pathname === "/api/questions/answer" && method === "POST") {
	const user = await getSessionUser(request, env);
	if (!user) {
		return Response.json({ error: "login required" }, { status: 401 });
	}

	const body = await request.json<{ questionId?: number; answer?: string }>();
	const { questionId, answer } = body;
	if (!questionId || answer === undefined) {
		return Response.json({ error: "questionId and answer are required" }, { status: 400 });
	}

	const question = await env.DB
		.prepare("SELECT correct_answer FROM questions WHERE id = ?")
		.bind(questionId)
		.first<{ correct_answer: string }>();

	if (!question) {
		return Response.json({ error: "question not found" }, { status: 404 });
	}

	const isCorrect = question.correct_answer === answer;

	await env.DB
		.prepare("INSERT INTO attempts (user_id, question_id, is_correct) VALUES (?, ?, ?)")
		.bind(user.id, questionId, isCorrect ? 1 : 0)
		.run();

	return Response.json({
		correct: isCorrect,
		correctAnswer: question.correct_answer,
	});
	}	

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not Found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};