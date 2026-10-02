/**
 * 语义分布散点图渲染（SVG）
 * ------------------------------------------------------------------
 * 接收 PCA 二维投影结果：查询词以高亮菱形 + 脉冲光环呈现，
 * 周围词以圆点呈现（半径映射词频、填充映射相似度）。
 * 使用 SVG 以获得天然的可访问性与零成本命中检测。
 */

import { sequentialColor } from './colormap.js';

const NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 900;
const VIEW_H = 520;
const PAD = { top: 26, right: 74, bottom: 34, left: 26 };
const MAX_LABELS = 7;

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
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

export function createScatter(options) {
  const { svg, tooltip, onPickWord } = options;
  let data = null;

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function showTooltip(evt, point) {
    tooltip.innerHTML = `
      <div class="tt-row"><span class="tt-key">词</span><span class="tt-val"><b>${escapeHtml(point.label)}</b></span></div>
      <div class="tt-row"><span class="tt-key">相似度</span><span class="tt-val">${point.isQuery ? '查询词' : point.sim.toFixed(4)}</span></div>
      <div class="tt-row"><span class="tt-key">词频</span><span class="tt-val">${point.freq.toLocaleString('en-US')}</span></div>`;
    tooltip.hidden = false;
    tooltip.style.left = evt.clientX + 'px';
    tooltip.style.top = evt.clientY + 'px';
  }

  function render(next) {
    data = next;
    hideTooltip();
    svg.textContent = '';

    const defs = el('defs');
    const grad = el('radialGradient', { id: 'queryFill', cx: '35%', cy: '30%', r: '75%' });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': '#fde68a' }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': '#f59e0b' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    const bg = el('g');
    svg.appendChild(bg);

    // 网格
    const grid = el('g');
    for (let i = 0; i <= 6; i += 1) {
      const x = PAD.left + ((VIEW_W - PAD.left - PAD.right) * i) / 6;
      const y = PAD.top + ((VIEW_H - PAD.top - PAD.bottom) * i) / 6;
      grid.appendChild(el('line', { x1: x, y1: PAD.top, x2: x, y2: VIEW_H - PAD.bottom, class: 'scatter-axis' }));
      grid.appendChild(el('line', { x1: PAD.left, y1: y, x2: VIEW_W - PAD.right, y2: y, class: 'scatter-axis' }));
    }
    bg.appendChild(grid);

    if (!data || data.points.length === 0) {
      bg.appendChild(
        el('text', { x: VIEW_W / 2, y: VIEW_H / 2, class: 'scatter-axis-label', 'text-anchor': 'middle' })
      ).textContent = '暂无可投影的词';
      return;
    }

    const { points, coords } = data;
    const n = points.length;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const x = coords[i * 2];
      const y = coords[i * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || maxX - minX < 1e-12) {
      minX -= 0.5;
      maxX += 0.5;
    }
    if (!Number.isFinite(minY) || maxY - minY < 1e-12) {
      minY -= 0.5;
      maxY += 0.5;
    }
    const marginX = (maxX - minX) * 0.08;
    const marginY = (maxY - minY) * 0.08;
    minX -= marginX;
    maxX += marginX;
    minY -= marginY;
    maxY += marginY;

    const innerW = VIEW_W - PAD.left - PAD.right;
    const innerH = VIEW_H - PAD.top - PAD.bottom;
    const toX = (v) => PAD.left + ((v - minX) / (maxX - minX)) * innerW;
    const toY = (v) => VIEW_H - PAD.bottom - ((v - minY) / (maxY - minY)) * innerH;

    // 零线
    if (minX < 0 && maxX > 0) {
      const zx = toX(0);
      bg.appendChild(el('line', { x1: zx, y1: PAD.top, x2: zx, y2: VIEW_H - PAD.bottom, class: 'scatter-zero' }));
    }
    if (minY < 0 && maxY > 0) {
      const zy = toY(0);
      bg.appendChild(el('line', { x1: PAD.left, y1: zy, x2: VIEW_W - PAD.right, y2: zy, class: 'scatter-zero' }));
    }

    // 主成分轴说明
    const axisLabels = el('g');
    const xText = el('text', { x: PAD.left + innerW / 2, y: VIEW_H - 10, class: 'scatter-axis-label', 'text-anchor': 'middle' });
    xText.textContent = `主成分 1（${(data.ratios[0] * 100).toFixed(1)}% 方差）`;
    axisLabels.appendChild(xText);
    const yText = el('text', {
      x: VIEW_W - 18,
      y: PAD.top + innerH / 2,
      class: 'scatter-axis-label',
      'text-anchor': 'middle',
      transform: `rotate(90 ${VIEW_W - 18} ${PAD.top + innerH / 2})`,
    });
    yText.textContent = `主成分 2（${(data.ratios[1] * 100).toFixed(1)}% 方差）`;
    axisLabels.appendChild(yText);
    bg.appendChild(axisLabels);

    // 相似度归一化区间
    let minSim = Infinity;
    let maxSim = -Infinity;
    for (const p of points) {
      if (p.isQuery) continue;
      if (p.sim < minSim) minSim = p.sim;
      if (p.sim > maxSim) maxSim = p.sim;
    }
    const simSpan = maxSim - minSim;

    // 词频归一化（对数）
    let minFreq = Infinity;
    let maxFreq = -Infinity;
    for (const p of points) {
      if (p.freq < minFreq) minFreq = p.freq;
      if (p.freq > maxFreq) maxFreq = p.freq;
    }
    const logMin = Math.log(Math.max(minFreq, 1));
    const logSpan = Math.max(Math.log(Math.max(maxFreq, 1)) - logMin, 1e-6);

    const pointsLayer = el('g');
    const labelLayer = el('g');
    const nodes = [];

    const ordered = points
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (a.p.isQuery ? 1 : b.p.isQuery ? -1 : a.p.sim - b.p.sim));

    for (const { p, i } of ordered) {
      const cx = toX(coords[i * 2]);
      const cy = toY(coords[i * 2 + 1]);

      if (p.isQuery) {
        const size = 10;
        const halo = el('circle', { cx, cy, r: size, class: 'scatter-pulse' });
        pointsLayer.appendChild(halo);
        const diamond = el('path', {
          d: `M ${cx} ${cy - size} L ${cx + size} ${cy} L ${cx} ${cy + size} L ${cx - size} ${cy} Z`,
          class: 'scatter-query',
          tabindex: '0',
          role: 'img',
        });
        attach(diamond, p, cx, cy);
        pointsLayer.appendChild(diamond);
        nodes.push(diamond);
        const label = el('text', { x: cx, y: cy - size - 8, class: 'scatter-label is-query', 'text-anchor': 'middle' });
        label.textContent = p.label;
        labelLayer.appendChild(label);
      } else {
        const t = logSpan > 0 ? (Math.log(Math.max(p.freq, 1)) - logMin) / logSpan : 0.5;
        const r = 4 + 7 * t;
        const simT = simSpan > 0 ? (p.sim - minSim) / simSpan : 1;
        const dot = el('circle', {
          cx,
          cy,
          r,
          fill: sequentialColor(0.15 + simT * 0.85),
          class: 'scatter-point',
          tabindex: '0',
          role: 'img',
        });
        attach(dot, p, cx, cy);
        pointsLayer.appendChild(dot);
        nodes.push(dot);
      }
    }

    // 标注最相似的若干周围词
    const labeled = points
      .map((p, i) => ({ p, i }))
      .filter((item) => !item.p.isQuery)
      .sort((a, b) => b.p.sim - a.p.sim)
      .slice(0, MAX_LABELS - 1);
    for (const { p, i } of labeled) {
      const cx = toX(coords[i * 2]);
      const cy = toY(coords[i * 2 + 1]);
      const label = el('text', { x: cx + 8, y: cy + 4, class: 'scatter-label' });
      label.textContent = p.label;
      labelLayer.appendChild(label);
    }

    svg.appendChild(pointsLayer);
    svg.appendChild(labelLayer);

    function attach(node, point, cx, cy) {
      node.addEventListener('mouseenter', (evt) => {
        showTooltip(evt, point);
        for (const other of nodes) other.classList.toggle('is-dim', other !== node);
        node.parentNode?.appendChild(node);
      });
      node.addEventListener('mousemove', (evt) => showTooltip(evt, point));
      node.addEventListener('mouseleave', () => {
        hideTooltip();
        for (const other of nodes) other.classList.remove('is-dim');
      });
      node.addEventListener('click', () => {
        if (!point.isQuery) onPickWord?.(point.label);
      });
      node.addEventListener('focus', () => {
        const rect = node.getBoundingClientRect();
        showTooltip({ clientX: rect.left + rect.width / 2 - 60, clientY: rect.top }, point);
      });
      node.addEventListener('blur', hideTooltip);
      node.setAttribute('aria-label', `${point.label}，相似度 ${point.isQuery ? '查询词' : point.sim.toFixed(4)}，词频 ${point.freq}`);
    }
  }

  return {
    render,
    destroy() {
      svg.textContent = '';
    },
  };
}
