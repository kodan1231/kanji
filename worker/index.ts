import type { Env } from "./env";
import { jsonResponse } from "./http";
import { getSessionUser } from "./auth";
import { handlePublicRoute } from "./routes/public";
import { handleAdminKanjiRoute } from "./routes/admin-kanji";
import { handleAdminQuestionsRoute } from "./routes/admin-questions";

export type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ---------- 管理者専用API ----------
    if (pathname.startsWith("/api/admin/")) {
      const user = await getSessionUser(request, env);
      if (!user) {
        return jsonResponse({ error: "login required" }, { status: 401 });
      }
      if (!user.isAdmin) {
        return jsonResponse({ error: "admin only" }, { status: 403 });
      }

      const kanjiResponse = await handleAdminKanjiRoute(request, env, url);
      if (kanjiResponse) return kanjiResponse;

      const questionsResponse = await handleAdminQuestionsRoute(request, env, url);
      if (questionsResponse) return questionsResponse;

      return jsonResponse({ error: "Not Found" }, { status: 404 });
    }

    // ---------- 公開API ----------
    const publicResponse = await handlePublicRoute(request, env, url);
    if (publicResponse) return publicResponse;

    if (pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
