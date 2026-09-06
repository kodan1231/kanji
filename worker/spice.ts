// スパイス難易度 → 正答率レンジ（意図的に隣接帯とオーバーラップさせている）
export const SPICE_RANGES: Record<string, [number, number]> = {
  mild: [0.65, 1.01],
  medium: [0.5, 0.8],
  hot: [0.35, 0.65],
  veryhot: [0.2, 0.5],
  extreme: [0, 0.35],
};
