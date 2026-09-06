import { apiFetch, currentUser } from "../api";
import { renderHeader } from "../ui/header";
import { escapeHtml } from "../ui/format";
import { adminTabNavHtml } from "../ui/admin-shared";
import { SPICE_LABELS } from "../types";
import type { AdminKanjiRow, AdminQuestionRow, SpiceLevel } from "../types";

export async function renderAdminQuestions(): Promise<string> {
  if (!currentUser) {
    return `
      ${renderHeader()}
      <main>
        <h1>管理画面</h1>
        <p>ログインが必要です。</p>
        <a href="#/login">ログインする</a>
      </main>
    `;
  }
  if (!currentUser.isAdmin) {
    return `
      ${renderHeader()}
      <main>
        <h1>管理画面</h1>
        <p>このページにアクセスする権限がありません。</p>
      </main>
    `;
  }

  const tabNav = adminTabNavHtml("questions");

  const data = await apiFetch(`/api/admin/questions`);
  const questions: AdminQuestionRow[] = data.questions;

  const rows = questions
    .map((q) => {
      const spiceLabels = q.spiceLevels.map((s) => SPICE_LABELS[s as SpiceLevel] ?? s).join("・");
      const accuracyText =
        q.attempts > 0
          ? `${Math.round(q.accuracy * 100)}%（${q.attempts}回）`
          : `${Math.round(q.accuracy * 100)}%（実績なし）`;
      return `
        <tr data-id="${q.id}">
          <td>${q.id}</td>
          <td>${escapeHtml(q.character)}</td>
          <td>${accuracyText}</td>
          <td>${escapeHtml(spiceLabels)}</td>
          <td><input class="f-prompt" value="${escapeHtml(q.prompt)}" /></td>
          <td><input class="f-correct" value="${escapeHtml(q.correctAnswer)}" /></td>
          <td><input class="f-accepted" value="${escapeHtml((q.acceptedAnswers || []).join(","))}" placeholder="カンマ区切り" /></td>
          <td>
            <button class="delete-question-btn">削除</button>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    ${renderHeader()}
    <main class="admin-main">
      <h1>管理画面 — 問題</h1>
      ${tabNav}
      <div class="admin-toolbar">
        <button id="open-new-question-dialog" class="primary-btn">＋ 新規追加</button>
      </div>
      <p>${questions.length}件</p>
      <div class="admin-table-wrapper">
        <table class="kanji-table admin-table">
          <thead>
            <tr><th>ID</th><th>漢字</th><th>正答率</th><th>辛さ</th><th>問題文</th><th>正解</th><th>許容する読み</th><th></th></tr>
          </thead>
          <tbody id="admin-question-rows">${rows}</tbody>
        </table>
      </div>

      <dialog id="new-question-dialog">
        <form id="admin-new-question-form" class="admin-new-form">
          <h2>問題の新規追加</h2>
          <label>対象の漢字・熟語（文字や読みで検索）
            <div class="tag-input-wrapper">
              <input type="text" id="new-q-kanji-search" placeholder="例: 花" autocomplete="off" />
              <div class="tag-suggestions" id="new-q-kanji-suggest"></div>
            </div>
            <input type="hidden" id="new-q-kanji-id" required />
          </label>
          <p id="new-q-selected" class="message"></p>
          <label>問題文
            <input type="text" id="new-q-prompt" required />
          </label>
          <label>正解
            <input type="text" id="new-q-correct" required />
          </label>
          <label>許容する読み（カンマ区切り、任意）
            <input type="text" id="new-q-accepted" />
          </label>
          <div class="dialog-actions">
            <button type="button" id="cancel-new-question">キャンセル</button>
            <button type="submit" class="primary-btn">追加</button>
          </div>
        </form>
      </dialog>
      <p id="admin-message" class="message"></p>
    </main>
  `;
}

// draftKanjiId: 「漢字マスタ」タブから遷移した際のドラフト自動入力用ID
// rerender: 保存・削除後の再描画コールバック
export function attachAdminQuestionsEvents(draftKanjiId: string, rerender: () => void): void {
  if (!currentUser?.isAdmin) return;

  const message = document.querySelector<HTMLParagraphElement>("#admin-message");

  const showMessage = (text: string, ok: boolean) => {
    if (!message) return;
    message.classList.remove("correct", "incorrect");
    message.classList.add(ok ? "correct" : "incorrect");
    message.textContent = text;
  };

  const splitCsv = (value: string): string[] | null => {
    const items = value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : null;
  };

  const tbody = document.querySelector<HTMLTableSectionElement>("#admin-question-rows");

  const saveQuestionRow = async (tr: HTMLTableRowElement) => {
    const id = tr.dataset.id;
    const payload = {
      prompt: tr.querySelector<HTMLInputElement>(".f-prompt")!.value,
      correct_answer: tr.querySelector<HTMLInputElement>(".f-correct")!.value,
      accepted_answers: splitCsv(tr.querySelector<HTMLInputElement>(".f-accepted")!.value),
    };
    try {
      await apiFetch(`/api/admin/questions/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showMessage("自動保存しました。", true);
    } catch (err) {
      showMessage(`自動保存に失敗しました: ${(err as Error).message}`, false);
    }
  };

  // 入力欄からフォーカスが外れたタイミング（change）で自動保存
  tbody?.addEventListener("change", async (e) => {
    const target = e.target as HTMLElement;
    const tr = target.closest<HTMLTableRowElement>("tr");
    if (!tr) return;
    if (target.matches(".f-prompt, .f-correct, .f-accepted")) {
      await saveQuestionRow(tr);
    }
  });

  tbody?.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const tr = target.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;

    if (target.classList.contains("delete-question-btn")) {
      if (!confirm("この問題と、関連する回答履歴もすべて削除されます。よろしいですか？")) return;
      try {
        await apiFetch(`/api/admin/questions/${id}`, { method: "DELETE" });
        rerender();
      } catch (err) {
        showMessage(`削除に失敗しました: ${(err as Error).message}`, false);
      }
    }
  });

  const dialog = document.querySelector<HTMLDialogElement>("#new-question-dialog");
  const kanjiSearchInput = document.querySelector<HTMLInputElement>("#new-q-kanji-search");
  const kanjiSuggestBox = document.querySelector<HTMLDivElement>("#new-q-kanji-suggest");
  const kanjiIdField = document.querySelector<HTMLInputElement>("#new-q-kanji-id");
  const selectedLabel = document.querySelector<HTMLParagraphElement>("#new-q-selected");

  const resetKanjiSearch = () => {
    if (kanjiSearchInput) kanjiSearchInput.value = "";
    if (kanjiIdField) kanjiIdField.value = "";
    if (selectedLabel) {
      selectedLabel.textContent = "";
      selectedLabel.classList.remove("correct");
    }
    if (kanjiSuggestBox) {
      kanjiSuggestBox.innerHTML = "";
      kanjiSuggestBox.classList.remove("open");
    }
  };

  document.querySelector("#open-new-question-dialog")?.addEventListener("click", () => {
    resetKanjiSearch();
    dialog?.showModal();
  });
  document.querySelector("#cancel-new-question")?.addEventListener("click", () => dialog?.close());

  kanjiSearchInput?.addEventListener("input", async () => {
    const q = kanjiSearchInput.value.trim();
    if (!kanjiSuggestBox) return;
    if (!q) {
      kanjiSuggestBox.innerHTML = "";
      kanjiSuggestBox.classList.remove("open");
      return;
    }
    try {
      const data = await apiFetch(`/api/admin/kanji?q=${encodeURIComponent(q)}`);
      const matches: AdminKanjiRow[] = data.kanji.slice(0, 8);
      if (matches.length === 0) {
        kanjiSuggestBox.innerHTML = "";
        kanjiSuggestBox.classList.remove("open");
        return;
      }
      kanjiSuggestBox.innerHTML = matches
        .map(
          (k) =>
            `<div class="tag-suggestion" data-id="${k.id}" data-character="${escapeHtml(k.character)}" data-reading="${escapeHtml(k.reading_kun || k.reading_on || "")}">
              ${escapeHtml(k.character)}（ID:${k.id}） ${escapeHtml(k.reading_kun || k.reading_on || "")}
            </div>`
        )
        .join("");
      kanjiSuggestBox.classList.add("open");
    } catch {
      // 検索エラーは無視（候補が出ないだけにする）
    }
  });

  kanjiSearchInput?.addEventListener("blur", () => {
    setTimeout(() => kanjiSuggestBox?.classList.remove("open"), 150);
  });

  kanjiSuggestBox?.addEventListener("mousedown", async (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>(".tag-suggestion");
    if (!item) return;
    const id = item.dataset.id!;
    const character = item.dataset.character || "";

    if (kanjiIdField) kanjiIdField.value = id;
    if (kanjiSearchInput) kanjiSearchInput.value = character;
    kanjiSuggestBox.classList.remove("open");

    if (selectedLabel) {
      selectedLabel.classList.add("correct");
      selectedLabel.textContent = `選択中: ${character}（ID: ${id}）。ドラフトを読み込んでいます...`;
    }

    try {
      const draftData = await apiFetch(`/api/admin/kanji/${id}/draft-question`);
      const draft = draftData.draft as { prompt: string; correctAnswer: string; acceptedAnswers: string[] } | null;
      if (draft) {
        document.querySelector<HTMLInputElement>("#new-q-prompt")!.value = draft.prompt;
        document.querySelector<HTMLInputElement>("#new-q-correct")!.value = draft.correctAnswer;
        document.querySelector<HTMLInputElement>("#new-q-accepted")!.value = draft.acceptedAnswers.join(",");
        if (selectedLabel)
          selectedLabel.textContent = `選択中: ${character}（ID: ${id}）。ドラフトを自動入力しました（内容は編集できます）。`;
      } else {
        if (selectedLabel)
          selectedLabel.textContent = `選択中: ${character}（ID: ${id}）。読みが未登録のためドラフトは作成できませんでした。手入力してください。`;
      }
    } catch (err) {
      if (selectedLabel)
        selectedLabel.textContent = `選択中: ${character}（ID: ${id}）。ドラフト取得に失敗: ${(err as Error).message}`;
    }
  });

  if (draftKanjiId) {
    (async () => {
      resetKanjiSearch();
      try {
        const draftData = await apiFetch(`/api/admin/kanji/${draftKanjiId}/draft-question`);
        const character = draftData.character as string;
        const draft = draftData.draft as { prompt: string; correctAnswer: string; acceptedAnswers: string[] } | null;
        if (kanjiIdField) kanjiIdField.value = draftKanjiId;
        if (kanjiSearchInput) kanjiSearchInput.value = character;
        if (draft) {
          document.querySelector<HTMLInputElement>("#new-q-prompt")!.value = draft.prompt;
          document.querySelector<HTMLInputElement>("#new-q-correct")!.value = draft.correctAnswer;
          document.querySelector<HTMLInputElement>("#new-q-accepted")!.value = draft.acceptedAnswers.join(",");
          if (selectedLabel) {
            selectedLabel.classList.add("correct");
            selectedLabel.textContent = `選択中: ${character}（ID: ${draftKanjiId}）。ドラフトを自動入力しました（内容は編集できます）。`;
          }
        } else if (selectedLabel) {
          selectedLabel.textContent = `選択中: ${character}（ID: ${draftKanjiId}）。読みが未登録のためドラフトは作成できませんでした。手入力してください。`;
        }
        dialog?.showModal();
      } catch (err) {
        showMessage(`ドラフト取得に失敗しました: ${(err as Error).message}`, false);
      }
    })();
  }

  const newForm = document.querySelector<HTMLFormElement>("#admin-new-question-form");
  newForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const kanjiIdValue = document.querySelector<HTMLInputElement>("#new-q-kanji-id")!.value;
    if (!kanjiIdValue) {
      showMessage("対象の漢字・熟語を候補から選択してください。", false);
      return;
    }
    const payload = {
      kanjiId: Number(kanjiIdValue),
      prompt: document.querySelector<HTMLInputElement>("#new-q-prompt")!.value,
      correct_answer: document.querySelector<HTMLInputElement>("#new-q-correct")!.value,
      accepted_answers: splitCsv(document.querySelector<HTMLInputElement>("#new-q-accepted")!.value),
    };
    try {
      await apiFetch("/api/admin/questions", { method: "POST", body: JSON.stringify(payload) });
      showMessage("追加しました。", true);
      dialog?.close();
      rerender();
    } catch (err) {
      showMessage(`追加に失敗しました: ${(err as Error).message}`, false);
    }
  });
}
