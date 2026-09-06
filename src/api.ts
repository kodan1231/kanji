import type { User } from "./types";

export let currentUser: User = null;

export function setCurrentUser(user: User): void {
  currentUser = user;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
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

export async function refreshUser(): Promise<void> {
  try {
    const data = await apiFetch("/api/auth/me");
    currentUser = data.user;
  } catch {
    currentUser = null;
  }
}
