# Word2Vec 近邻探索器

一个**完全在浏览器端运行**的词向量近邻探索工具。输入一个词与一个词频阈值，页面会在本地完成全部计算，
给出该词的周围词向量热力图、PCA 二维语义分布图，以及最相似的 5 个词与对应余弦相似度。

- 零依赖、零构建：原生 HTML + CSS + ES Modules，不使用任何前端框架、CDN 或后端服务
- 向量数据**无损**：直接使用模型原始 `float32` 数值，不做量化、降精度或归一化改写
- 词频筛选在检索前生效：只有词频 ≥ 阈值的词才会进入相似度比较

在线地址（部署后）：`https://zhhaon.github.io/Interactive-Word2Vec/`

---

## 功能

| 功能 | 说明 |
| --- | --- |
| 词与词频阈值输入 | 数字输入框 + 对数刻度滑块 + 常用阈值胶囊（5 / 50 / 500 / 5000），实时显示候选词数量 |
| 最相似的 5 个词 | 候选词内按余弦相似度排序，展示词语、相似度（4 位小数）与词频 |
| 周围词向量图像 | Canvas 热力图，行 = 查询词 + 最多 50 个候选近邻词，列 = 100 个维度，颜色 = 该维度原始数值；支持悬停查看「词 / 维度 / 数值」 |
| 语义分布图 | 对上述向量做 PCA（均值中心化 → 协方差矩阵 → Jacobi 特征分解）投影到二维，展示两主成分解释方差比；悬停查看词与相似度 |
| 色标值域切换 | 「固定值域」保证不同查询之间颜色可比，「自适应」按当前结果拉伸色标 |
| 交互联动 | 点击热力图行标签或散点图中的点，可直接把该词设为新的查询词 |

### 筛选与计算规则

- 阈值**只约束候选词**：查询词只要存在于词表即可检索，不受阈值限制，也不会因其自身词频低而告警。
- 结果**不包含查询词自身**。
- 相似度定义为**余弦相似度**：`cos(a, b) = (a · b) / (‖a‖ · ‖b‖)`，向量的 L2 范数在页面加载时预计算。

---

## 目录结构

```
.
├── index.html                 # 单页应用骨架
├── assets/
│   ├── css/style.css          # 设计系统与全部样式
│   └── js/
│       ├── main.js            # 应用入口与流程编排
│       ├── data-loader.js     # 流式加载 vectors.bin / meta.json 并预计算范数
│       ├── search.js          # 词频阈值过滤 + 余弦相似度 Top-K 检索
│       ├── pca.js             # PCA 降维（Jacobi 特征值分解）
│       ├── colormap.js        # 发散 / 顺序色标
│       ├── heatmap.js         # Canvas 向量热力图
│       └── scatter.js         # SVG 语义分布散点图
├── data/                      # 预处理产物（需随站点一起部署）
│   ├── meta.json              # 词表、词频与元信息（约 0.9 MB）
│   └── vectors.bin            # 原始 float32 向量，71292 × 100（约 27.2 MB）
├── scripts/
│   └── build_data.py          # 离线预处理脚本（由 npz + vocab.json 生成 data/）
├── .github/workflows/deploy.yml
├── .nojekyll
└── README.md
```

> `vectors.npz` 与 `vocab.json` 是**输入源数据**，已被 `.gitignore` 排除（避免 25 MB 冗余入库）。
> 它们只需存在于本地，用于运行 `scripts/build_data.py` 生成 `data/` 产物。

---

## 数据规格

| 项目 | 值 |
| --- | --- |
| 词表规模 | 71,292 个词 |
| 向量维度 | 100 |
| 向量类型 | `float32`，小端，行主序，未归一化 |
| 数值范围 | −2.176573 ~ 2.349168 |
| 词频范围 | 5 ~ 1,061,396 |
| `data/vectors.bin` | 71,292 × 100 × 4 = 27.20 MB |

### 预处理

```bash
python scripts/build_data.py
```

脚本会：

