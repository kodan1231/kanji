import { apiFetch, currentUser, setCurrentUser } from "../api";
import { navigate } from "../router";
import { escapeHtml } from "./format";

export function renderHeader(): string {
  const authArea = currentUser
    ? `<span>${escapeHtml(currentUser.username)} さん</span> <button id="logout-btn">ログアウト</button>`
    : `<a href="#/login">ログイン / 登録</a>`;

  const adminLink = currentUser?.isAdmin ? `<a href="#/admin">管理</a>` : "";

  return `
    <header class="app-header">
      <nav>
        <a href="#/">ホーム</a>
        ${adminLink}
      </nav>
      <div class="auth-status">${authArea}</div>
    </header>
  `;
}

// rerender: ログアウト後に画面を再描画するためのコールバック（呼び出し元のrender関数を渡す）
export function attachHeaderEvents(rerender: () => void): void {
  document.querySelector<HTMLButtonElement>("#logout-btn")?.addEventListener("click", async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    navigate("/");
    rerender();
  });
}
