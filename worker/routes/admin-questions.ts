import type { Env } from "../env";
import { jsonResponse } from "../http";
import { SPICE_RANGES } from "../spice";

interface AdminQuestionInput {
  kanjiId?: number;
  prompt?: string;
  correct_answer?: string;
  accepted_answers?: string[] | null;
}

// 呼び出し元(index.ts)で管理者認証済みであること前提。マッチしなければnullを返す。
export async function handleAdminQuestionsRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const pathname = url.pathname;
  const method = request.method;

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
      return jsonResponse({ error: "kanjiId, prompt and correct_answer are required" }, { status: 400 });
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

  return null;
}
