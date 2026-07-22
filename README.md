# A股趋势阶段

基于完整周线数据的A股四阶段趋势分类工具。首期目标覆盖主要ETF和沪深300成分股，输出当前阶段、过渡状态、规则匹配度、判断依据与历史阶段。

> 本项目描述市场结构，不预测未来涨跌，也不构成投资建议。

## 当前进度

- [x] React + TypeScript + Vite静态网页
- [x] GitHub Pages部署工作流
- [x] 日线聚合完整周线
- [x] 30周均线、ATR、斜率、突破和波动特征
- [x] Stage 1～4评分模型
- [x] 有记忆的阶段状态机、过渡状态和两周确认
- [x] 真实ETF组合诊断及“不明确”占比质量门槛
- [x] “横盘状态 → 前置趋势 → Stage 1/3”分层识别模型
- [x] 趋势证据冲突时输出“不明确”，避免强制分类
- [x] 因果性测试，算法不读取未来数据
- [x] 免密真实ETF数据适配器、前复权处理和数据校验
- [x] Tushare可选适配器和复权处理
- [ ] 加入相对强弱曲线及评分
- [ ] 扩充并核验主要ETF清单
- [ ] 接入当前及历史沪深300成分股
- [x] 第一版人工样本校准（后续验证暂停）

## 本地运行

需要Node.js 20或更高版本，以及pnpm。

```bash
pnpm install
pnpm data:sample
pnpm dev
```

样例数据是为了验证页面与算法管道生成的模拟数据，不是真实行情。

## 运行测试

```bash
pnpm test
pnpm build
pnpm model:validate
```

模型诊断会统计各资产的不明确占比、过渡占比、阶段切换次数和平均持续周数；组合不明确占比默认不得超过25%。

历史标注工具和样本保留在源码中作为研究档案，但不会进入公开网站构建，也不参与自动部署。

## 真实数据更新

默认数据源无需令牌，可直接更新`config/etfs.json`中的ETF：

```bash
pnpm data:update
```

数据按日线下载、校验OHLC关系、聚合为完整周线，再运行阶段识别。也可以显式使用Tushare：

```bash
DATA_PROVIDER=tushare TUSHARE_TOKEN=your_token pnpm data:update
```

默认更新`config/etfs.json`中的ETF。加入当前沪深300成分股：

```bash
DATA_PROVIDER=tushare TUSHARE_TOKEN=your_token INCLUDE_HS300=true pnpm data:update
```

重要说明：

- 股票复权需要`adj_factor`权限；
- ETF复权需要`fund_adj`权限；
- 沪深300成分股需要`index_weight`和`stock_basic`权限；
- 原始行情和令牌不会写入Git仓库；
- 公开展示前应确认数据供应商的外部展示与衍生数据条款。

## GitHub Pages

仓库包含`.github/workflows/pages.yml`：

1. 运行单元测试；
2. 免密生成主要ETF真实数据，不再自动退回模拟数据；
3. 构建静态网页；
4. 部署到GitHub Pages；
5. 每周六自动更新一次。

在仓库设置中完成两项配置：

1. `Settings → Pages → Source`选择`GitHub Actions`；
2. 如需扩展沪深300成分股，再在`Actions`中添加`TUSHARE_TOKEN`并切换数据源。

## 阶段定义

| 状态 | 含义 |
|---|---|
| Stage 1 | 下跌趋缓，进入底部构筑或低位平衡 |
| Stage 1→2 | 向上突破观察，尚未完成确认 |
| Stage 2 | 价格位于上升的30周均线上方 |
| Stage 2→3 | 上升趋势减速，进入高位平衡观察 |
| Stage 3 | 高位震荡，上升结构失去持续性 |
| Stage 3→4 | 支撑破坏，等待下降趋势确认 |
| Stage 4 | 价格位于下降的30周均线下方 |
| Stage 4→1 | 下降斜率收敛，寻找新的平衡区间 |
| 阶段不明确 | 多个阶段得分接近，不强制分类 |

“规则匹配度”只是当前结构与规则的接近程度，不是未来上涨或下跌概率。

## 项目结构

```text
src/domain/       阶段模型、类型和计算引擎
src/data/         日线到周线的数据处理
src/components/   查询页和周线图表
scripts/          样例及Tushare数据更新
config/           支持的ETF资产清单
tests/            因果性和数据处理测试
public/data/      构建时生成的查询数据
.github/workflows GitHub Pages自动更新与部署
```

## 路线图

1. 用主要ETF完成数据和算法闭环；
2. 加入当前沪深300成分股；
3. 保存历史成分，消除回测幸存者偏差；
4. 扩充主要ETF覆盖范围；
5. 加入相对强弱和阶段转换统计。
