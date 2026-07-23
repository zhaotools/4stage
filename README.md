# Weinstein 四阶段趋势分析 V1.0.0

GitHub Pages 静态部署版，无需 Node.js、服务器或数据库。

## 部署

1. 在 GitHub 新建仓库，例如 `4stage`。
2. 把本目录中的全部文件上传到仓库根目录。
3. 打开仓库 **Settings → Pages**。
4. 在 **Build and deployment** 中选择 **Deploy from a branch**。
5. Branch 选择 `main`，目录选择 `/ (root)`，点击 **Save**。
6. 等待约 1–3 分钟，通过 GitHub 提供的网址访问。

如果仓库名是 `4stage`，地址通常为：

`https://你的用户名.github.io/4stage/`

## 支持的代码格式

- 加密：`BTCUSDT`、`ETHUSDT`
- 美股：`TSLA`、`SPY`、`AAPL`
- A股：`588000.SH`、`510300.SH`、`159915.SZ`

## 数据说明

- 加密资产使用 Binance 免费公开周线接口。
- A 股使用东方财富免费历史行情接口。
- 美股使用 Yahoo Finance 免费历史行情接口。
- GitHub Pages 是纯静态托管，行情请求直接从访问者浏览器发出。
- 免费接口可能出现跨域限制、地区限制、延迟或短时不可用，不适合作为正式商业数据源。

## 文件

- `index.html`：页面结构
- `styles.css`：深色交易终端 UI
- `app.js`：行情请求、四阶段算法和 K 线绘制
- `.nojekyll`：避免 GitHub Pages 的 Jekyll 处理
