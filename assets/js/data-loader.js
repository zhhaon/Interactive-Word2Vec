/**
 * 数据加载模块
 * ------------------------------------------------------------------
 * 1. 读取 data/meta.json 得到词表与词频，构建 word -> index 映射
 * 2. 以流式方式读取 data/vectors.bin（原始 float32、小端、行主序），
 *    并实时上报下载进度
 * 3. 预计算每个词向量的 L2 范数，供后续余弦相似度使用
 *
 * 全程不做任何量化、降精度或改写：浏览器拿到的就是 npz 里的原始 float32 数值。
 */

const META_URL = 'data/meta.json';
const VECTOR_URL = 'data/vectors.bin';

/** 判断当前平台是否为小端（x86 / ARM 常见情况均为小端） */
function isLittleEndian() {
  const probe = new Uint16Array([1]);
  return new Uint8Array(probe.buffer)[0] === 1;
}

/** 大端平台上的字节序兜底转换（正常浏览器不会走到这里） */
function swapToLittleEndianInPlace(bytes) {
  for (let i = 0; i < bytes.length; i += 4) {
    const a = bytes[i];
    bytes[i] = bytes[i + 3];
    bytes[i + 3] = a;
    const b = bytes[i + 1];
    bytes[i + 1] = bytes[i + 2];
    bytes[i + 2] = b;
  }
}

function formatBytes(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

/**
 * 加载完整模型。
 * @param {{ onProgress?: (info: {received:number,total:number,ratio:number,speed:number,eta:number}) => void,
 *           onStage?: (stage: string) => void }} hooks
 */
export async function loadModel(hooks = {}) {
  const { onProgress, onStage } = hooks;

  onStage?.('meta');
  const meta = await fetchMeta();

  const dim = meta.dim;
  const count = meta.count;
  const words = meta.words;
  const counts = Int32Array.from(meta.counts);

  if (!Array.isArray(words) || words.length !== count) {
    throw new Error('meta.json 词表长度与 count 不一致，请重新运行 scripts/build_data.py');
  }
  if (!Array.isArray(meta.counts) || meta.counts.length !== count) {
    throw new Error('meta.json 词频长度与 count 不一致，请重新运行 scripts/build_data.py');
  }

  const index = new Map();
  for (let i = 0; i < count; i += 1) index.set(words[i], i);

  onStage?.('vectors');
  const bytes = await fetchVectorBytes(count * dim * 4, onProgress);

  if (!isLittleEndian()) swapToLittleEndianInPlace(bytes);

  // Uint8Array 的 buffer 可能按 4 字节对齐（这里由我们自行分配，偏移为 0）
  const vectors = new Float32Array(bytes.buffer, 0, count * dim);

  onStage?.('norms');
  const norms = computeNorms(vectors, count, dim);

  const byteSize = count * dim * 4;
  return {
    dim,
    count,
    words,
    counts,
    index,
    vectors,
    norms,
    minFreq: meta.minFreq,
    maxFreq: meta.maxFreq,
    byteSize,
    byteSizeText: formatBytes(byteSize),
  };
}

async function fetchMeta() {
  let res;
  try {
    res = await fetch(META_URL);
  } catch (err) {
    throw new Error(
      '无法读取 data/meta.json。若你是直接双击打开 index.html，请改用本地 HTTP 服务器预览（file:// 协议下浏览器会拦截 fetch）。'
    );
  }
  if (!res.ok) throw new Error(`读取 data/meta.json 失败（HTTP ${res.status}）`);
  return res.json();
}

/** 流式下载向量二进制并上报进度 */
async function fetchVectorBytes(expectedBytes, onProgress) {
  let res;
  try {
    res = await fetch(VECTOR_URL);
  } catch (err) {
    throw new Error('无法读取 data/vectors.bin，请确认数据文件已随站点一起部署。');
  }
  if (!res.ok) throw new Error(`读取 data/vectors.bin 失败（HTTP ${res.status}）`);

  const headerLength = Number(res.headers.get('content-length')) || 0;
  const total = headerLength > 0 ? headerLength : expectedBytes;
  const buffer = new Uint8Array(expectedBytes);
  const started = performance.now();
  let received = 0;

  const report = (force) => {
    if (!onProgress) return;
    const elapsed = Math.max((performance.now() - started) / 1000, 0.001);
    const speed = received / elapsed;
    const remain = Math.max(total - received, 0);
    onProgress({
      received,
      total,
      ratio: total > 0 ? Math.min(received / total, 1) : 0,
      speed,
      eta: speed > 0 ? remain / speed : 0,
      force,
    });
  };

  if (!res.body || typeof res.body.getReader !== 'function') {
    // 极老浏览器兜底：一次性读入
    const all = new Uint8Array(await res.arrayBuffer());
    buffer.set(all.subarray(0, expectedBytes));
    report(true);
  } else {
    const reader = res.body.getReader();
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > expectedBytes) {
        throw new Error('data/vectors.bin 体积与 meta.json 声明不一致，请重新运行 scripts/build_data.py');
      }
      buffer.set(value, received);
      received += value.byteLength;
      report(false);
    }
    report(true);
  }

  if (received < expectedBytes) {
    throw new Error(
      `data/vectors.bin 读取不完整（${formatBytes(received)} / ${formatBytes(expectedBytes)}），请重新加载页面`
    );
  }
  return buffer;
}

/** 预计算 L2 范数 */
function computeNorms(vectors, count, dim) {
  const norms = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const offset = i * dim;
    let sum = 0;
    for (let d = 0; d < dim; d += 1) {
      const v = vectors[offset + d];
      sum += v * v;
    }
    norms[i] = Math.sqrt(sum);
  }
  return norms;
}

export { formatBytes };
