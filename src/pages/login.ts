import { apiFetch, refreshUser } from "../api";
import { navigate } from "../router";
import { renderHeader } from "../ui/header";

export function renderLogin(): string {
  return `
    ${renderHeader()}
    <main>
      <h1>ログイン / 新規登録</h1>
      <div class="auth-form-wrapper">
        <form id="auth-form">
          <label>ユーザー名
            <input type="text" id="username" required autocomplete="username" />
          </label>
          <label>パスワード（8文字以上）
            <input type="password" id="password" required minlength="8" autocomplete="current-password" />
          </label>
          <div class="auth-actions">
            <button type="submit">ログイン</button>
            <button type="button" id="register-btn">新規登録</button>
          </div>
        </form>
        <p id="auth-message" class="message"></p>
      </div>
    </main>
  `;
}

// rerender: ログイン成功後に画面を再描画するためのコールバック
export function attachLoginEvents(rerender: () => void): void {
  const form = document.querySelector<HTMLFormElement>("#auth-form")!;
  const message = document.querySelector<HTMLParagraphElement>("#auth-message")!;

  const getCredentials = () => ({
    username: document.querySelector<HTMLInputElement>("#username")!.value,
    password: document.querySelector<HTMLInputElement>("#password")!.value,
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    message.textContent = "";
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(getCredentials()),
      });
      await refreshUser();
      navigate("/");
      rerender();
    } catch (err) {
      message.classList.add("incorrect");
      message.textContent = `ログインに失敗しました: ${(err as Error).message}`;
    }
  });

  document.querySelector("#register-btn")?.addEventListener("click", async () => {
    message.textContent = "";
    message.classList.remove("incorrect", "correct");
    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(getCredentials()),
      });
      message.classList.add("correct");
      message.textContent = "登録が完了しました。続けてログインしてください。";
    } catch (err) {
      message.classList.add("incorrect");
      message.textContent = `登録に失敗しました: ${(err as Error).message}`;
    }
  });
}
