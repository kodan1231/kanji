export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export interface SessionUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

export interface TagRef {
  id: number;
  name: string;
}
