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
  difficulty?: number;
}

interface ChallengeFilter {
  levels: string;
  tagIds: string;
  difficultyMin: string;
  difficultyMax: string;
  mode: AnswerMode;
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
  difficulty: number;
}

let currentUser: User = null;

let challengeQuestions: ChallengeQuestion[] = [];
let challengeSubmitted = false;
let challengeResults: { correct: boolean; correctAnswer: string }[] = [];
let lastChallengeQuery: string | null = null;

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

// prompt文字列（例:「花」の読み方として正しいものはどれですか？）から「」内の表示部分だけを取り出す
function extractDisplayText(prompt: string): string {
  const match = prompt.match(/「(.+?)」/);
  return match ? match[1] : prompt;
}

// ---------- ホーム画面 ----------

async function renderHome(): Promise<string> {
  const tagsData = await apiFetch("/api/tags");
  const tags: TagRef[] = tagsData.tags;

  const tagCheckboxes = tags.length
    ? tags
        .map(
          (t) =>
            `<label class="checkbox-item"><input type="checkbox" class="challenge-tag" value="${t.id}" /> ${escapeHtml(t.name)}</label>`
        )
        .join("")
    : "<p>登録されているタグはまだありません。</p>";

  return `
    ${renderHeader()}
    <main>
      <h1>漢字マス</h1>
      <div class="kanji-cell">漢</div>

      <h2>チャレンジコースの出題条件</h2>
      <fieldset class="filter-group">
        <legend>級（複数選択可。未選択の場合は全級対象）</legend>
        <label class="checkbox-item"><input type="checkbox" class="challenge-level" value="10" /> 10級</label>
        <label class="checkbox-item"><input type="checkbox" class="challenge-level" value="9" /> 9級</label>
        <label class="checkbox-item"><input type="checkbox" class="challenge-level" value="8" /> 8級</label>
      </fieldset>

      <fieldset class="filter-group">
        <legend>タグ（複数選択可。未選択の場合は全タグ対象）</legend>
        ${tagCheckboxes}
      </fieldset>

      <fieldset class="filter-group">
        <legend>難易度（内部10段階。正答率が低いほど難しい）</legend>
        <label class="inline-label">最小
          <input type="number" id="difficulty-min" min="1" max="10" value="1" />
        </label>
        <label class="inline-label">最大
          <input type="number" id="difficulty-max" min="1" max="10" value="10" />
        </label>
      </fieldset>

      <label for="mode-select">回答形式</label>
      <select id="mode-select">
        <option value="choice">4択で選ぶ</option>
        <option value="input">文字を入力する</option>
      </select>

      <div class="home-actions">
        <button id="challenge-btn" class="primary-btn">チャレンジコースへ</button>
      </div>

      <h2>スタディコース</h2>
      <label for="home-study-level">級</label>
      <select id="home-study-level">
        <option value="10">10級（小学1年相当）</option>
        <option value="9">9級（小学2年相当）</option>
        <option value="8">8級（小学3年相当）</option>
      </select>
      <div class="home-actions">
        <button id="study-btn">スタディコースへ</button>
      </div>
    </main>
  `;
}

