import { apiFetch, currentUser } from "../api";
import { renderHeader } from "../ui/header";
import { escapeHtml } from "../ui/format";
import { adminTabNavHtml } from "../ui/admin-shared";
import type { AdminKanjiRow, TagRef } from "../types";

export async function renderAdminKanji(tagId: string): Promise<string> {
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

  const tabNav = adminTabNavHtml("kanji");

  const tagsData = await apiFetch("/api/admin/tags");
  const allTags: (TagRef & { usage_count: number })[] = tagsData.tags;

  const params = new URLSearchParams();
  if (tagId) params.set("tagId", tagId);
  const data = await apiFetch(`/api/admin/kanji?${params.toString()}`);
  const kanjiList: AdminKanjiRow[] = data.kanji;

  const tagFilterOptions = `
    <option value="">すべて</option>
    ${allTags.map((t) => `<option value="${t.id}" ${tagId === String(t.id) ? "selected" : ""}>${escapeHtml(t.name)}（${t.usage_count}件）</option>`).join("")}
  `;

  const rows = kanjiList
    .map(
      (k) => `
        <tr data-id="${k.id}">
          <td><a href="#/admin?tab=questions&draftKanjiId=${k.id}" title="この漢字の問題を新規追加">${k.id}</a></td>
          <td><input class="f-character" value="${escapeHtml(k.character)}" /></td>
          <td><input class="f-on" value="${escapeHtml(k.reading_on ?? "")}" /></td>
          <td><input class="f-kun" value="${escapeHtml(k.reading_kun ?? "")}" /></td>
          <td><input class="f-hint" value="${escapeHtml(k.hint ?? "")}" /></td>
          <td><input class="f-tags" value="${escapeHtml(k.tags.map((t) => t.name).join(","))}" placeholder="カンマ区切り" /></td>
          <td>
            <button class="delete-kanji-btn">削除</button>
          </td>
        </tr>
      `
    )
    .join("");

  return `
    ${renderHeader()}
    <main class="admin-main">
      <h1>管理画面 — 漢字マスタ</h1>
      ${tabNav}
      <div class="admin-toolbar">
        <form id="admin-filter-form" class="study-form">
          <label>タグ
            <select id="admin-tag-filter">${tagFilterOptions}</select>
          </label>
          <button type="submit">絞り込み</button>
        </form>
        <button id="open-new-kanji-dialog" class="primary-btn">＋ 新規追加</button>
      </div>
      <p>${kanjiList.length}件</p>
      <div class="admin-table-wrapper">
        <table class="kanji-table admin-table">
          <thead>
            <tr><th>ID</th><th>文字</th><th>音読み</th><th>訓読み</th><th>ヒント</th><th>タグ</th><th></th></tr>
          </thead>
          <tbody id="admin-kanji-rows">${rows}</tbody>
        </table>
      </div>

      <dialog id="new-kanji-dialog">
        <form id="admin-new-kanji-form" class="admin-new-form">
          <h2>漢字マスタの新規追加</h2>
          <label>文字（1文字の漢字、熟語、四字熟語など）
            <input type="text" id="new-k-character" required />
          </label>
          <label>音読み
            <input type="text" id="new-k-on" />
          </label>
          <label>訓読み
            <input type="text" id="new-k-kun" />
          </label>
          <label>ヒント（出題画面の「？」マークで表示されます）
            <input type="text" id="new-k-hint" />
          </label>
          <label>タグ（カンマ区切り、任意。新しいタグ名は自動作成されます）
            <input type="text" id="new-k-tags" placeholder="例: 動物,水中生物" />
          </label>
          <div class="dialog-actions">
            <button type="button" id="cancel-new-kanji">キャンセル</button>
            <button type="submit" class="primary-btn">追加</button>
          </div>
        </form>
      </dialog>

      <h2>タグ一覧</h2>
      <div class="admin-table-wrapper admin-table-wrapper-small">
        <table class="kanji-table admin-table" id="admin-tag-list-table">
          <thead><tr><th>タグ名</th><th>使用件数</th><th></th></tr></thead>
          <tbody>
            ${allTags
              .map(
                (t) => `
                  <tr data-tag-id="${t.id}">
                    <td>${escapeHtml(t.name)}</td>
                    <td>${t.usage_count}</td>
                    <td><button class="delete-tag-btn">削除</button></td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <p id="admin-message" class="message"></p>
    </main>
  `;
}

// _tagId: 現在のフィルタ値そのものはこの関数内では使わない（元実装同様）
// rerender: 保存・削除後の再描画コールバック
// navigate: フィルタ変更時のURL遷移用（main.tsのnavigateを渡す）
export function attachAdminKanjiEvents(
  _tagId: string,
  rerender: () => void,
  navigate: (path: string) => void
): void {
  if (!currentUser?.isAdmin) return;

  const filterForm = document.querySelector<HTMLFormElement>("#admin-filter-form");
  filterForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const newTagId = document.querySelector<HTMLSelectElement>("#admin-tag-filter")!.value;
    navigate(`/admin?tab=kanji&tagId=${newTagId}`);
  });

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

  const tbody = document.querySelector<HTMLTableSectionElement>("#admin-kanji-rows");

  const saveKanjiRow = async (tr: HTMLTableRowElement) => {
    const id = tr.dataset.id;
    const payload = {
      character: tr.querySelector<HTMLInputElement>(".f-character")!.value,
      reading_on: tr.querySelector<HTMLInputElement>(".f-on")!.value || null,
      reading_kun: tr.querySelector<HTMLInputElement>(".f-kun")!.value || null,
      hint: tr.querySelector<HTMLInputElement>(".f-hint")!.value || null,
      tags: splitCsv(tr.querySelector<HTMLInputElement>(".f-tags")!.value) || [],
    };
    try {
      await apiFetch(`/api/admin/kanji/${id}`, { method: "PUT", body: JSON.stringify(payload) });
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
    if (target.matches(".f-character, .f-on, .f-kun, .f-hint, .f-tags")) {
      await saveKanjiRow(tr);
    }
  });

  tbody?.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const tr = target.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;

    if (target.classList.contains("delete-kanji-btn")) {
      if (!confirm("このエントリと、関連する問題・回答履歴もすべて削除されます。よろしいですか？")) return;
      try {
        await apiFetch(`/api/admin/kanji/${id}`, { method: "DELETE" });
        rerender();
      } catch (err) {
        showMessage(`削除に失敗しました: ${(err as Error).message}`, false);
      }
    }
  });

  const dialog = document.querySelector<HTMLDialogElement>("#new-kanji-dialog");
  document.querySelector("#open-new-kanji-dialog")?.addEventListener("click", () => dialog?.showModal());
  document.querySelector("#cancel-new-kanji")?.addEventListener("click", () => dialog?.close());

  const newForm = document.querySelector<HTMLFormElement>("#admin-new-kanji-form");
  newForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      character: document.querySelector<HTMLInputElement>("#new-k-character")!.value,
      reading_on: document.querySelector<HTMLInputElement>("#new-k-on")!.value || null,
      reading_kun: document.querySelector<HTMLInputElement>("#new-k-kun")!.value || null,
      hint: document.querySelector<HTMLInputElement>("#new-k-hint")!.value || null,
      tags: splitCsv(document.querySelector<HTMLInputElement>("#new-k-tags")!.value),
    };
    try {
      await apiFetch("/api/admin/kanji", { method: "POST", body: JSON.stringify(payload) });
      showMessage("追加しました。", true);
      dialog?.close();
      rerender();
    } catch (err) {
      showMessage(`追加に失敗しました: ${(err as Error).message}`, false);
    }
  });

  const tagListTable = document.querySelector<HTMLTableElement>("#admin-tag-list-table");
  tagListTable?.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("delete-tag-btn")) return;
    const tr = target.closest("tr");
    const tagIdToDelete = tr?.dataset.tagId;
    if (!tagIdToDelete) return;
    if (!confirm("このタグを削除します（各エントリからも解除されます）。よろしいですか？")) return;
    try {
      await apiFetch(`/api/admin/tags/${tagIdToDelete}`, { method: "DELETE" });
      rerender();
    } catch (err) {
      showMessage(`タグ削除に失敗しました: ${(err as Error).message}`, false);
    }
  });
}
