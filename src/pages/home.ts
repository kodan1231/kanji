import { apiFetch, currentUser } from "../api";
import { navigate } from "../router";
import { renderHeader } from "../ui/header";
import { escapeHtml } from "../ui/format";
import { SPICE_LABELS, SPICE_ORDER } from "../types";
import type { SpiceLevel, TagRef } from "../types";

// このページでのみ使うタグ一覧キャッシュ
let allTagsCache: TagRef[] = [];

// 選択中のタグ名（ホームを開くたびにリセット）
let selectedTags = new Set<string>();

// ホーム画面で最初に表示するタグチップの数（超過分は「すべて見る」で展開）
// 小さい画面ではスクロールを避けるため少なめにする
function initialTagChipCount(): number {
  return window.innerWidth <= 430 ? 8 : 12;
}

// Fisher-Yates。元配列は変更せずシャッフル済みの新配列を返す
function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function ensureTagsCache(): Promise<TagRef[]> {
  if (allTagsCache.length === 0) {
    const data = await apiFetch("/api/tags");
    allTagsCache = data.tags;
  }
  return allTagsCache;
}

const DAY_TAG_RE = /^(\d+)日目$/;

// タグをグループ分けし、各グループ内をソートして返す（全件表示用）
function groupTags(tags: TagRef[]): { label: string; tags: TagRef[] }[] {
  const days: TagRef[] = [];
  const themes: TagRef[] = [];
  for (const t of tags) {
    (DAY_TAG_RE.test(t.name) ? days : themes).push(t);
  }
  themes.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  days.sort((a, b) => Number(a.name.match(DAY_TAG_RE)![1]) - Number(b.name.match(DAY_TAG_RE)![1]));

  const groups: { label: string; tags: TagRef[] }[] = [];
  if (themes.length > 0) groups.push({ label: "テーマ", tags: themes });
  if (days.length > 0) groups.push({ label: "学習日", tags: days });
  return groups;
}

function tagChipHtml(t: TagRef): string {
  const selected = selectedTags.has(t.name) ? " selected" : "";
  return `<button type="button" class="tag-chip${selected}" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`;
}

// 初期表示: ランダムに一部だけ
function partialTagChipsHtml(): string {
  const picks = shuffled(allTagsCache).slice(0, initialTagChipCount());
  const hasMore = allTagsCache.length > picks.length;
  return `
    <div class="tag-chip-list">${picks.map(tagChipHtml).join("")}</div>
    ${
      hasMore
        ? `<button type="button" class="tag-chip-more" id="home-tag-more">すべてのタグを見る（${allTagsCache.length}件）</button>`
        : ""
    }
  `;
}

// 全件表示: グループ分け＋ソート
function groupedTagChipsHtml(): string {
  return groupTags(allTagsCache)
    .map(
      (g) => `
        <div class="tag-group">
          <p class="tag-group-label">${escapeHtml(g.label)}</p>
          <div class="tag-chip-list">${g.tags.map(tagChipHtml).join("")}</div>
        </div>
      `
    )
    .join("");
}

function spiceSelectorHtml(selected: SpiceLevel): string {
  return `
    <div class="spice-selector">
      ${SPICE_ORDER.map(
        (level) => `
          <label class="spice-option spice-${level} ${level === selected ? "selected" : ""}">
            <input type="radio" name="spice" value="${level}" ${level === selected ? "checked" : ""} />
            <span>${SPICE_LABELS[level]}</span>
          </label>
        `
      ).join("")}
    </div>
  `;
}

function attachSpiceSelectorEvents(): void {
  const options = document.querySelectorAll<HTMLLabelElement>(".spice-option");
  options.forEach((opt) => {
    opt.addEventListener("click", () => {
      options.forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
  });
}

export async function renderHome(): Promise<string> {
  await ensureTagsCache();
  selectedTags = new Set();

  let statsHtml = "";
  if (currentUser) {
    try {
      const data = await apiFetch("/api/stats/by-spice");
      const stats: { spice: SpiceLevel; accuracy: number | null; attempts: number }[] = data.stats;
      const rows = SPICE_ORDER.map((level) => {
        const s = stats.find((x) => x.spice === level);
        const text =
          s && s.attempts > 0 ? `${Math.round((s.accuracy ?? 0) * 100)}%（${s.attempts}問）` : "回答なし";
        return `<li><span class="spice-stat-label spice-${level}">${SPICE_LABELS[level]}</span><span class="spice-stat-value">${text}</span></li>`;
      }).join("");
      statsHtml = `
        <div class="spice-stats">
          <p class="spice-stats-title">あなたの正答率</p>
          <ul>${rows}</ul>
        </div>
      `;
    } catch {
      statsHtml = "";
    }
  }

  return `
    ${renderHeader()}
    <main>
      <div class="home-hero">
        <div class="kanji-cell">漢</div>
        ${statsHtml}
      </div>

      <h2>難易度</h2>
      ${spiceSelectorHtml("medium")}

      <h2>タグ</h2>
      <div id="home-tag-chips">
        ${partialTagChipsHtml()}
      </div>

      <div class="home-actions">
        <button id="challenge-btn" class="primary-btn">開始</button>
      </div>
    </main>
  `;
}

export function attachHomeEvents(): void {
  attachSpiceSelectorEvents();

  const chipContainer = document.querySelector<HTMLDivElement>("#home-tag-chips");
  chipContainer?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    // 「すべてのタグを見る」→ グループ分け表示に差し替え
    if (target.id === "home-tag-more") {
      chipContainer.innerHTML = groupedTagChipsHtml();
      return;
    }

    const chip = target.closest<HTMLButtonElement>(".tag-chip");
    if (!chip) return;
    const name = chip.dataset.name;
    if (!name) return;
    if (selectedTags.has(name)) {
      selectedTags.delete(name);
      chip.classList.remove("selected");
    } else {
      selectedTags.add(name);
      chip.classList.add("selected");
    }
  });

  document.querySelector("#challenge-btn")?.addEventListener("click", () => {
    const tags = [...selectedTags].join(",");
    const spiceInput = document.querySelector<HTMLInputElement>('input[name="spice"]:checked');
    const spice = (spiceInput?.value as SpiceLevel) || "medium";

    const params = new URLSearchParams();
    if (tags) params.set("tags", tags);
    params.set("spice", spice);

    navigate(`/challenge?${params.toString()}`);
  });
}