function attachHomeEvents(): void {
  document.querySelector("#challenge-btn")?.addEventListener("click", () => {
    const levels = Array.from(document.querySelectorAll<HTMLInputElement>(".challenge-level:checked")).map(
      (el) => el.value
    );
    const tagIds = Array.from(document.querySelectorAll<HTMLInputElement>(".challenge-tag:checked")).map(
      (el) => el.value
    );
    const difficultyMin = document.querySelector<HTMLInputElement>("#difficulty-min")!.value || "1";
    const difficultyMax = document.querySelector<HTMLInputElement>("#difficulty-max")!.value || "10";
    const mode = document.querySelector<HTMLSelectElement>("#mode-select")!.value;

    const params = new URLSearchParams();
    if (levels.length > 0) params.set("levels", levels.join(","));
    if (tagIds.length > 0) params.set("tagIds", tagIds.join(","));
    params.set("difficultyMin", difficultyMin);
    params.set("difficultyMax", difficultyMax);
    params.set("mode", mode);

    navigate(`/challenge?${params.toString()}`);
  });

  document.querySelector("#study-btn")?.addEventListener("click", () => {
    const level = document.querySelector<HTMLSelectElement>("#home-study-level")!.value;
    navigate(`/study?level=${level}`);
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

function challengeQueryKey(filter: ChallengeFilter): string {
  return `${filter.levels}|${filter.tagIds}|${filter.difficultyMin}|${filter.difficultyMax}`;
}

function challengeParams(filter: ChallengeFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.levels) params.set("levels", filter.levels);
  if (filter.tagIds) params.set("tagIds", filter.tagIds);
  params.set("difficultyMin", filter.difficultyMin);
  params.set("difficultyMax", filter.difficultyMax);
  return params;
}

function challengeHashParams(filter: ChallengeFilter): URLSearchParams {
  const params = challengeParams(filter);
  params.set("mode", filter.mode);
  return params;
}

async function renderChallenge(filter: ChallengeFilter): Promise<string> {
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

  const queryKey = challengeQueryKey(filter);
  if (challengeQuestions.length === 0 || queryKey !== lastChallengeQuery) {
    const data = await apiFetch(`/api/questions/challenge?${challengeParams(filter).toString()}`);
    challengeQuestions = data.questions;
    challengeSubmitted = false;
    challengeResults = [];
    lastChallengeQuery = queryKey;
  }

  if (challengeQuestions.length === 0) {
    return `
      ${renderHeader()}
      <main>
        <h1>チャレンジコース</h1>
        <p>指定した条件に合う問題が見つかりませんでした。条件を変えて試してください。</p>
        <a href="#/">ホームに戻る</a>
      </main>
    `;
  }

  if (challengeSubmitted) {
    const score = challengeResults.filter((r) => r.correct).length;
    const itemsHtml = challengeQuestions
      .map((q, i) => {
        const r = challengeResults[i];
        const cls = r.correct ? "correct" : "incorrect";
        const displayText = extractDisplayText(q.prompt);
        return `
          <div class="result-item ${cls}">
            <p class="prompt"><span class="q-number">${i + 1}.</span> <span class="q-kanji">${escapeHtml(displayText)}</span></p>
            <p class="message ${cls}">${
              r.correct ? "正解！" : `不正解。正解は「${escapeHtml(r.correctAnswer)}」でした。`
            }</p>
          </div>
        `;
      })
      .join("");

    return `
      ${renderHeader()}
      <main>
        <h1>結果発表</h1>
        <div class="kanji-cell">終</div>
        <p class="prompt">${challengeQuestions.length}問中 ${score}問 正解でした！</p>
        ${itemsHtml}
        <div class="home-actions">
          <button id="retry-btn" class="primary-btn">もう一度挑戦する</button>
          <a href="#/">ホームに戻る</a>
        </div>
      </main>
    `;
  }

  const instructionText =
    filter.mode === "input"
      ? "次の10問について、読み方をひらがなで入力してください。"
      : "次の10問について、正しい読み方を選んでください。";

  const questionsHtml = challengeQuestions
    .map((q, i) => {
      const displayText = extractDisplayText(q.prompt);
      const answerArea =
        filter.mode === "input"
          ? `<input type="text" id="answer-input-${i}" class="challenge-answer-input" autocomplete="off" />`
          : (q.choices || [])
              .map(
                (c) =>
                  `<label class="choice"><input type="radio" name="choice-${i}" value="${escapeHtml(c)}" /> ${escapeHtml(c)}</label>`
              )
              .join("");

      return `
        <div class="question-block">
          <p class="prompt"><span class="q-number">${i + 1}.</span> <span class="q-kanji">${escapeHtml(displayText)}</span></p>
          ${answerArea}
        </div>
      `;
    })
    .join("");

  return `
    ${renderHeader()}
    <main>
      <h1>チャレンジコース</h1>
      <p class="progress">${instructionText}</p>
      <form id="challenge-form">
        ${questionsHtml}
        <button type="submit" class="primary-btn">まとめて回答する</button>
      </form>
      <p id="challenge-feedback" class="message"></p>
    </main>
  `;
}

function attachChallengeEvents(filter: ChallengeFilter): void {
  if (!currentUser) return;
  if (challengeQuestions.length === 0) return;

  if (challengeSubmitted) {
    document.querySelector("#retry-btn")?.addEventListener("click", () => {
      challengeQuestions = [];
      lastChallengeQuery = null;
      challengeSubmitted = false;
      challengeResults = [];
      navigate(`/challenge?${challengeHashParams(filter).toString()}`);
      render();
    });
    return;
  }

  const form = document.querySelector<HTMLFormElement>("#challenge-form");
  const feedback = document.querySelector<HTMLParagraphElement>("#challenge-feedback")!;

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const answers: (string | null)[] = challengeQuestions.map((_, i) => {
      if (filter.mode === "input") {
        const input = document.querySelector<HTMLInputElement>(`#answer-input-${i}`);
        return input?.value.trim() || null;
      } else {
        const selected = form.querySelector<HTMLInputElement>(`input[name="choice-${i}"]:checked`);
        return selected?.value || null;
      }
    });

    if (answers.some((a) => !a)) {
      feedback.classList.remove("correct");
      feedback.classList.add("incorrect");
      feedback.textContent = "すべての問題に回答してください。";
      return;
    }

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submitBtn.disabled = true;
    feedback.classList.remove("correct", "incorrect");
    feedback.textContent = "採点中...";

    try {
      const results: { correct: boolean; correctAnswer: string }[] = [];
      for (let i = 0; i < challengeQuestions.length; i++) {
        const q = challengeQuestions[i];
        const result = await apiFetch("/api/questions/answer", {
          method: "POST",
          body: JSON.stringify({ questionId: q.id, answer: answers[i] }),
        });
        results.push({ correct: result.correct, correctAnswer: result.correctAnswer });
      }
      challengeResults = results;
      challengeSubmitted = true;
      render();
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
            <td>${q.difficulty}</td>
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
            <tr><th>ID</th><th>漢字</th><th>難易度</th><th>種別</th><th>問題文</th><th>正解</th><th>選択肢</th><th>許容する読み</th><th></th></tr>
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

function attachAdminEvents(tab: AdminTab, _level: string, _entryType: string, _tagId: string): void {
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
    const filter: ChallengeFilter = {
      levels: params.get("levels") || "",
      tagIds: params.get("tagIds") || "",
      difficultyMin: params.get("difficultyMin") || "1",
      difficultyMax: params.get("difficultyMax") || "10",
      mode: params.get("mode") === "input" ? "input" : "choice",
    };
    app.innerHTML = await renderChallenge(filter);
    attachHeaderEvents();
    attachChallengeEvents(filter);
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

  app.innerHTML = await renderHome();
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