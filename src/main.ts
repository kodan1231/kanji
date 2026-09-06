import "./style.css";
import { refreshUser } from "./api";
import { parseHash, navigate } from "./router";
import { attachHeaderEvents } from "./ui/header";
import { renderHome, attachHomeEvents } from "./pages/home";
import { renderLogin, attachLoginEvents } from "./pages/login";
import { renderChallenge, attachChallengeEvents } from "./pages/challenge";
import { renderAdminKanji, attachAdminKanjiEvents } from "./pages/admin-kanji";
import { renderAdminQuestions, attachAdminQuestionsEvents } from "./pages/admin-questions";
import { SPICE_ORDER } from "./types";
import type { ChallengeFilter, SpiceLevel } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

async function render(): Promise<void> {
  const { path, params } = parseHash();

  if (path === "/login") {
    app.innerHTML = renderLogin();
    attachHeaderEvents(render);
    attachLoginEvents(render);
    return;
  }

  if (path === "/challenge") {
    const spiceParam = params.get("spice");
    const spice: SpiceLevel = SPICE_ORDER.includes(spiceParam as SpiceLevel) ? (spiceParam as SpiceLevel) : "medium";
    const filter: ChallengeFilter = {
      tags: params.get("tags") || "",
      spice,
    };
    app.innerHTML = await renderChallenge(filter);
    attachHeaderEvents(render);
    attachChallengeEvents(filter, render);
    return;
  }

  if (path === "/admin") {
    const tab = params.get("tab") === "questions" ? "questions" : "kanji";
    const tagId = params.get("tagId") || "";
    const draftKanjiId = params.get("draftKanjiId") || "";

    if (tab === "questions") {
      app.innerHTML = await renderAdminQuestions();
      attachHeaderEvents(render);
      attachAdminQuestionsEvents(draftKanjiId, render);
    } else {
      app.innerHTML = await renderAdminKanji(tagId);
      attachHeaderEvents(render);
      attachAdminKanjiEvents(tagId, render, navigate);
    }
    return;
  }

  app.innerHTML = await renderHome();
  attachHeaderEvents(render);
  attachHomeEvents();
}

window.addEventListener("hashchange", () => {
  render();
});

(async () => {
  await refreshUser();
  await render();
})();
