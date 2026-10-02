/**
 * 向量热力图渲染（Canvas）
 * ------------------------------------------------------------------
 * 行 = 查询词 + 周围词，列 = 每个向量维度，颜色 = 该维度原始数值。
 * 基础图层一次性绘制到离屏画布，悬停时只做「贴图 + 十字高亮」，
 * 避免每次 mousemove 重绘数千个单元格。
 */

import { heatColor, formatNumber } from './colormap.js';

const LABEL_W = 122;
const AXIS_H = 30;
const GRID_TARGET_H = 560;
const PAD_RIGHT = 14;

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

export function createHeatmap(options) {
  const { canvas, tooltip, onPickWord } = options;
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  const baseCtx = base.getContext('2d');

  let data = null;
  let layout = null;
  let hover = { r: -1, c: -1 };
  let rafId = 0;
  let domainMode = 'fixed';

  function currentDomain() {
    if (!data) return [0, 1];
    if (domainMode === 'auto') {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < data.values.length; i += 1) {
        const v = data.values[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!Number.isFinite(min) || min === max) return [-1, 1];
      return [min, max];
    }
    return data.fixedDomain;
  }

  function computeLayout(rowCount) {
    const wrap = canvas.parentElement;
    const available = Math.max((wrap ? wrap.clientWidth : 900) - LABEL_W - PAD_RIGHT - 2, 100);
    const cellW = Math.min(26, Math.max(6.5, available / (data ? data.dim : 100)));
    const cellH = Math.min(28, Math.max(11, GRID_TARGET_H / Math.max(rowCount, 1)));
    const width = Math.round(LABEL_W + cellW * (data ? data.dim : 100) + 2);
    const height = Math.round(cellH * rowCount + AXIS_H);
    return { cellW, cellH, width, height, labelW: LABEL_W, axisH: AXIS_H };
  }

  function drawBase() {
    if (!data || !layout) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height, labelW, cellW, cellH, axisH } = layout;

    base.width = Math.round(width * dpr);
    base.height = Math.round(height * dpr);
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.clearRect(0, 0, width, height);

    const [min, max] = currentDomain();
    const { rows, values, dim } = data;

    baseCtx.font = '11px "JetBrains Mono", Consolas, monospace';
    baseCtx.textBaseline = 'middle';

    for (let r = 0; r < rows.length; r += 1) {
      const y = r * cellH;
      const row = rows[r];
      const offset = r * dim;

      // 斑马纹行背景
      if (r % 2 === 1) {
        baseCtx.fillStyle = 'rgba(148,163,184,0.045)';
        baseCtx.fillRect(labelW, y, cellW * dim, cellH);
      }

      // 单元格
      for (let c = 0; c < dim; c += 1) {
        baseCtx.fillStyle = heatColor(values[offset + c], min, max);
        baseCtx.fillRect(labelW + c * cellW, y, Math.ceil(cellW) + 0.5, Math.ceil(cellH) + 0.5);
      }

      // 每 10 维的浅分隔线
      baseCtx.fillStyle = 'rgba(8,13,27,0.5)';
      for (let c = 10; c < dim; c += 10) baseCtx.fillRect(labelW + c * cellW, y, 1, cellH);

      // 行标签
      baseCtx.fillStyle = row.isQuery ? '#fde68a' : 'rgba(148,163,184,0.92)';
      baseCtx.textAlign = 'right';
      const label = truncate(row.label, 16);
      baseCtx.fillText(label, labelW - 10, y + cellH / 2 + 0.5);

      // 查询词：左侧强调竖条（不覆盖单元格颜色，保证数值可比）
      baseCtx.fillStyle = row.isQuery ? 'rgba(251,191,36,0.9)' : 'rgba(148,163,184,0.35)';
      baseCtx.fillRect(labelW - 3, y + 1, row.isQuery ? 2.5 : 1, cellH - 2);
    }

    // 行分隔线
    baseCtx.fillStyle = 'rgba(8,13,27,0.55)';
    for (let r = 1; r <= rows.length; r += 1) baseCtx.fillRect(labelW, r * cellH - 0.5, cellW * dim, 1);

    // 底部维度刻度
    const axisY = rows.length * cellH;
    baseCtx.fillStyle = 'rgba(148,163,184,0.14)';
    baseCtx.fillRect(labelW, axisY, cellW * dim, 1);
    baseCtx.font = '10px "JetBrains Mono", Consolas, monospace';
    baseCtx.fillStyle = 'rgba(148,163,184,0.75)';
    baseCtx.textAlign = 'center';
    for (let c = 0; c < dim; c += 10) {
      baseCtx.fillText(String(c + 1), labelW + c * cellW + cellW / 2, axisY + 14);
      baseCtx.fillStyle = 'rgba(148,163,184,0.2)';
      baseCtx.fillRect(labelW + c * cellW, axisY, 1, 5);
      baseCtx.fillStyle = 'rgba(148,163,184,0.75)';
    }
    baseCtx.textAlign = 'right';
    baseCtx.fillStyle = 'rgba(100,116,139,0.9)';
    baseCtx.fillText('维度', labelW - 10, axisY + 14);
  }

  function paint() {
    if (!data || !layout) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height, cellW, cellH, labelW, axisH } = layout;
    const rows = data.rows.length;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(base, 0, 0, width, height);

    if (hover.r >= 0 && hover.c >= 0) {
      const y = hover.r * cellH;
      const x = labelW + hover.c * cellW;

      // 十字高亮
      ctx.fillStyle = 'rgba(226,237,247,0.18)';
      ctx.fillRect(labelW, y, cellW * data.dim, cellH);
      ctx.fillRect(x, 0, cellW, rows * cellH + axisH);

      ctx.strokeStyle = 'rgba(253,230,138,0.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, cellW - 1.5, cellH - 1.5);
    }
  }

  function showTooltip(evt) {
    if (!data || !layout || hover.r < 0 || hover.c < 0) {
      tooltip.hidden = true;
      return;
    }
    const row = data.rows[hover.r];
    const value = data.values[hover.r * data.dim + hover.c];
    const simText = Number.isFinite(row.sim) ? row.sim.toFixed(4) : '—';
    tooltip.innerHTML = `
      <div class="tt-row"><span class="tt-key">词</span><span class="tt-val"><b>${escapeHtml(row.label)}</b></span></div>
      <div class="tt-row"><span class="tt-key">维度</span><span class="tt-val">#${hover.c + 1}</span></div>
      <div class="tt-row"><span class="tt-key">数值</span><span class="tt-val">${formatNumber(value, 4)}</span></div>
      <div class="tt-row"><span class="tt-key">相似度</span><span class="tt-val">${row.isQuery ? '查询词' : simText}</span></div>
      <div class="tt-row"><span class="tt-key">词频</span><span class="tt-val">${row.freq.toLocaleString('en-US')}</span></div>`;
    tooltip.hidden = false;
    tooltip.style.left = evt.clientX + 'px';
    tooltip.style.top = evt.clientY + 'px';
  }

  function hitTest(evt) {
    if (!layout || !data) return { r: -1, c: -1 };
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    const c = Math.floor((x - layout.labelW) / layout.cellW);
    const r = Math.floor(y / layout.cellH);
    if (c < 0 || c >= data.dim || r < 0 || r >= data.rows.length) return { r: -1, c: -1 };
    return { r, c };
  }

  function handleMove(evt) {
    const next = hitTest(evt);
    const changed = next.r !== hover.r || next.c !== hover.c;
    hover = next;
    if (changed) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        paint();
      });
    }
    showTooltip(evt);
  }

  function handleLeave() {
    hover = { r: -1, c: -1 };
    tooltip.hidden = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      paint();
    });
  }

  function handleClick(evt) {
    if (!layout || !data) return;
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    if (x < layout.labelW) {
      const r = Math.floor((evt.clientY - rect.top) / layout.cellH);
      const row = data.rows[r];
      if (row && !row.isQuery) onPickWord?.(row.label);
    }
  }

  canvas.addEventListener('mousemove', handleMove, { passive: true });
  canvas.addEventListener('mouseleave', handleLeave, { passive: true });
  canvas.addEventListener('click', handleClick);

  return {
    render(next) {
      data = next;
      hover = { r: -1, c: -1 };
      layout = computeLayout(next.rows.length);
      drawBase();
      paint();
    },
    setDomainMode(mode) {
      domainMode = mode === 'auto' ? 'auto' : 'fixed';
      if (data) {
        drawBase();
        paint();
      }
      return currentDomain();
    },
    getDomainMode() {
      return domainMode;
    },
    getDomain() {
      return currentDomain();
    },
    redraw() {
      if (!data) return;
      layout = computeLayout(data.rows.length);
      drawBase();
      paint();
    },
    destroy() {
      canvas.removeEventListener('mousemove', handleMove);
      canvas.removeEventListener('mouseleave', handleLeave);
      canvas.removeEventListener('click', handleClick);
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
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
