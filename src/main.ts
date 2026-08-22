import "./style.css";

type User = { id: number; username: string } | null;

interface ChallengeQuestion {
  id: number;
  kanjiId: number;
  type: string;
  prompt: string;
  choices: string[] | null;
}

interface KanjiRow {
  id: number;
  character: string;
  level: number;
  reading_on: string | null;
  reading_kun: string | null;
  radical: string | null;
  stroke_count: number | null;
  meaning: string | null;
}

let currentUser: User = null;

let challengeQuestions: ChallengeQuestion[] = [];
let challengeIndex = 0;
let challengeScore = 0;
let lastChallengeLevel: string | null = null;

const app = document.querySelector<HTMLDivElement>("#app")!;

// ---------- API ----------

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data;
}

async function refreshUser(): Promise<void> {
  try {
    const data = await apiFetch("/api/auth/me");
    currentUser = data.user;
  } catch {
    currentUser = null;
  }
}

// ---------- ルーター ----------

function parseHash(): { path: string; params: URLSearchParams } {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, query] = hash.split("?");
  return { path: path || "/", params: new URLSearchParams(query || "") };
}

function navigate(path: string): void {
  location.hash = path;
}

// ---------- 共通ヘッダー ----------

function renderHeader(): string {
  const authArea = currentUser
    ? `<span>${escapeHtml(currentUser.username)} さん</span> <button id="logout-btn">ログアウト</button>`
    : `<a href="#/login">ログイン / 登録</a>`;

  return `
    <header class="app-header">
      <nav>
        <a href="#/">ホーム</a>
        <a href="#/study">スタディ</a>
      </nav>
      <div class="auth-status">${authArea}</div>
    </header>
  `;
}

