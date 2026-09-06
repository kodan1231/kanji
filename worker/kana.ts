export function kataToHira(s: string): string {
  let result = "";
  for (const c of s) {
    const code = c.codePointAt(0) ?? 0;
    if (code >= 0x30a1 && code <= 0x30f6) {
      result += String.fromCodePoint(code - 0x60);
    } else {
      result += c;
    }
  }
  return result;
}

export function readingVariants(on: string | null, kun: string | null): string[] {
  const variants: string[] = [];
  if (kun) {
    for (const part of kun.split("・")) {
      const base = kataToHira(part.split("(")[0].trim());
      if (base && !variants.includes(base)) variants.push(base);
    }
  }
  if (on) {
    for (const part of on.split("・")) {
      const hira = kataToHira(part).trim();
      if (hira && !variants.includes(hira)) variants.push(hira);
    }
  }
  return variants;
}

export function analyzeKun(
  kun: string | null
): { base: string; okuri: string; full: string; hasOkuri: boolean } | null {
  if (!kun) return null;
  const first = kataToHira(kun.split("・")[0]);
  const parenIndex = first.indexOf("(");
  if (parenIndex >= 0) {
    const base = first.slice(0, parenIndex);
    const rest = first.slice(parenIndex + 1);
    const okuri = rest.split(")")[0];
    return { base, okuri, full: base + okuri, hasOkuri: true };
  }
  return { base: first, okuri: "", full: first, hasOkuri: false };
}

// 音読み・訓読みから「読み問題」を自動生成する。読みが1つも無ければnullを返す。
export function buildReadingQuestion(
  character: string,
  readingOn: string | null,
  readingKun: string | null
): { prompt: string; correctAnswer: string; acceptedAnswers: string[] } | null {
  const kunInfo = analyzeKun(readingKun);
  let displayChar: string;
  let correct: string;
  let accepted: string[];

  if (kunInfo && kunInfo.hasOkuri) {
    displayChar = character + kunInfo.okuri;
    correct = kunInfo.full;
    accepted = [correct];
  } else {
    displayChar = character;
    if (kunInfo) {
      correct = kunInfo.base;
    } else if (readingOn) {
      correct = kataToHira(readingOn.split("・")[0]);
    } else {
      correct = "";
    }
    accepted = readingVariants(readingOn, readingKun);
    if (accepted.length === 0 && correct) accepted = [correct];
  }

  if (!correct) return null;

  return {
    prompt: `「${displayChar}」の読み方を答えてください。`,
    correctAnswer: correct,
    acceptedAnswers: accepted,
  };
}
