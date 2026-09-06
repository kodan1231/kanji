export type User = { id: number; username: string; isAdmin: boolean } | null;
export type AdminTab = "kanji" | "questions";
export type SpiceLevel = "mild" | "medium" | "hot" | "veryhot" | "extreme";

export interface ChallengeQuestion {
  id: number;
  kanjiId: number;
  type: string;
  prompt: string;
}

export interface ChallengeFilter {
  tags: string;
  spice: SpiceLevel;
}

export interface KanjiRow {
  id: number;
  character: string;
  reading_on: string | null;
  reading_kun: string | null;
  meaning: string | null;
}

export interface TagRef {
  id: number;
  name: string;
}

export interface AdminKanjiRow extends KanjiRow {
  tags: TagRef[];
}

export interface AdminQuestionRow {
  id: number;
  kanjiId: number;
  character: string;
  prompt: string;
  correctAnswer: string;
  acceptedAnswers: string[] | null;
  accuracy: number;
  attempts: number;
  spiceLevels: string[];
}

export const SPICE_LABELS: Record<SpiceLevel, string> = {
  mild: "甘口",
  medium: "中辛",
  hot: "辛口",
  veryhot: "大辛",
  extreme: "激辛",
};
export const SPICE_ORDER: SpiceLevel[] = ["mild", "medium", "hot", "veryhot", "extreme"];
