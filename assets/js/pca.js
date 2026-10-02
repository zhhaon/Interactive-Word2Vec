/**
 * 降维模块（PCA）
 * ------------------------------------------------------------------
 * 对 n × dim 的向量矩阵做：
 *   1. 逐维度均值中心化
 *   2. 计算 dim × dim 协方差矩阵
 *   3. Jacobi 特征值分解求前两大特征向量
 *   4. 投影到二维，并给出两主成分的解释方差比
 *
 * 全部使用 Float64 中间量，保证数值稳定。
 */

const MAX_SWEEPS = 50;

/**
 * 对对称矩阵做 Jacobi 特征值分解（原地旋转，返回特征值与特征向量）
 * @param {Float64Array} A 对称矩阵的副本（n × n，行主序），会被修改
 * @param {number} n
 * @returns {{ values: Float64Array, vectors: Float64Array }} 特征向量按列存放
 */
function jacobiEigen(A, n) {
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) V[i * n + i] = 1;

  let frobenius = 0;
  for (let i = 0; i < n * n; i += 1) frobenius += A[i] * A[i];
  const tolerance = frobenius > 0 ? frobenius * 1e-22 : 0;

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) off += A[p * n + q] * A[p * n + q];
    }
    if (off <= tolerance) break;

    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = A[p * n + q];
        if (apq === 0) continue;

        const app = A[p * n + p];
        const aqq = A[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        // A = Jᵀ A J 的列方向更新
        for (let k = 0; k < n; k += 1) {
          const kp = k * n + p;
          const kq = k * n + q;
          const akp = A[kp];
          const akq = A[kq];
          A[kp] = c * akp - s * akq;
          A[kq] = s * akp + c * akq;
        }
        // 行方向更新
        for (let k = 0; k < n; k += 1) {
          const pk = p * n + k;
          const qk = q * n + k;
          const apk = A[pk];
          const aqk = A[qk];
          A[pk] = c * apk - s * aqk;
          A[qk] = s * apk + c * aqk;
        }
        // 累积特征向量
        for (let k = 0; k < n; k += 1) {
          const kp = k * n + p;
          const kq = k * n + q;
          const vkp = V[kp];
          const vkq = V[kq];
          V[kp] = c * vkp - s * vkq;
          V[kq] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = new Float64Array(n);
  for (let i = 0; i < n; i += 1) values[i] = A[i * n + i];
  return { values, vectors: V };
}

/**
 * 对矩阵做二维 PCA 投影。
 * @param {Float32Array|Float64Array} matrix n × dim 行主序
 * @param {number} n 行数
 * @param {number} dim 维度
 * @returns {{ coords: Float64Array, ratios: [number, number], eigenvalues: Float64Array }}
 *          coords 为长度 2n 的数组（[x0,y0,x1,y1,...]）
 */
export function pca2d(matrix, n, dim) {
  const coords = new Float64Array(n * 2);
  if (n === 0 || dim === 0) return { coords, ratios: [0, 0], eigenvalues: new Float64Array(2) };

  // 1. 均值
  const mean = new Float64Array(dim);
  for (let r = 0; r < n; r += 1) {
    const off = r * dim;
    for (let d = 0; d < dim; d += 1) mean[d] += matrix[off + d];
  }
  for (let d = 0; d < dim; d += 1) mean[d] /= n;

  // 2. 中心化
  const X = new Float64Array(n * dim);
  for (let r = 0; r < n; r += 1) {
    const off = r * dim;
    for (let d = 0; d < dim; d += 1) X[off + d] = matrix[off + d] - mean[d];
  }

  // 3. 协方差矩阵
  const C = new Float64Array(dim * dim);
  for (let r = 0; r < n; r += 1) {
    const off = r * dim;
    for (let i = 0; i < dim; i += 1) {
      const xi = X[off + i];
      if (xi === 0) continue;
      const rowBase = i * dim;
      for (let j = i; j < dim; j += 1) C[rowBase + j] += xi * X[off + j];
    }
  }
  for (let i = 0; i < dim; i += 1) {
    for (let j = i; j < dim; j += 1) {
      const v = C[i * dim + j];
      C[i * dim + j] = v;
      C[j * dim + i] = v;
    }
  }

  // 4. 特征分解
  const { values, vectors } = jacobiEigen(C, dim);

  const order = Array.from({ length: dim }, (_, i) => i).sort((a, b) => values[b] - values[a]);
  const total = values.reduce((acc, v) => acc + Math.max(v, 0), 0);
  const i1 = order[0];
  const i2 = dim > 1 ? order[1] : order[0];

  const l1 = Math.max(values[i1], 0);
  const l2 = dim > 1 ? Math.max(values[i2], 0) : 0;
  const ratios = [total > 0 ? l1 / total : 0, total > 0 ? l2 / total : 0];

  // 5. 投影
  for (let r = 0; r < n; r += 1) {
    const off = r * dim;
    let x = 0;
    let y = 0;
    for (let d = 0; d < dim; d += 1) {
      const v = X[off + d];
      x += v * vectors[d * dim + i1];
      y += v * vectors[d * dim + i2];
    }
    coords[r * 2] = x;
    coords[r * 2 + 1] = y;
  }

  return { coords, ratios, eigenvalues: Float64Array.from([l1, l2]) };
}
