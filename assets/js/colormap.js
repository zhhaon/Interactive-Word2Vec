/**
 * 配色映射模块
 * ------------------------------------------------------------------
 * · 发散色标（蓝 — 中性 — 红）：用于向量数值，直观区分正负
 * · 顺序色标（靛 — 青 — 薄荷）：用于相似度
 */

/** 发散色标控制点：[位置, r, g, b] */
const DIVERGING_STOPS = [
  [0.0, 0x1d, 0x4e, 0xd8],
  [0.22, 0x25, 0x63, 0xeb],
  [0.4, 0x38, 0xbd, 0xf8],
  [0.5, 0xe8, 0xed, 0xf7],
  [0.62, 0xfb, 0x71, 0x85],
  [0.8, 0xef, 0x44, 0x44],
  [1.0, 0x99, 0x1b, 0x1b],
];

/** 顺序色标控制点 */
const SEQUENTIAL_STOPS = [
  [0.0, 0x31, 0x2e, 0x81],
  [0.35, 0x63, 0x66, 0xf1],
  [0.7, 0x22, 0xd3, 0xee],
  [1.0, 0xa7, 0xf3, 0xd0],
];

function clamp01(t) {
  if (!Number.isFinite(t)) return 0;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function sample(stops, t) {
  const x = clamp01(t);
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [p0, r0, g0, b0] = stops[i];
    const [p1, r1, g1, b1] = stops[i + 1];
    if (x >= p0 && x <= p1) {
      const k = p1 === p0 ? 0 : (x - p0) / (p1 - p0);
      return [
        Math.round(r0 + (r1 - r0) * k),
        Math.round(g0 + (g1 - g0) * k),
        Math.round(b0 + (b1 - b0) * k),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

/** 数值 → CSS 颜色（发散色标，domain 为 [min, max]） */
export function divergingColor(value, min, max) {
  const span = max - min;
  const t = span > 0 ? (value - min) / span : 0.5;
  const [r, g, b] = sample(DIVERGING_STOPS, t);
  return `rgb(${r},${g},${b})`;
}

/** 归一化值 t(0~1) → CSS 颜色（顺序色标） */
export function sequentialColor(t) {
  const [r, g, b] = sample(SEQUENTIAL_STOPS, t);
  return `rgb(${r},${g},${b})`;
}

/** 热力图单元格颜色（固定/自适应共用同一发散色标） */
export function heatColor(value, min, max) {
  const span = max - min;
  const t = span > 0 ? (value - min) / span : 0.5;
  const [r, g, b] = sample(DIVERGING_STOPS, t);
  return `rgb(${r},${g},${b})`;
}

/** 生成 CSS linear-gradient，用于图例条 */
export function gradientCss(stops, kind = 'diverging') {
  const list = stops || (kind === 'sequential' ? SEQUENTIAL_STOPS : DIVERGING_STOPS);
  const parts = list.map(([p, r, g, b]) => `rgb(${r},${g},${b}) ${(p * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

export function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export { DIVERGING_STOPS, SEQUENTIAL_STOPS };
