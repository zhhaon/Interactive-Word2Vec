/**
 * 应用入口与编排
 * ------------------------------------------------------------------
 * 串联「数据加载 → 词频阈值过滤 → 余弦相似度检索 → 图表渲染」的完整流程，
 * 并处理加载进度、输入校验、空状态与各类交互细节。
 */

import { loadModel } from './data-loader.js';
import { search, countEligible, resolveWord } from './search.js';
import { pca2d } from './pca.js';
import { gradientCss } from './colormap.js';
import { createHeatmap } from './heatmap.js';
import { createScatter } from './scatter.js';

const NEIGHBOR_LIMIT = 50;
const TOP_K = 5;

const dom = {
  topbar: document.getElementById('topbar'),
  metaVocab: document.getElementById('meta-vocab'),
  metaDim: document.getElementById('meta-dim'),
  metaFreq: document.getElementById('meta-freq'),
  drawerVocab: document.getElementById('drawer-vocab'),
  drawerDim: document.getElementById('drawer-dim'),

  form: document.getElementById('query-form'),
  wordInput: document.getElementById('word-input'),
  wordHint: document.getElementById('word-hint'),
  freqInput: document.getElementById('freq-input'),
  freqSlider: document.getElementById('freq-slider'),
  freqChips: document.getElementById('freq-chips'),
  searchBtn: document.getElementById('btn-search'),

  candidateCount: document.getElementById('candidate-count'),
  candidateBar: document.getElementById('candidate-bar'),
  candidateFoot: document.getElementById('candidate-foot'),

  modelState: document.getElementById('model-state'),
  modelStateText: document.getElementById('model-state-text'),

  loaderPanel: document.getElementById('loader-panel'),
  loaderPercent: document.getElementById('loader-percent'),
  loaderProgress: document.getElementById('loader-progress'),
  loaderBar: document.getElementById('loader-bar'),
  loaderDetail: document.getElementById('loader-detail'),
  loaderEta: document.getElementById('loader-eta'),

  statusStrip: document.getElementById('status-strip'),
  statusTag: document.getElementById('status-tag'),
  statusText: document.getElementById('status-text'),
  statusAside: document.getElementById('status-aside'),

  emptyState: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),
  emptyDesc: document.getElementById('empty-desc'),

  top5Panel: document.getElementById('top5-panel'),
  top5Grid: document.getElementById('top5-grid'),
  top5Sub: document.getElementById('top5-sub'),

  heatmapPanel: document.getElementById('heatmap-panel'),
  heatmapCanvas: document.getElementById('heatmap-canvas'),
  heatmapWrap: document.getElementById('heatmap-wrap'),
  heatmapTooltip: document.getElementById('heatmap-tooltip'),
  heatmapLegend: document.getElementById('heatmap-legend'),
  legendMin: document.getElementById('legend-min'),
  legendMax: document.getElementById('legend-max'),
  heatmapNote: document.getElementById('heatmap-note'),
  heatmapSub: document.getElementById('heatmap-sub'),
  domainFixed: document.getElementById('btn-domain-fixed'),
  domainAuto: document.getElementById('btn-domain-auto'),

  scatterPanel: document.getElementById('scatter-panel'),
  scatterSvg: document.getElementById('scatter-svg'),
  scatterTooltip: document.getElementById('scatter-tooltip'),
  scatterSub: document.getElementById('scatter-sub'),
  var1: document.getElementById('var-1'),
  var2: document.getElementById('var-2'),

  aboutBtn: document.getElementById('btn-about'),
  drawer: document.getElementById('about-drawer'),
  drawerBackdrop: document.getElementById('drawer-backdrop'),
  drawerClose: document.getElementById('btn-drawer-close'),
};

const state = {
  model: null,
  vectorDomain: [-2.18, 2.35],
  lastQuery: null,
  busy: false,
};

const heatmap = createHeatmap({
  canvas: dom.heatmapCanvas,
  tooltip: dom.heatmapTooltip,
  onPickWord: (word) => {
    dom.wordInput.value = word;
    runQuery(word);
  },
});

