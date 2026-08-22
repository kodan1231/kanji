interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await context.env.DB
    .prepare("SELECT character, reading_on, reading_kun FROM kanji LIMIT 1")
    .first();

  return Response.json({
    status: "ok",
    sample: result,
  });
};