function attachHeaderEvents(): void {
  document.querySelector<HTMLButtonElement>("#logout-btn")?.addEventListener("click", async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    currentUser = null;
    navigate("/");
    render();
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ---------- ホーム画面 ----------

function renderHome(): string {
  return `
    ${renderHeader()}
    <main>
      <h1>漢字マス — 出題レベルを選ぶ</h1>
      <div class="kanji-cell">漢</div>
      <label for="level-select">レベル</label>
      <select id="level-select">
        <option value="10">10級（小学1年相当）</option>
        <option value="9">9級（小学2年相当）</option>
        <option value="8">8級（小学3年相当）</option>
      </select>
      <div class="home-actions">
        <button id="challenge-btn" class="primary-btn">チャレンジコースへ</button>
        <button id="study-btn">スタディコースへ</button>
      </div>
    </main>
  `;
}

function attachHomeEvents(): void {
  const select = document.querySelector<HTMLSelectElement>("#level-select")!;
  document.querySelector("#challenge-btn")?.addEventListener("click", () => {
    navigate(`/challenge?level=${select.value}`);
  });
  document.querySelector("#study-btn")?.addEventListener("click", () => {
    navigate(`/study?level=${select.value}`);
  });
}

// ---------- ログイン / 登録画面 ----------

function renderLogin(): string {
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

function attachLoginEvents(): void {
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
      render();
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

// ---------- チャレンジコース ----------

async function renderChallenge(level: string): Promise<string> {
  if (!currentUser) {
    return `
      ${renderHeader()}
      <main>
        <h1>チャレンジコース</h1>
        <p>チャレンジコースの利用にはログインが必要です。</p>
        <a href="#/login">ログインする</a>
      </main>
    `;
  }

  if (challengeQuestions.length === 0 || level !== lastChallengeLevel) {
    const data = await apiFetch(`/api/questions/challenge?level=${level}`);
    challengeQuestions = data.questions;
    challengeIndex = 0;
    challengeScore = 0;
    lastChallengeLevel = level;
  }

  if (challengeIndex >= challengeQuestions.length) {
    return `
      ${renderHeader()}
      <main>
        <h1>結果発表</h1>
        <div class="kanji-cell">終</div>
        <p class="prompt">${challengeQuestions.length}問中 ${challengeScore}問 正解でした！</p>
        <div class="home-actions">
          <button id="retry-btn" class="primary-btn">もう一度挑戦する</button>
          <a href="#/">ホームに戻る</a>
        </div>
      </main>
    `;
  }

  const q = challengeQuestions[challengeIndex];
  const choicesHtml = (q.choices || [])
    .map(
      (c) =>
        `<label class="choice"><input type="radio" name="choice" value="${escapeHtml(c)}" /> ${escapeHtml(c)}</label>`
    )
    .join("");

  return `
    ${renderHeader()}
    <main>
      <h1>チャレンジコース（${escapeHtml(level)}級）</h1>
      <p class="progress">問題 ${challengeIndex + 1} / ${challengeQuestions.length}（正解 ${challengeScore}問）</p>
      <p class="prompt">${escapeHtml(q.prompt)}</p>
      <form id="challenge-form">
        ${choicesHtml}
        <button type="submit">回答する</button>
      </form>
      <p id="challenge-feedback" class="message"></p>
    </main>
  `;
}

function attachChallengeEvents(): void {
  if (!currentUser) return;

  if (challengeIndex >= challengeQuestions.length) {
    document.querySelector("#retry-btn")?.addEventListener("click", () => {
      challengeQuestions = [];
      lastChallengeLevel = null;
      render();
    });
    return;
  }

  const form = document.querySelector<HTMLFormElement>("#challenge-form");
  const feedback = document.querySelector<HTMLParagraphElement>("#challenge-feedback")!;

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const selected = form.querySelector<HTMLInputElement>('input[name="choice"]:checked');
    if (!selected) {
      feedback.textContent = "選択肢を選んでください。";
      return;
    }

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submitBtn.disabled = true;

    const q = challengeQuestions[challengeIndex];
    try {
      const result = await apiFetch("/api/questions/answer", {
        method: "POST",
        body: JSON.stringify({ questionId: q.id, answer: selected.value }),
      });

      feedback.classList.remove("correct", "incorrect");
      if (result.correct) {
        challengeScore++;
        feedback.classList.add("correct");
        feedback.textContent = "正解！";
      } else {
        feedback.classList.add("incorrect");
        feedback.textContent = `不正解。正解は「${escapeHtml(result.correctAnswer)}」でした。`;
      }

      setTimeout(() => {
        challengeIndex++;
        render();
      }, 900);
    } catch (err) {
      submitBtn.disabled = false;
      feedback.classList.add("incorrect");
      feedback.textContent = `エラー: ${(err as Error).message}`;
    }
  });
}

// ---------- スタディコース ----------

async function renderStudy(level: string, q: string): Promise<string> {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  if (q) params.set("q", q);

  const data = await apiFetch(`/api/kanji/study?${params.toString()}`);
  const kanjiList: KanjiRow[] = data.kanji;

  const rows = kanjiList
    .map(
      (k) => `
        <tr>
          <td class="kanji-char">${escapeHtml(k.character)}</td>
          <td>${k.level}級</td>
          <td>${escapeHtml(k.reading_on ?? "")}</td>
          <td>${escapeHtml(k.reading_kun ?? "")}</td>
        </tr>
      `
    )
    .join("");

  return `
    ${renderHeader()}
    <main>
      <h1>スタディコース</h1>
      <form id="study-form" class="study-form">
        <label>級
          <select id="study-level">
            <option value="10" ${level === "10" ? "selected" : ""}>10級</option>
            <option value="9" ${level === "9" ? "selected" : ""}>9級</option>
            <option value="8" ${level === "8" ? "selected" : ""}>8級</option>
          </select>
        </label>
        <label>検索
          <input type="text" id="study-q" value="${escapeHtml(q)}" placeholder="漢字・読みで検索" />
        </label>
        <button type="submit">検索</button>
      </form>
      <p>${kanjiList.length}件</p>
      <table class="kanji-table">
        <thead>
          <tr><th>漢字</th><th>級</th><th>音読み</th><th>訓読み</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </main>
  `;
}

function attachStudyEvents(): void {
  const form = document.querySelector<HTMLFormElement>("#study-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const level = document.querySelector<HTMLSelectElement>("#study-level")!.value;
    const q = document.querySelector<HTMLInputElement>("#study-q")!.value;
    navigate(`/study?level=${level}&q=${encodeURIComponent(q)}`);
  });
}

// ---------- 描画メイン ----------

async function render(): Promise<void> {
  const { path, params } = parseHash();

  if (path === "/login") {
    app.innerHTML = renderLogin();
    attachHeaderEvents();
    attachLoginEvents();
    return;
  }

  if (path === "/challenge") {
    const level = params.get("level") || "10";
    app.innerHTML = await renderChallenge(level);
    attachHeaderEvents();
    attachChallengeEvents();
    return;
  }

  if (path === "/study") {
    const level = params.get("level") || "10";
    const q = params.get("q") || "";
    app.innerHTML = await renderStudy(level, q);
    attachHeaderEvents();
    attachStudyEvents();
    return;
  }

  app.innerHTML = renderHome();
  attachHeaderEvents();
  attachHomeEvents();
}

window.addEventListener("hashchange", () => {
  render();
});

(async () => {
  await refreshUser();
  await render();
})();