export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function extractDisplayText(prompt: string): string {
  const match = prompt.match(/「(.+?)」/);
  return match ? match[1] : prompt;
}
