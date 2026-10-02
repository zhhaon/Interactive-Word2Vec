/**
 * 检索模块
 * ------------------------------------------------------------------
 * · 依据词频构建「按词频降序」的索引 order，使得「词频 ≥ 阈值」的候选词
 *   恰好是 order 的一段连续前缀，可用二分在 O(log N) 内定位，
 *   高阈值时只需扫描极少量候选词。
 * · 候选词内计算与查询词的余弦相似度，取出最相似的 Top5
 *   与最多 50 个周围词（均排除查询词自身）。
 */

const EPS = 1e-12;

/** 构建（并缓存）词频降序索引 */
export function buildFrequencyIndex(model) {
  if (model.order) return model.order;
  const { counts, count } = model;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  order.sort((a, b) => counts[b] - counts[a]);
  model.order = order;
  return order;
}

/**
 * 二分统计词频 ≥ threshold 的词数量
 * @returns {number}
 */
export function countEligible(model, threshold) {
  const order = buildFrequencyIndex(model);
  const { counts, count } = model;
  const limit = Math.max(0, Math.floor(threshold));
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (counts[order[mid]] >= limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 把用户输入解析为词表中的词（大小写与首尾空白容错） */
export function resolveWord(model, input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const variants = [raw, raw.toLowerCase(), raw.toUpperCase()];
  const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  variants.push(capitalized);
  variants.push(raw.charAt(0).toLowerCase() + raw.slice(1));

  for (const v of variants) {
    if (model.index.has(v)) return v;
  }
  return null;
}

/** 在固定容量数组中按相似度降序插入 */
function pushTop(topIdx, topSim, slot, idx, sim, capacity) {
  if (slot < capacity) {
    let j = slot;
    while (j > 0 && topSim[j - 1] < sim) {
      topSim[j] = topSim[j - 1];
      topIdx[j] = topIdx[j - 1];
      j -= 1;
    }
    topSim[j] = sim;
    topIdx[j] = idx;
    return slot + 1;
  }
  if (sim <= topSim[capacity - 1]) return slot;
  let j = capacity - 1;
  while (j > 0 && topSim[j - 1] < sim) {
    topSim[j] = topSim[j - 1];
    topIdx[j] = topIdx[j - 1];
    j -= 1;
  }
  topSim[j] = sim;
  topIdx[j] = idx;
  return slot;
}

/**
 * 执行一次查询。
 * @param {object} model loadModel 的返回值
 * @param {string} inputWord 用户输入
 * @param {number} threshold 词频阈值
 * @param {{ topK?: number, neighborLimit?: number }} options
 */
export function search(model, inputWord, threshold, options = {}) {
  const topK = options.topK ?? 5;
  const neighborLimit = options.neighborLimit ?? 50;

  const word = resolveWord(model, inputWord);
  if (!word) {
    return { ok: false, reason: 'not-found', word: String(inputWord ?? '').trim() };
  }

  const { dim, counts, vectors, norms } = model;
  const qi = model.index.get(word);
  const qNorm = norms[qi];

  if (!(qNorm > EPS)) {
    return { ok: false, reason: 'zero-vector', word, index: qi, freq: counts[qi] };
  }

  const order = buildFrequencyIndex(model);
  const eligible = countEligible(model, threshold);

  if (eligible === 0) {
    return {
      ok: false,
      reason: 'no-candidate',
      word,
      index: qi,
      freq: counts[qi],
      eligible,
      maxFreq: model.maxFreq,
    };
  }

  const capacity = Math.max(topK, neighborLimit);
  const topIdx = new Int32Array(capacity);
  const topSim = new Float32Array(capacity);
  let slot = 0;

  const qOffset = qi * dim;
  const invQNorm = 1 / qNorm;

  for (let p = 0; p < eligible; p += 1) {
    const idx = order[p];
    if (idx === qi) continue;

    const n = norms[idx];
    if (!(n > EPS)) continue;

    const offset = idx * dim;
    let dot = 0;
    for (let d = 0; d < dim; d += 1) dot += vectors[qOffset + d] * vectors[offset + d];

    const sim = dot * invQNorm / n;
    slot = pushTop(topIdx, topSim, slot, idx, sim, capacity);
  }

  const ranked = [];
  for (let i = 0; i < slot; i += 1) {
    const idx = topIdx[i];
    ranked.push({
      index: idx,
      word: model.words[idx],
      freq: counts[idx],
      sim: topSim[i],
    });
  }

  const top = ranked.slice(0, topK);
  const neighbors = ranked.slice(0, neighborLimit);

  return {
    ok: true,
    word,
    index: qi,
    freq: counts[qi],
    eligible,
    scanned: eligible,
    selfScored: counts[qi] >= Math.max(0, Math.floor(threshold)),
    top,
    neighbors,
  };
}
