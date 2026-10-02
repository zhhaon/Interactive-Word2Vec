#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线预处理脚本：把 vectors.npz + vocab.json 转换成浏览器可直接加载的静态数据。

产物（均写入 <repo>/data/）：
  meta.json    {"dim", "count", "minFreq", "maxFreq", "words": [...], "counts": [...]}
  vectors.bin  原始 float32 小端、行主序、count x dim，无损（不做任何量化 / 归一化）

用法：
  python scripts/build_data.py
"""

import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NPZ_PATH = os.path.join(ROOT, "vectors.npz")
VOCAB_PATH = os.path.join(ROOT, "vocab.json")
OUT_DIR = os.path.join(ROOT, "data")
OUT_META = os.path.join(OUT_DIR, "meta.json")
OUT_VEC = os.path.join(OUT_DIR, "vectors.bin")


def install_numpy2_compat():
    """vectors.npz 由 NumPy 2.x 写出，旧版 NumPy 反序列化时会找 numpy._core。

    这里把 numpy._core.* 别名指向 numpy.core.*，使旧版 NumPy 也能读取该文件。
    """
    if "numpy._core" in sys.modules:
        return
    import numpy.core as core
    import numpy.core.multiarray as multiarray
    import numpy.core.numeric as numeric
    import numpy.core.umath as umath

    sys.modules.setdefault("numpy._core", core)
    sys.modules.setdefault("numpy._core.multiarray", multiarray)
    sys.modules.setdefault("numpy._core.numeric", numeric)
    sys.modules.setdefault("numpy._core.umath", umath)


def load_sources():
    install_numpy2_compat()

    with np.load(NPZ_PATH, allow_pickle=True) as data:
        words = list(data["words"])
        vectors = np.asarray(data["vectors"])

    with open(VOCAB_PATH, "r", encoding="utf-8") as fp:
        vocab = json.load(fp)

    itos = list(vocab["itos"])
    counts = np.asarray(vocab["counts"], dtype=np.int64)

    # --- 一致性校验：npz 的词表与 vocab.json 的 itos 必须逐元素对齐 ---
    if len(words) != len(itos):
        raise SystemExit("[FAIL] words(%d) != itos(%d)" % (len(words), len(itos)))
    if words != itos:
        bad = next(i for i, (a, b) in enumerate(zip(words, itos)) if a != b)
        raise SystemExit("[FAIL] words/itos mismatch at index %d: %r vs %r" % (bad, words[bad], itos[bad]))
    if vectors.shape != (len(words), 100):
        raise SystemExit("[FAIL] unexpected vectors shape: %r" % (vectors.shape,))
    if vectors.dtype != np.float32:
        raise SystemExit("[FAIL] unexpected vectors dtype: %r" % (vectors.dtype,))
    if counts.shape[0] != len(words):
        raise SystemExit("[FAIL] counts length mismatch")

    return words, counts, vectors


def main():
    words, counts, vectors = load_sources()

    # 排除 <unk>(1) / <pad>(0) 这类特殊词，取真实词的最小 / 最大词频
    real = counts[(counts > 1)]
    min_freq = int(real.min())
    max_freq = int(real.max())

    os.makedirs(OUT_DIR, exist_ok=True)

    meta = {
        "dim": int(vectors.shape[1]),
        "count": int(vectors.shape[0]),
        "minFreq": min_freq,
        "maxFreq": max_freq,
        "words": words,
        "counts": [int(c) for c in counts],
    }
    with open(OUT_META, "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, separators=(",", ":"))

    # 无损输出：与 npz 内 vectors 逐字节一致，仅保证 C 连续以便 tofile 顺序写出
    arr = np.ascontiguousarray(vectors, dtype="<f4")
    arr.tofile(OUT_VEC)

    print("dim            : %d" % meta["dim"])
    print("vocab size     : %d" % meta["count"])
    print("freq range     : %d ~ %d" % (min_freq, max_freq))
    print("meta.json      : %.2f MB" % (os.path.getsize(OUT_META) / 1048576.0))
    print("vectors.bin    : %.2f MB" % (os.path.getsize(OUT_VEC) / 1048576.0))
    print("float32 lossless: %s" % (arr.nbytes == os.path.getsize(OUT_VEC)))
    print("OK")


if __name__ == "__main__":
    main()
