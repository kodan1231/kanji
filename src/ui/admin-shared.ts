import type { AdminTab } from "../types";

export function adminTabNavHtml(tab: AdminTab): string {
  return `
    <div class="admin-tabs">
      <a href="#/admin?tab=kanji" class="${tab === "kanji" ? "active" : ""}">漢字マスタ</a>
      <a href="#/admin?tab=questions" class="${tab === "questions" ? "active" : ""}">問題</a>
    </div>
  `;
}