const scatter = createScatter({
  svg: dom.scatterSvg,
  tooltip: dom.scatterTooltip,
  onPickWord: (word) => {
    dom.wordInput.value = word;
    runQuery(word);
  },
});

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const fmt = (n) => Number(n).toLocaleString('en-US');

function animateNumber(node, to) {
  const from = Number(String(node.textContent).replace(/[^\d.-]/g, '')) || 0;
  if (from === to) {
    node.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const duration = 420;
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - (1 - t) ** 3;
    node.textContent = fmt(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setHint(node, text, kind) {
  node.textContent = text;
  node.classList.toggle('is-error', kind === 'error');
  node.classList.toggle('is-ok', kind === 'ok');
}

/* ------------------------------------------------------------------ */
/* 阈值控件                                                            */
/* ------------------------------------------------------------------ */

function freqBounds() {
  if (state.model) return { min: state.model.minFreq, max: state.model.maxFreq };
  return { min: 5, max: 1061396 };
}

function sliderToFreq(pos) {
  const { min, max } = freqBounds();
  const ratio = max / min;
  return Math.round(min * ratio ** (pos / 1000));
}

function freqToSlider(freq) {
  const { min, max } = freqBounds();
  const clamped = Math.min(Math.max(freq, min), max);
  return Math.round((Math.log(clamped / min) / Math.log(max / min)) * 1000);
}

function readThreshold() {
  const { min, max } = freqBounds();
  let value = Number(dom.freqInput.value);
  if (!Number.isFinite(value) || value < 1) value = 1;
  value = Math.min(Math.floor(value), max);
  return { value, min, max };
}

function syncThresholdUI(freq, options = {}) {
  const { max } = freqBounds();
  const value = Math.min(Math.max(Math.floor(freq), 1), max);
  if (options.writeInput !== false) dom.freqInput.value = value;
  dom.freqSlider.value = freqToSlider(value);
  dom.freqSlider.setAttribute('aria-valuetext', `${value} 次`);
  for (const chip of dom.freqChips.querySelectorAll('.chip-btn')) {
    chip.classList.toggle('is-active', Number(chip.dataset.freq) === value);
  }
  updateCandidateCount();
}

function updateCandidateCount() {
  const { value } = readThreshold();
  if (!state.model) {
    dom.candidateCount.textContent = '—';
    dom.candidateFoot.textContent = '加载模型后可查看';
    dom.candidateBar.style.width = '0%';
    return;
  }
  const count = countEligible(state.model, value);
  animateNumber(dom.candidateCount, count);
  const total = state.model.count;
  const ratio = Math.log(Math.max(count, 1)) / Math.log(total);
  dom.candidateBar.style.width = `${Math.max(0, Math.min(ratio, 1)) * 100}%`;
  dom.candidateFoot.textContent = `占全部 ${fmt(total)} 词的 ${((count / total) * 100).toFixed(2)}%`;
  return count;
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function buildMatrix(model, result) {
  const dim = model.dim;
  const rows = [
    { label: result.word, isQuery: true, sim: 1, freq: result.freq, index: result.index },
    ...result.neighbors.map((n) => ({
      label: n.word,
      isQuery: false,
      sim: n.sim,
      freq: n.freq,
      index: n.index,
    })),
  ];
  const values = new Float32Array(rows.length * dim);
  rows.forEach((row, r) => {
    const src = row.index * dim;
    values.set(model.vectors.subarray(src, src + dim), r * dim);
  });
  return { rows, values, dim };
}

function renderTop5(result) {
  dom.top5Grid.textContent = '';
  if (result.top.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'top5-empty';
    empty.textContent = '在当前词频阈值下，没有其他词可参与相似度比较。';
    dom.top5Grid.appendChild(empty);
    return;
  }
  result.top.forEach((item, i) => {
    const card = document.createElement('article');
    card.className = 'top5-card';
    card.dataset.rank = String(i + 1);
    card.style.setProperty('--sim', item.sim.toFixed(4));
    card.innerHTML = `
      <span class="top5-rank">#${i + 1}</span>
      <span class="top5-word">${escapeHtml(item.word)}</span>
      <span class="top5-sim">${item.sim.toFixed(4)}<small>cosine</small></span>
      <span class="top5-bar"><i style="width:${Math.max(0, Math.min(item.sim, 1)) * 100}%"></i></span>
      <span class="top5-freq"><span>词频</span><b>${fmt(item.freq)}</b></span>`;
    dom.top5Grid.appendChild(card);
  });
}

function renderCharts(model, result) {
  const matrix = buildMatrix(model, result);

  dom.top5Panel.hidden = false;
  dom.heatmapPanel.hidden = false;
  dom.scatterPanel.hidden = false;
  dom.emptyState.hidden = true;
  dom.emptyState.classList.remove('is-error');

  heatmap.render({ ...matrix, fixedDomain: state.vectorDomain });

  const shown = heatmap.getDomain();
  dom.legendMin.textContent = shown[0].toFixed(2);
  dom.legendMax.textContent = shown[1].toFixed(2);

  const projected = pca2d(matrix.values, matrix.rows.length, model.dim);
  scatter.render({
    points: matrix.rows.map((row) => ({ label: row.label, isQuery: row.isQuery, sim: row.sim, freq: row.freq })),
    coords: projected.coords,
    ratios: projected.ratios,
  });
  dom.var1.textContent = `${(projected.ratios[0] * 100).toFixed(1)}%`;
  dom.var2.textContent = `${(projected.ratios[1] * 100).toFixed(1)}%`;

  dom.heatmapSub.textContent = `行：查询词 + ${result.neighbors.length} 个候选近邻词 · 列：${model.dim} 个维度 · 颜色表示原始数值`;
  dom.scatterSub.textContent = `对 ${matrix.rows.length} 个词的 ${model.dim} 维原始向量做 PCA 投影（未量化）`;

  requestAnimationFrame(() => heatmap.redraw());
}

function renderStatus(model, result, threshold) {
  dom.statusStrip.hidden = false;
  dom.statusTag.textContent = '结果';
  dom.statusText.innerHTML = `查询词 <b>${escapeHtml(result.word)}</b> · 词频阈值 ≥ <b>${fmt(threshold)}</b> · 候选 <b>${fmt(
    result.eligible
  )}</b> 词 · 展示最相似 ${result.top.length} 个与周围 ${result.neighbors.length} 个词`;
  dom.statusAside.innerHTML = `<span>候选区间扫描 ${fmt(result.scanned)} 词</span><span>· 向量 ${model.dim} 维 float32 原始数值</span>`;
}

function showError(title, desc) {
  dom.statusStrip.hidden = true;
  dom.top5Panel.hidden = true;
  dom.heatmapPanel.hidden = true;
  dom.scatterPanel.hidden = true;
  dom.heatmapTooltip.hidden = true;
  dom.scatterTooltip.hidden = true;
  dom.emptyState.hidden = false;
  dom.emptyState.classList.add('is-error');
  dom.emptyTitle.textContent = title;
  dom.emptyDesc.textContent = desc;
}

function showIdle() {
  dom.emptyState.hidden = false;
  dom.emptyState.classList.remove('is-error');
  dom.emptyTitle.textContent = '等待你的第一次查询';
  dom.emptyDesc.textContent = '在左侧输入一个英文词语，设定词频阈值后即可查看它的向量图像与语义近邻。';
}

/* ------------------------------------------------------------------ */
/* 查询流程                                                            */
/* ------------------------------------------------------------------ */

function runQuery(rawWord) {
  if (!state.model || state.busy) return;
  const word = String(rawWord ?? dom.wordInput.value).trim();

  if (!word) {
    dom.wordInput.classList.add('is-invalid');
    setHint(dom.wordHint, '请输入要查询的词语', 'error');
    return;
  }

  const resolved = resolveWord(state.model, word);
  if (!resolved) {
    dom.wordInput.classList.add('is-invalid');
    setHint(dom.wordHint, `词表中没有收录「${word}」，可尝试单数形式或小写拼写`, 'error');
    showError('词表中没有这个词', `「${word}」不在 71,292 个词之中。可以换一个常见的英文单词再试。`);
    return;
  }

  const { value: threshold } = readThreshold();
  state.busy = true;
  dom.searchBtn.disabled = true;
  dom.statusStrip.hidden = false;
  dom.statusTag.textContent = '计算中';
  dom.statusText.textContent = '正在扫描候选词并计算余弦相似度…';

  requestAnimationFrame(() => {
    const result = search(state.model, resolved, threshold, {
      topK: TOP_K,
      neighborLimit: NEIGHBOR_LIMIT,
    });
    state.busy = false;
    dom.searchBtn.disabled = false;

    if (!result.ok) {
      if (result.reason === 'no-candidate') {
        showError(
          '没有符合词频要求的候选词',
          `词频阈值 ≥ ${fmt(threshold)} 时，没有其他词可供比较。请把阈值调低一些（本模型真实词的最小词频为 5）。`
        );
      } else if (result.reason === 'zero-vector') {
        showError('该词的向量接近零向量', '无法计算有效的余弦相似度，请换一个词试试。');
      } else {
        showError('词表中没有这个词', `「${word}」不在词表之中。`);
      }
      return;
    }

    state.lastQuery = result;
    dom.wordInput.classList.remove('is-invalid');
    setHint(dom.wordHint, `已匹配词表中的「${result.word}」`, 'ok');
    renderTop5(result);
    renderCharts(state.model, result);
    renderStatus(state.model, result, threshold);
  });
}

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

function bindEvents() {
  dom.form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    runQuery();
  });

  dom.wordInput.addEventListener('input', () => {
    dom.wordInput.classList.remove('is-invalid');
    if (!state.model) return;
    const value = dom.wordInput.value.trim();
    if (!value) {
      setHint(dom.wordHint, '支持英文与小写形式，回车即可查询', null);
      return;
    }
    if (resolveWord(state.model, value)) {
      setHint(dom.wordHint, `已匹配词表中的「${resolveWord(state.model, value)}」`, 'ok');
    } else {
      setHint(dom.wordHint, '词表中暂未找到该词，仍可回车尝试', null);
    }
  });

  dom.freqInput.addEventListener('input', () => {
    const { value } = readThreshold();
    syncThresholdUI(value, { writeInput: false });
  });

  dom.freqInput.addEventListener('blur', () => {
    const { value } = readThreshold();
    dom.freqInput.value = value;
    syncThresholdUI(value);
  });

  dom.freqSlider.addEventListener('input', () => {
    syncThresholdUI(sliderToFreq(Number(dom.freqSlider.value)));
  });

  dom.freqChips.addEventListener('click', (evt) => {
    const button = evt.target.closest('.chip-btn');
    if (!button) return;
    syncThresholdUI(Number(button.dataset.freq));
  });

  dom.emptyState.addEventListener('click', (evt) => {
    const button = evt.target.closest('[data-sample]');
    if (!button) return;
    dom.wordInput.value = button.dataset.sample;
    runQuery(button.dataset.sample);
  });

  dom.domainFixed.addEventListener('click', () => setDomainMode('fixed'));
  dom.domainAuto.addEventListener('click', () => setDomainMode('auto'));

  dom.aboutBtn.addEventListener('click', () => openDrawer(true));
  dom.drawerClose.addEventListener('click', () => openDrawer(false));
  dom.drawerBackdrop.addEventListener('click', () => openDrawer(false));
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') openDrawer(false);
  });

  window.addEventListener('scroll', () => {
    dom.topbar.classList.toggle('is-stuck', window.scrollY > 8);
  }, { passive: true });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (state.lastQuery) heatmap.redraw();
    }, 180);
  });
}

