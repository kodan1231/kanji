import "./style.css";

type User = { id: number; username: string; isAdmin: boolean } | null;
type AnswerMode = "choice" | "input";
type AdminTab = "kanji" | "questions";

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

interface TagRef {
  id: number;
  name: string;
}

interface AdminKanjiRow extends KanjiRow {
  entry_type: string;
  tags: TagRef[];
}

interface AdminQuestionRow {
  id: number;
  kanjiId: number;
  character: string;
  level: number;
  type: string;
  prompt: string;
  correctAnswer: string;
  choices: string[] | null;
  acceptedAnswers: string[] | null;
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

  const adminLink = currentUser?.isAdmin ? `<a href="#/admin">管理</a>` : "";

  return `
    <header class="app-header">
      <nav>
        <a href="#/">ホーム</a>
        <a href="#/study">スタディ</a>
        ${adminLink}
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
      <label for="mode-select">チャレンジの回答形式</label>
      <select id="mode-select">
        <option value="choice">4択で選ぶ</option>
        <option value="input">文字を入力する</option>
      </select>
      <div class="home-actions">
        <button id="challenge-btn" class="primary-btn">チャレンジコースへ</button>
        <button id="study-btn">スタディコースへ</button>
      </div>
    </main>
  `;
}

function attachHomeEvents(): void {
  const levelSelect = document.querySelector<HTMLSelectElement>("#level-select")!;
  const modeSelect = document.querySelector<HTMLSelectElement>("#mode-select")!;
  document.querySelector("#challenge-btn")?.addEventListener("click", () => {
    navigate(`/challenge?level=${levelSelect.value}&mode=${modeSelect.value}`);
  });
  document.querySelector("#study-btn")?.addEventListener("click", () => {
    navigate(`/study?level=${levelSelect.value}`);
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

async function renderChallenge(level: string, mode: AnswerMode): Promise<string> {
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

  const answerAreaHtml =
    mode === "input"
      ? `
        <label for="answer-input">読み方をひらがなで入力してください</label>
        <input type="text" id="answer-input" autocomplete="off" autofocus />
      `
      : (q.choices || [])
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
        ${answerAreaHtml}
        <button type="submit">回答する</button>
      </form>
      <p id="challenge-feedback" class="message"></p>
    </main>
  `;
}

function attachChallengeEvents(level: string, mode: AnswerMode): void {
  if (!currentUser) return;

  if (challengeIndex >= challengeQuestions.length) {
    document.querySelector("#retry-btn")?.addEventListener("click", () => {
      challengeQuestions = [];
      lastChallengeLevel = null;
      navigate(`/challenge?level=${level}&mode=${mode}`);
      render();
    });
    return;
  }

  const form = document.querySelector<HTMLFormElement>("#challenge-form");
  const feedback = document.querySelector<HTMLParagraphElement>("#challenge-feedback")!;

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    let answer: string | null = null;
    if (mode === "input") {
      const input = document.querySelector<HTMLInputElement>("#answer-input");
      answer = input?.value.trim() || null;
      if (!answer) {
        feedback.textContent = "読み方を入力してください。";
        return;
      }
    } else {
      const selected = form.querySelector<HTMLInputElement>('input[name="choice"]:checked');
      if (!selected) {
        feedback.textContent = "選択肢を選んでください。";
        return;
      }
      answer = selected.value;
    }

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submitBtn.disabled = true;

    const q = challengeQuestions[challengeIndex];
    try {
      const result = await apiFetch("/api/questions/answer", {
        method: "POST",
        body: JSON.stringify({ questionId: q.id, answer }),
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

// ---------- 管理画面 ----------

function levelFilterOptions(current: string): string {
  const levels = ["", "10", "9", "8"];
  const labels: Record<string, string> = { "": "すべて", "10": "10級", "9": "9級", "8": "8級" };
  return levels
    .map((lv) => `<option value="${lv}" ${current === lv ? "selected" : ""}>${labels[lv]}</option>`)
    .join("");
}

function entryTypeOptionsHtml(current: string): string {
  const types = [
    { value: "", label: "すべて" },
    { value: "kanji", label: "漢字" },
    { value: "word", label: "熟語" },
    { value: "yoji", label: "四字熟語" },
  ];
  return types
    .map((t) => `<option value="${t.value}" ${current === t.value ? "selected" : ""}>${t.label}</option>`)
    .join("");
}

function entryTypeSelectHtml(current: string, cssClass: string): string {
  const types = [
    { value: "kanji", label: "漢字" },
    { value: "word", label: "熟語" },
    { value: "yoji", label: "四字熟語" },
  ];
  return `
    <select class="${cssClass}">
      ${types.map((t) => `<option value="${t.value}" ${current === t.value ? "selected" : ""}>${t.label}</option>`).join("")}
    </select>
  `;
}

async function renderAdmin(tab: AdminTab, level: string, entryType: string, tagId: string): Promise<string> {
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

  const tabNav = `
    <div class="admin-tabs">
      <a href="#/admin?tab=kanji" class="${tab === "kanji" ? "active" : ""}">漢字マスタ</a>
      <a href="#/admin?tab=questions" class="${tab === "questions" ? "active" : ""}">問題</a>
    </div>
  `;

  if (tab === "questions") {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    const data = await apiFetch(`/api/admin/questions?${params.toString()}`);
    const questions: AdminQuestionRow[] = data.questions;

    const rows = questions
      .map(
        (q) => `
          <tr data-id="${q.id}">
            <td>${q.id}</td>
            <td>${escapeHtml(q.character)}（${q.level}級）</td>
            <td><input class="f-type" value="${escapeHtml(q.type)}" style="width:6em" /></td>
            <td><input class="f-prompt" value="${escapeHtml(q.prompt)}" style="width:100%" /></td>
            <td><input class="f-correct" value="${escapeHtml(q.correctAnswer)}" style="width:6em" /></td>
            <td><input class="f-choices" value="${escapeHtml((q.choices || []).join(","))}" placeholder="カンマ区切り" /></td>
            <td><input class="f-accepted" value="${escapeHtml((q.acceptedAnswers || []).join(","))}" placeholder="カンマ区切り" /></td>
            <td>
              <button class="save-question-btn">保存</button>
              <button class="delete-question-btn">削除</button>
            </td>
          </tr>
        `
      )
      .join("");

    return `
      ${renderHeader()}
      <main>
        <h1>管理画面 — 問題</h1>
        ${tabNav}
        <form id="admin-filter-form" class="study-form">
          <label>級
            <select id="admin-level-filter">${levelFilterOptions(level)}</select>
          </label>
          <button type="submit">絞り込み</button>
        </form>
        <p>${questions.length}件</p>
        <table class="kanji-table admin-table">
          <thead>
            <tr><th>ID</th><th>漢字</th><th>種別</th><th>問題文</th><th>正解</th><th>選択肢</th><th>許容する読み</th><th></th></tr>
          </thead>
          <tbody id="admin-question-rows">${rows}</tbody>
        </table>

        <h2>新規追加</h2>
        <form id="admin-new-question-form" class="admin-new-form">
          <label>漢字ID（漢字マスタ一覧のIDを指定）
            <input type="number" id="new-q-kanji-id" required />
          </label>
          <label>種別（reading / writing / radical など）
            <input type="text" id="new-q-type" value="reading" required />
          </label>
          <label>問題文
            <input type="text" id="new-q-prompt" required />
          </label>
          <label>正解
            <input type="text" id="new-q-correct" required />
          </label>
          <label>選択肢（カンマ区切り、任意）
            <input type="text" id="new-q-choices" />
          </label>
          <label>許容する読み（カンマ区切り、任意）
            <input type="text" id="new-q-accepted" />
          </label>
          <button type="submit" class="primary-btn">追加</button>
        </form>
        <p id="admin-message" class="message"></p>
      </main>
    `;
  }

  // tab === "kanji"
  const tagsData = await apiFetch("/api/admin/tags");
  const allTags: (TagRef & { usage_count: number })[] = tagsData.tags;

  const params = new URLSearchParams();
  if (level) params.set("level", level);
  if (entryType) params.set("entryType", entryType);
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
          <td>${k.id}</td>
          <td>${entryTypeSelectHtml(k.entry_type, "f-entry-type")}</td>
          <td><input class="f-character" value="${escapeHtml(k.character)}" style="width:6em" /></td>
          <td><input class="f-level" type="number" value="${k.level}" style="width:4em" /></td>
          <td><input class="f-on" value="${escapeHtml(k.reading_on ?? "")}" /></td>
          <td><input class="f-kun" value="${escapeHtml(k.reading_kun ?? "")}" /></td>
          <td><input class="f-radical" value="${escapeHtml(k.radical ?? "")}" style="width:3em" /></td>
          <td><input class="f-stroke" type="number" value="${k.stroke_count ?? ""}" style="width:4em" /></td>
          <td><input class="f-meaning" value="${escapeHtml(k.meaning ?? "")}" /></td>
          <td><input class="f-tags" value="${escapeHtml(k.tags.map((t) => t.name).join(","))}" placeholder="カンマ区切り" /></td>
          <td>
            <button class="save-kanji-btn">保存</button>
            <button class="delete-kanji-btn">削除</button>
          </td>
        </tr>
      `
    )
    .join("");

  return `
    ${renderHeader()}
    <main>
      <h1>管理画面 — 漢字マスタ</h1>
      ${tabNav}
      <form id="admin-filter-form" class="study-form">
        <label>級
          <select id="admin-level-filter">${levelFilterOptions(level)}</select>
        </label>
        <label>種別
          <select id="admin-entry-type-filter">${entryTypeOptionsHtml(entryType)}</select>
        </label>
        <label>タグ
          <select id="admin-tag-filter">${tagFilterOptions}</select>
        </label>
        <button type="submit">絞り込み</button>
      </form>
      <p>${kanjiList.length}件</p>
      <table class="kanji-table admin-table">
        <thead>
          <tr><th>ID</th><th>種別</th><th>文字</th><th>級</th><th>音読み</th><th>訓読み</th><th>部首</th><th>画数</th><th>意味</th><th>タグ</th><th></th></tr>
        </thead>
        <tbody id="admin-kanji-rows">${rows}</tbody>
      </table>

      <h2>新規追加</h2>
      <form id="admin-new-kanji-form" class="admin-new-form">
        <label>種別
          ${entryTypeSelectHtml("kanji", "new-k-entry-type")}
        </label>
        <label>文字（1文字の漢字、熟語、四字熟語など）
          <input type="text" id="new-k-character" required />
        </label>
        <label>級
          <input type="number" id="new-k-level" required style="max-width:6em" />
        </label>
        <label>音読み
          <input type="text" id="new-k-on" />
        </label>
        <label>訓読み
          <input type="text" id="new-k-kun" />
        </label>
        <label>部首
          <input type="text" id="new-k-radical" style="max-width:6em" />
        </label>
        <label>画数
          <input type="number" id="new-k-stroke" style="max-width:6em" />
        </label>
        <label>意味
          <input type="text" id="new-k-meaning" />
        </label>
        <label>タグ（カンマ区切り、任意。新しいタグ名は自動作成されます）
          <input type="text" id="new-k-tags" placeholder="例: 動物,水中生物" />
        </label>
        <button type="submit" class="primary-btn">追加</button>
      </form>

      <h2>タグ一覧</h2>
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
      <p id="admin-message" class="message"></p>
    </main>
  `;
}

function attachAdminEvents(tab: AdminTab, level: string, entryType: string, tagId: string): void {
  if (!currentUser?.isAdmin) return;

  const filterForm = document.querySelector<HTMLFormElement>("#admin-filter-form");
  filterForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const newLevel = document.querySelector<HTMLSelectElement>("#admin-level-filter")!.value;
    if (tab === "kanji") {
      const newEntryType = document.querySelector<HTMLSelectElement>("#admin-entry-type-filter")!.value;
      const newTagId = document.querySelector<HTMLSelectElement>("#admin-tag-filter")!.value;
      navigate(`/admin?tab=kanji&level=${newLevel}&entryType=${newEntryType}&tagId=${newTagId}`);
    } else {
      navigate(`/admin?tab=questions&level=${newLevel}`);
    }
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

  if (tab === "kanji") {
    const tbody = document.querySelector<HTMLTableSectionElement>("#admin-kanji-rows");

    tbody?.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      const tr = target.closest("tr");
      if (!tr) return;
      const id = tr.dataset.id;

      if (target.classList.contains("save-kanji-btn")) {
        const payload = {
          entry_type: tr.querySelector<HTMLSelectElement>(".f-entry-type")!.value,
          character: tr.querySelector<HTMLInputElement>(".f-character")!.value,
          level: Number(tr.querySelector<HTMLInputElement>(".f-level")!.value),
          reading_on: tr.querySelector<HTMLInputElement>(".f-on")!.value || null,
          reading_kun: tr.querySelector<HTMLInputElement>(".f-kun")!.value || null,
          radical: tr.querySelector<HTMLInputElement>(".f-radical")!.value || null,
          stroke_count: tr.querySelector<HTMLInputElement>(".f-stroke")!.value
            ? Number(tr.querySelector<HTMLInputElement>(".f-stroke")!.value)
            : null,
          meaning: tr.querySelector<HTMLInputElement>(".f-meaning")!.value || null,
          tags: splitCsv(tr.querySelector<HTMLInputElement>(".f-tags")!.value) || [],
        };
        try {
          await apiFetch(`/api/admin/kanji/${id}`, { method: "PUT", body: JSON.stringify(payload) });
          showMessage("保存しました。", true);
        } catch (err) {
          showMessage(`保存に失敗しました: ${(err as Error).message}`, false);
        }
      }

      if (target.classList.contains("delete-kanji-btn")) {
        if (!confirm("このエントリと、関連する問題・回答履歴もすべて削除されます。よろしいですか？")) return;
        try {
          await apiFetch(`/api/admin/kanji/${id}`, { method: "DELETE" });
          render();
        } catch (err) {
          showMessage(`削除に失敗しました: ${(err as Error).message}`, false);
        }
      }
    });

    const newForm = document.querySelector<HTMLFormElement>("#admin-new-kanji-form");
    newForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        entry_type: document.querySelector<HTMLSelectElement>(".new-k-entry-type")!.value,
        character: document.querySelector<HTMLInputElement>("#new-k-character")!.value,
        level: Number(document.querySelector<HTMLInputElement>("#new-k-level")!.value),
        reading_on: document.querySelector<HTMLInputElement>("#new-k-on")!.value || null,
        reading_kun: document.querySelector<HTMLInputElement>("#new-k-kun")!.value || null,
        radical: document.querySelector<HTMLInputElement>("#new-k-radical")!.value || null,
        stroke_count: document.querySelector<HTMLInputElement>("#new-k-stroke")!.value
          ? Number(document.querySelector<HTMLInputElement>("#new-k-stroke")!.value)
          : null,
        meaning: document.querySelector<HTMLInputElement>("#new-k-meaning")!.value || null,
        tags: splitCsv(document.querySelector<HTMLInputElement>("#new-k-tags")!.value),
      };
      try {
        await apiFetch("/api/admin/kanji", { method: "POST", body: JSON.stringify(payload) });
        showMessage("追加しました。", true);
        render();
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
        render();
      } catch (err) {
        showMessage(`タグ削除に失敗しました: ${(err as Error).message}`, false);
      }
    });
    return;
  }

  // tab === "questions"
  const tbody = document.querySelector<HTMLTableSectionElement>("#admin-question-rows");

  tbody?.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const tr = target.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;

    if (target.classList.contains("save-question-btn")) {
      const payload = {
        type: tr.querySelector<HTMLInputElement>(".f-type")!.value,
        prompt: tr.querySelector<HTMLInputElement>(".f-prompt")!.value,
        correct_answer: tr.querySelector<HTMLInputElement>(".f-correct")!.value,
        choices: splitCsv(tr.querySelector<HTMLInputElement>(".f-choices")!.value),
        accepted_answers: splitCsv(tr.querySelector<HTMLInputElement>(".f-accepted")!.value),
      };
      try {
        await apiFetch(`/api/admin/questions/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        showMessage("保存しました。", true);
      } catch (err) {
        showMessage(`保存に失敗しました: ${(err as Error).message}`, false);
      }
    }

    if (target.classList.contains("delete-question-btn")) {
      if (!confirm("この問題と、関連する回答履歴もすべて削除されます。よろしいですか？")) return;
      try {
        await apiFetch(`/api/admin/questions/${id}`, { method: "DELETE" });
        render();
      } catch (err) {
        showMessage(`削除に失敗しました: ${(err as Error).message}`, false);
      }
    }
  });

  const newForm = document.querySelector<HTMLFormElement>("#admin-new-question-form");
  newForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      kanjiId: Number(document.querySelector<HTMLInputElement>("#new-q-kanji-id")!.value),
      type: document.querySelector<HTMLInputElement>("#new-q-type")!.value,
      prompt: document.querySelector<HTMLInputElement>("#new-q-prompt")!.value,
      correct_answer: document.querySelector<HTMLInputElement>("#new-q-correct")!.value,
      choices: splitCsv(document.querySelector<HTMLInputElement>("#new-q-choices")!.value),
      accepted_answers: splitCsv(document.querySelector<HTMLInputElement>("#new-q-accepted")!.value),
    };
    try {
      await apiFetch("/api/admin/questions", { method: "POST", body: JSON.stringify(payload) });
      showMessage("追加しました。", true);
      render();
    } catch (err) {
      showMessage(`追加に失敗しました: ${(err as Error).message}`, false);
    }
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
    const mode: AnswerMode = params.get("mode") === "input" ? "input" : "choice";
    app.innerHTML = await renderChallenge(level, mode);
    attachHeaderEvents();
    attachChallengeEvents(level, mode);
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

  if (path === "/admin") {
    const tab: AdminTab = params.get("tab") === "questions" ? "questions" : "kanji";
    const level = params.get("level") || "";
    const entryType = params.get("entryType") || "";
    const tagId = params.get("tagId") || "";
    app.innerHTML = await renderAdmin(tab, level, entryType, tagId);
    attachHeaderEvents();
    attachAdminEvents(tab, level, entryType, tagId);
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