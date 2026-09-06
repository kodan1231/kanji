import type { Env, SessionUser } from "./env";

export const SESSION_COOKIE = "session_token";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30日

async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
}

function bufferToHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${bufferToHex(salt)}:${bufferToHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  const salt = hexToBuffer(saltHex);
  const hash = await pbkdf2(password, salt);
  return bufferToHex(hash) === hashHex;
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const cookies: Record<string, string> = {};
  header.split(";").forEach((pair) => {
    const [k, v] = pair.trim().split("=");
    if (k) cookies[k] = decodeURIComponent(v || "");
  });
  return cookies;
}

export async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await env.DB
    .prepare(
      `SELECT u.id, u.username, u.is_admin FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .bind(token)
    .first<{ id: number; username: string; is_admin: number }>();

  if (!session) return null;
  return { id: session.id, username: session.username, isAdmin: session.is_admin === 1 };
}
