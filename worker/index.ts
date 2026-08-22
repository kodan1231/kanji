export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
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

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not Found" }, { status: 404 });
    }

    // API以外は静的アセット(Viteのビルド結果)に委譲
    return env.ASSETS.fetch(request);
  },
};