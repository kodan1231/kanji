import { apiFetch, currentUser } from "../api";
import { navigate } from "../router";
import { renderHeader } from "../ui/header";
import { escapeHtml, extractDisplayText } from "../ui/format";
import { SPICE_LABELS } from "../types";
import type { ChallengeFilter, ChallengeQuestion } from "../types";

// このページでのみ使う出題状態（SPA内で保持）
let challengeQuestions: ChallengeQuestion[] = [];
let challengeSubmitted = false;
let challengeResults: { correct: boolean; correctAnswer: string }[] = [];
let lastChallengeQuery: string | null = null;
let hintOutsideClickHandlerAttached = false;

// 開いているヒントの外側をクリックしたら閉じる（document監視は初回のみ登録）
function ensureHintOutsideClickHandler(): void {
  if (hintOutsideClickHandlerAttached) return;
  hintOutsideClickHandlerAttached = true;
  document.addEventListener("click", () => {
    document.querySelectorAll<HTMLButtonElement>(".hint-toggle.open").forEach((btn) => btn.classList.remove("open"));
  });
}

function challengeQueryKey(filter: ChallengeFilter): string {
  return `${filter.tags}|${filter.spice}`;
}

function challengeParams(filter: ChallengeFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.tags) params.set("tags", filter.tags);
  params.set("spice", filter.spice);
  return params;
}

export async function renderChallenge(filter: ChallengeFilter): Promise<string> {
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
        <p>指定した条件（タグ: ${filter.tags ? escapeHtml(filter.tags) : "指定なし"} / 難易度: ${SPICE_LABELS[filter.spice]}）に合う問題が見つかりませんでした。条件を変えて試してください。</p>
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

  const questionsHtml = challengeQuestions
    .map((q, i) => {
      const displayText = extractDisplayText(q.prompt);
      const hintHtml = q.hint
        ? `
          <button type="button" class="hint-toggle" aria-label="ヒントを見る">
            ？
            <span class="hint-bubble">${escapeHtml(q.hint)}</span>
          </button>
        `
        : "";
      return `
        <div class="question-block">
          <div class="question-prompt-row">
            <p class="prompt"><span class="q-number">${i + 1}.</span> <span class="q-kanji">${escapeHtml(displayText)}</span></p>
            ${hintHtml}
          </div>
          <input type="text" id="answer-input-${i}" class="challenge-answer-input" autocomplete="off" />
          <span class="input-warning" id="answer-warning-${i}"></span>
        </div>
      `;
    })
    .join("");

  return `
    ${renderHeader()}
    <main>
      <p class="progress">次の10問について、読み方をひらがなで入力してください。</p>
      <form id="challenge-form">
        ${questionsHtml}
        <button type="submit" class="primary-btn">まとめて回答する</button>
      </form>
      <p id="challenge-feedback" class="message"></p>
    </main>
  `;
}

// rerender: 採点後や再挑戦時に画面を再描画するためのコールバック
export function attachChallengeEvents(filter: ChallengeFilter, rerender: () => void): void {
  if (!currentUser) return;
  if (challengeQuestions.length === 0) return;

  if (challengeSubmitted) {
    document.querySelector("#retry-btn")?.addEventListener("click", () => {
      challengeQuestions = [];
      lastChallengeQuery = null;
      challengeSubmitted = false;
      challengeResults = [];
      navigate(`/challenge?${challengeParams(filter).toString()}`);
      rerender();
    });
    return;
  }

  const form = document.querySelector<HTMLFormElement>("#challenge-form");
  const feedback = document.querySelector<HTMLParagraphElement>("#challenge-feedback")!;

  ensureHintOutsideClickHandler();
  document.querySelectorAll<HTMLButtonElement>(".hint-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      btn.classList.toggle("open");
    });
  });

  const HIRAGANA_ONLY = /^[ぁ-んー]*$/;

  challengeQuestions.forEach((_, i) => {
    const input = document.querySelector<HTMLInputElement>(`#answer-input-${i}`);
    const warning = document.querySelector<HTMLSpanElement>(`#answer-warning-${i}`);
    if (!input || !warning) return;
    input.addEventListener("blur", () => {
      const value = input.value.trim();
      if (value && !HIRAGANA_ONLY.test(value)) {
        warning.textContent = "ひらがなで入力してください";
      } else {
        warning.textContent = "";
      }
    });
    input.addEventListener("input", () => {
      if (warning.textContent) warning.textContent = "";
    });
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const answers: (string | null)[] = challengeQuestions.map((_, i) => {
      const input = document.querySelector<HTMLInputElement>(`#answer-input-${i}`);
      return input?.value.trim() || null;
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
      rerender();
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    } catch (err) {
      submitBtn.disabled = false;
      feedback.classList.add("incorrect");
      feedback.textContent = `エラー: ${(err as Error).message}`;
    }
  });
}
