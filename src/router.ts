export function parseHash(): { path: string; params: URLSearchParams } {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, query] = hash.split("?");
  return { path: path || "/", params: new URLSearchParams(query || "") };
}

export function navigate(path: string): void {
  location.hash = path;
}
