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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not Found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};