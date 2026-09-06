import type { Env } from "../env";
import { jsonResponse } from "../http";
import { resolveTagIds, setKanjiTags, getTagsForKanjiIds } from "../tags";
import { buildReadingQuestion } from "../kana";

interface AdminKanjiInput {
  character?: string;
  reading_on?: string | null;
  reading_kun?: string | null;
  meaning?: string | null;
  tags?: string[] | null;
}

// 呼び出し元(index.ts)で管理者認証済みであること前提。マッチしなければnullを返す。
export async function handleAdminKanjiRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const pathname = url.pathname;
  const method = request.method;

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

    let query = "SELECT DISTINCT k.id, k.character, k.reading_on, k.reading_kun, k.meaning FROM kanji k";
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
      .bind(body.character, body.reading_on ?? null, body.reading_kun ?? null, body.meaning ?? null)
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
        .bind(body.character, body.reading_on ?? null, body.reading_kun ?? null, body.meaning ?? null, kanjiId)
        .run();

      if (body.tags !== undefined) {
        const tagIds = body.tags && body.tags.length > 0 ? await resolveTagIds(env, body.tags) : [];
        await setKanjiTags(env, kanjiId, tagIds);
      }

      return jsonResponse({ status: "ok" });
    }

    if (method === "DELETE") {
      await env.DB
        .prepare(`DELETE FROM attempts WHERE question_id IN (SELECT id FROM questions WHERE kanji_id = ?)`)
        .bind(kanjiId)
        .run();
      await env.DB.prepare("DELETE FROM questions WHERE kanji_id = ?").bind(kanjiId).run();
      await env.DB.prepare("DELETE FROM kanji_tags WHERE kanji_id = ?").bind(kanjiId).run();
      await env.DB.prepare("DELETE FROM kanji WHERE id = ?").bind(kanjiId).run();
      return jsonResponse({ status: "ok" });
    }
  }

  return null;
}
