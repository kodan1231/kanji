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

		const { results } = await env.DB
			.prepare(query)
			.bind(...params)
			.all();

		return Response.json({ kanji: results });
	}
	
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not Found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};