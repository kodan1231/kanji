import type { Env, TagRef } from "./env";

export async function resolveTagIds(env: Env, tagNames: string[]): Promise<number[]> {
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

export async function lookupTagIdsByName(env: Env, tagNames: string[]): Promise<number[]> {
  if (tagNames.length === 0) return [];
  const placeholders = tagNames.map(() => "?").join(",");
  const { results } = await env.DB
    .prepare(`SELECT id FROM tags WHERE name IN (${placeholders})`)
    .bind(...tagNames)
    .all<{ id: number }>();
  return results.map((r) => r.id);
}

export async function setKanjiTags(env: Env, kanjiId: number, tagIds: number[]): Promise<void> {
  await env.DB.prepare("DELETE FROM kanji_tags WHERE kanji_id = ?").bind(kanjiId).run();
  for (const tagId of tagIds) {
    await env.DB
      .prepare("INSERT INTO kanji_tags (kanji_id, tag_id) VALUES (?, ?)")
      .bind(kanjiId, tagId)
      .run();
  }
}

export async function getTagsForKanjiIds(env: Env, kanjiIds: number[]): Promise<Map<number, TagRef[]>> {
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
