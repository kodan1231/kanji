import { apiFetch, currentUser } from "../api";
import { navigate } from "../router";
import { renderHeader } from "../ui/header";
import { escapeHtml } from "../ui/format";
import { SPICE_LABELS, SPICE_ORDER } from "../types";
import type { SpiceLevel, TagRef } from "../types";

// このページでのみ使うタグ一覧キャッシュ
let allTagsCache: TagRef[] = [];

async function ensureTagsCache(): Promise<TagRef[]> {
  if (allTagsCache.length === 0) {
    const data = await apiFetch("/api/tags");
    allTagsCache = data.tags;
  }
  return allTagsCache;
}

function setupTagAutocomplete(inputId: string, suggestBoxId: string): void {
  const input = document.querySelector<HTMLInputElement>(`#${inputId}`);
  const box = document.querySelector<HTMLDivElement>(`#${suggestBoxId}`);
  if (!input || !box) return;

  const renderSuggestions = () => {
    const value = input.value;
    const lastCommaIndex = value.lastIndexOf(",");
    const currentSegment = value.slice(lastCommaIndex + 1).trim();

    if (!currentSegment) {
      box.innerHTML = "";
      box.classList.remove("open");
      return;
    }

    const matches = allTagsCache.filter((t) => t.name.includes(currentSegment)).slice(0, 8);

    if (matches.length === 0) {
      box.innerHTML = "";
      box.classList.remove("open");
      return;
    }

    box.innerHTML = matches
      .map((t) => `<div class="tag-suggestion" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>`)
      .join("");
    box.classList.add("open");
  };

  input.addEventListener("input", renderSuggestions);
  input.addEventListener("focus", renderSuggestions);
  input.addEventListener("blur", () => {
    setTimeout(() => box.classList.remove("open"), 150);
  });

  box.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    const name = target.dataset.name;
    if (!name) return;
    const value = input.value;
    const lastCommaIndex = value.lastIndexOf(",");
    const prefix = lastCommaIndex >= 0 ? value.slice(0, lastCommaIndex + 1) + " " : "";
    input.value = `${prefix}${name}, `;
    box.classList.remove("open");
    input.focus();
  });
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

      <h2>タグ（カンマ区切り。未入力で全タグ対象。指定すると難易度に関わらず全体から出題されます）</h2>
      <div class="tag-input-wrapper">
        <input type="text" id="challenge-tags-input" placeholder="例: 動物, 数字" autocomplete="off" />
        <div class="tag-suggestions" id="challenge-tags-suggest"></div>
      </div>
      <div class="tag-chip-list" id="home-tag-chips">
        ${allTagsCache.map((t) => `<button type="button" class="tag-chip" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`).join("")}
      </div>

      <div class="home-actions">
        <button id="challenge-btn" class="primary-btn">開始</button>
      </div>
    </main>
  `;
}

function addTagToInput(input: HTMLInputElement, name: string): void {
  const existing = input.value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (existing.includes(name)) {
    input.focus();
    return;
  }
  existing.push(name);
  input.value = existing.join(", ") + ", ";
  input.focus();
}

export function attachHomeEvents(): void {
  setupTagAutocomplete("challenge-tags-input", "challenge-tags-suggest");
  attachSpiceSelectorEvents();

  const tagsInput = document.querySelector<HTMLInputElement>("#challenge-tags-input");
  document.querySelector("#home-tag-chips")?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const name = target.dataset.name;
    if (!name || !tagsInput) return;
    addTagToInput(tagsInput, name);
  });

  document.querySelector("#challenge-btn")?.addEventListener("click", () => {
    const tagsRaw = document.querySelector<HTMLInputElement>("#challenge-tags-input")!.value;
    const tags = tagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join(",");
    const spiceInput = document.querySelector<HTMLInputElement>('input[name="spice"]:checked');
    const spice = (spiceInput?.value as SpiceLevel) || "medium";

    const params = new URLSearchParams();
    if (tags) params.set("tags", tags);
    params.set("spice", spice);

    navigate(`/challenge?${params.toString()}`);
  });
}