1. 用 NumPy 2.x 兼容 shim 读取 `vectors.npz`（该文件由 NumPy 2.x 写出，旧版 NumPy 会报 `No module named 'numpy._core'`）；
2. 断言 `words` 与 `itos` 长度及内容完全一致、`vectors.dtype == float32`、`vectors.shape == (N, 100)`；
3. 输出 `data/meta.json`（`dim / count / minFreq / maxFreq / words / counts`）与 `data/vectors.bin`
   （`np.ascontiguousarray(vectors, dtype='<f4').tofile(...)`，与原数据逐字节一致）。

---

## 本地预览

⚠️ **必须使用本地 HTTP 服务器**，直接双击打开 `index.html`（`file://` 协议）会被浏览器拦截 `fetch`，页面会提示无法读取数据文件。

任选一种：

```bash
# 方式一：Python 内置服务器
python -m http.server 8080

# 方式二：Node
npx serve .
```

然后浏览器访问 <http://localhost:8080/>。

首次进入需下载 27.2 MB 向量数据（页面会显示进度与预计剩余时间），之后由浏览器缓存复用。

---

## 部署到 GitHub Pages（手动推送）

当前目录已包含 `.nojekyll` 与 `.github/workflows/deploy.yml`，按以下步骤操作即可。

### 1. 在 GitHub 上新建一个空仓库

例如 `interactive-word2vec`。**不要**勾选 "Add a README file"，保持空仓库。

### 2. 初始化本地仓库并推送

在项目根目录执行（把 `<用户名>` 与 `<仓库名>` 换成实际值）：

```bash
# 若目录下尚无 .git（当前仓库已初始化为 main 分支，可直接跳到 git add）
git init
git branch -M main

git add .
git commit -m "feat: Word2Vec 词向量近邻探索器"
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

> 推送时若提示需要认证，请使用 GitHub 的 **Personal Access Token** 作为密码（Fine-grained token 需勾选该仓库的 `Contents: Read and write`）。

确认提交内容里包含 `data/`（`git ls-files data` 应能看到 `data/meta.json` 与 `data/vectors.bin`），
且**不包含** `vectors.npz` / `vocab.json`。

### 3. 开启 Pages（Source 选择 GitHub Actions）

1. 打开仓库 → **Settings** → 左侧 **Pages**；
2. **Build and deployment** → **Source** 选择 **GitHub Actions**（不是 "Deploy from a branch"）；
3. 保存后无需其他配置。

### 4. 触发部署

工作流在 **push 到 `main`** 时自动运行，也可在 **Actions** 页手动触发（`Run workflow`）。

前往 **Actions → Deploy static site to GitHub Pages** 查看进度：`build` 收集静态文件并上传 artifact，
`deploy` 发布到 Pages。成功后访问：

```
https://<用户名>.github.io/<仓库名>/
```

### 5. 后续更新

```bash
git add .
git commit -m "chore: 更新"
git push
```

推送后工作流会自动重新部署。

---

## 常见问题

**Q：页面提示模型加载失败 / 无法读取 data/meta.json？**
使用的是 `file://` 协议，请改用本地 HTTP 服务器（见上文「本地预览」），或确认 `data/` 目录已随站点部署。

**Q：查询词提示「词表中没有收录」？**
词表为英文词表且以小写形式存储（如 `the`、`music`）。输入会自动尝试小写与首字母大写形式，仍找不到说明该词不在 71,292 个词之内。

**Q：候选词数量为 0？**
阈值超过了该模型的最大词频（1,061,396），或阈值高于除查询词以外所有词的词频。把阈值调低即可。

**Q：为什么首次加载要下载 27 MB？**
向量数据为原始 `float32` 未量化（实测 gzip 仅能压缩 7%，收益不足以引入解压依赖）。这是保证数值完全保真的代价，数据会被浏览器缓存。

**Q：为什么不用 `vectors.npz` 直接加载？**
`.npz` 内部的 object 数组依赖 Python pickle，浏览器无法解析，因此预处理为裸二进制 + JSON 元数据。

---

## 浏览器支持

需要现代浏览器（Chrome / Edge / Firefox / Safari 近两年版本），依赖 ES Modules、`ReadableStream`、
Canvas 2D 与 SVG。页面已适配 `prefers-reduced-motion`。

---

## 许可

代码部分可自由使用；`vectors.npz` 与 `vocab.json` 的版权与许可归属其原始提供方。