function setDomainMode(mode) {
  heatmap.setDomainMode(mode);
  dom.domainFixed.classList.toggle('is-active', mode === 'fixed');
  dom.domainAuto.classList.toggle('is-active', mode === 'auto');
  const shown = mode === 'fixed' ? state.vectorDomain : heatmap.getDomain();
  dom.legendMin.textContent = shown[0].toFixed(2);
  dom.legendMax.textContent = shown[1].toFixed(2);
  dom.heatmapNote.textContent =
    mode === 'fixed'
      ? '固定值域：所有查询使用同一色标，颜色可直接横向比较'
      : '自适应值域：按当前结果的最值拉伸色标，细节更清晰但跨查询颜色不可直接比较';
}

function openDrawer(open) {
  dom.drawer.hidden = !open;
  dom.drawerBackdrop.hidden = !open;
  if (open) dom.drawerClose.focus();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

function setModelState(text, kind) {
  dom.modelStateText.textContent = text;
  dom.modelState.classList.toggle('is-ready', kind === 'ready');
  dom.modelState.classList.toggle('is-error', kind === 'error');
}

function updateLoader({ received, total, ratio, speed, eta }) {
  const percent = Math.round(ratio * 100);
  dom.loaderPercent.textContent = `${percent}%`;
  dom.loaderBar.style.width = `${percent}%`;
  dom.loaderProgress.setAttribute('aria-valuenow', String(percent));
  dom.loaderDetail.textContent = `${(received / 1048576).toFixed(1)} MB / ${(total / 1048576).toFixed(1)} MB · ${(speed / 1048576).toFixed(1)} MB/s`;
  dom.loaderEta.textContent = eta > 0.4 && percent < 100 ? `预计剩余 ${eta < 60 ? `${Math.ceil(eta)} 秒` : `${Math.ceil(eta / 60)} 分钟`}` : '即将完成';
}

function computeVectorDomain(model) {
  let min = Infinity;
  let max = -Infinity;
  const { vectors } = model;
  for (let i = 0; i < vectors.length; i += 1) {
    const v = vectors[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [Math.floor(min * 100) / 100, Math.ceil(max * 100) / 100];
}

async function boot() {
  bindEvents();

  const legendBar = dom.heatmapLegend.querySelector('.legend-bar');
  if (legendBar) legendBar.style.background = gradientCss(null, 'diverging');

  syncThresholdUI(Number(dom.freqInput.value) || 500, { writeInput: false });

  setModelState('正在下载模型数据…', 'loading');
  try {
    const model = await loadModel({
      onProgress: updateLoader,
      onStage: (stage) => {
        if (stage === 'meta') setModelState('正在读取词表…', 'loading');
        if (stage === 'vectors') setModelState('正在下载向量数据…', 'loading');
        if (stage === 'norms') setModelState('正在预计算向量范数…', 'loading');
      },
    });

    state.model = model;
    state.vectorDomain = computeVectorDomain(model);

    dom.metaVocab.textContent = fmt(model.count);
    dom.metaDim.textContent = String(model.dim);
    dom.metaFreq.textContent = `${fmt(model.minFreq)} – ${fmt(model.maxFreq)}`;
    dom.drawerVocab.textContent = fmt(model.count);
    dom.drawerDim.textContent = String(model.dim);
    dom.freqInput.max = String(model.maxFreq);

    dom.loaderPanel.hidden = true;
    dom.searchBtn.disabled = false;
    setModelState(`模型就绪 · ${model.byteSizeText} 向量已加载`, 'ready');

    syncThresholdUI(Number(dom.freqInput.value) || 500);
    showIdle();
    dom.wordInput.focus();
  } catch (err) {
    dom.loaderPanel.hidden = true;
    dom.searchBtn.disabled = true;
    setModelState('模型加载失败', 'error');
    showError('模型加载失败', err && err.message ? err.message : '未知错误，请刷新页面重试。');
  }
}

boot();
