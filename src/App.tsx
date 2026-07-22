import { useEffect, useMemo, useState } from "react";
import { PriceChart } from "./components/PriceChart";
import type { AssetSummary, CoreStage, PublishedAssetAnalysis, StagePoint } from "./domain/types";
import { stageMeta } from "./lib/stageMeta";
import { normalizeAssetSearch } from "./lib/search";
import "./styles.css";

const coreStageMeta = {
  1: stageMeta.stage_1,
  2: stageMeta.stage_2,
  3: stageMeta.stage_3,
  4: stageMeta.stage_4,
} as const;

function scoreEntries(scores: Record<CoreStage, number> | null) {
  if (!scores) return [];
  return ([1, 2, 3, 4] as CoreStage[]).map((stage) => ({ stage, score: scores[stage] }));
}

function isFullStagePoint(point: PublishedAssetAnalysis["stages"][number]): point is StagePoint {
  return "features" in point && "reasons" in point && "scores" in point;
}

export default function App() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [query, setQuery] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState<"all" | AssetSummary["assetType"]>("all");
  const [selectedSymbol, setSelectedSymbol] = useState("510300.SH");
  const [analysis, setAnalysis] = useState<PublishedAssetAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("./data/assets.json")
      .then((response) => {
        if (!response.ok) throw new Error("资产列表加载失败");
        return response.json() as Promise<AssetSummary[]>;
      })
      .then(setAssets)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`./data/${selectedSymbol}.json`)
      .then((response) => {
        if (!response.ok) throw new Error("该资产的阶段数据暂不可用");
        return response.json() as Promise<PublishedAssetAnalysis>;
      })
      .then(setAnalysis)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [selectedSymbol]);

  const matches = useMemo(() => {
    const normalized = normalizeAssetSearch(query);
    return assets
      .filter((asset) => assetTypeFilter === "all" || asset.assetType === assetTypeFilter)
      .filter((asset) => {
        if (!normalized) return true;
        return [
          asset.symbol,
          asset.symbol.slice(0, 6),
          asset.name,
          asset.category,
          asset.industry,
          ...(asset.indexMemberships ?? []),
          ...(asset.searchTerms ?? []),
        ].some((value) => value && normalizeAssetSearch(value).includes(normalized));
      })
      .sort((left, right) => {
        if (left.symbol === selectedSymbol) return -1;
        if (right.symbol === selectedSymbol) return 1;
        const leftStarts = normalized && (normalizeAssetSearch(left.symbol).startsWith(normalized) || normalizeAssetSearch(left.name).startsWith(normalized));
        const rightStarts = normalized && (normalizeAssetSearch(right.symbol).startsWith(normalized) || normalizeAssetSearch(right.name).startsWith(normalized));
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
        return left.symbol.localeCompare(right.symbol);
      });
  }, [assets, assetTypeFilter, query, selectedSymbol]);
  const selectedAsset = assets.find((asset) => asset.symbol === selectedSymbol);

  const latestCandidate = analysis?.stages.at(-1) ?? null;
  const latest: StagePoint | null = latestCandidate && isFullStagePoint(latestCandidate)
    ? latestCandidate
    : null;
  const latestBar = analysis?.bars.at(-1) ?? null;
  const meta = latest ? stageMeta[latest.state] : stageMeta.insufficient_data;
  const scores = scoreEntries(latest?.scores ?? null);
  const stageDisplay = meta.short.startsWith("S") ? meta.short.replace("S", "Stage ") : meta.short;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="./" aria-label="四阶段趋势投资首页">
          <span className="brand-mark">阶</span>
          <span><strong>四阶段趋势投资</strong><small>4 STAGE</small></span>
        </a>
        <div className="status-pill"><span />本周动态 · 每日更新</div>
      </header>

      <section className="dashboard compact-dashboard">
        <div className="query-strip">
          <label htmlFor="asset-search">查询资产</label>
          <div className="search-input-wrap">
            <span>⌕</span>
            <input
              id="asset-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：510300、沪深300ETF"
              autoComplete="off"
            />
          </div>
          <select
            className="asset-type-filter"
            aria-label="资产类型"
            value={assetTypeFilter}
            onChange={(event) => setAssetTypeFilter(event.target.value as "all" | AssetSummary["assetType"])}
          >
            <option value="all">全部</option>
            <option value="etf">ETF</option>
            <option value="index">指数</option>
            <option value="stock">股票</option>
            <option value="crypto">加密货币</option>
            <option value="crypto_stock">加密股票</option>
          </select>
          <div className="asset-options compact-options">
            {matches.slice(0, 8).map((asset) => (
              <button
                key={asset.symbol}
                className={asset.symbol === selectedSymbol ? "selected" : ""}
                onClick={() => {
                  setSelectedSymbol(asset.symbol);
                  setQuery("");
                }}
              >
                <span><strong>{asset.name}</strong><small>{asset.symbol}</small></span>
                <i>→</i>
              </button>
            ))}
            {assets.length > 0 && matches.length === 0 && <p className="empty-search">当前样本中没有匹配资产</p>}
          </div>
          <small className="result-count">{matches.length}项</small>
          <small className="data-note">
            {selectedAsset?.dataStatus === "live" ? "真实行情 · 前复权" : "当前为模拟数据"}
          </small>
        </div>

        {error && <section className="error-card">{error}</section>}
        {loading && <section className="loading-card">正在读取周线阶段数据…</section>}

        {!loading && analysis && latest && latestBar && (
          <>
          <div className="asset-heading">
            <div className="asset-identity">
              <h2>{analysis.name}</h2>
              <p>{analysis.symbol} · {analysis.exchange}<span>数据截至 {latest.date}</span></p>
            </div>
            <div className="overview-grid result-overview">
              <article className="stage-card" style={{ "--stage-color": meta.color } as React.CSSProperties}>
                <div className="stage-summary-line">
                  <span>当前阶段：</span>
                  <strong>{meta.title}</strong>
                  <b>{stageDisplay}</b>
                </div>
                <div className="stage-summary-line match-summary-line">
                  <span>规则匹配度</span>
                  <strong>{latest.matchScore ?? "—"}/100</strong>
                </div>
              </article>

              <article className="snapshot-card">
                <div><span>本周最新价</span><strong>{latestBar.close.toFixed(3)}</strong></div>
                <div><span>30周均线</span><strong>{latest.features.sma30?.toFixed(3) ?? "—"}</strong></div>
                <div><span>均线斜率</span><strong>{latest.features.normalizedSlope?.toFixed(3) ?? "—"}</strong></div>
                <div><span>52周位置</span><strong>{latest.features.rangePosition52 === null ? "—" : `${Math.round(latest.features.rangePosition52 * 100)}%`}</strong></div>
              </article>
            </div>
          </div>

          <article className="panel chart-panel main-chart-panel">
            <div className="panel-title"><div><h3>动态周线K线与阶段</h3></div><small>本周每日更新 · 30周均线</small></div>
            <PriceChart bars={analysis.bars} stages={analysis.stages} />
          </article>

          <div className="details-grid">
            <article className="panel">
              <div className="panel-title"><div><span>EVIDENCE</span><h3>判断依据</h3></div></div>
              <ul className="reason-list">
                {latest.reasons.map((reason) => (
                  <li key={reason.text} className={reason.tone}><i />{reason.text}</li>
                ))}
              </ul>
            </article>
            <article className="panel">
              <div className="panel-title"><div><span>STAGE SCORES</span><h3>四阶段匹配</h3></div></div>
              <div className="score-list">
                {scores.map(({ stage, score }) => (
                  <div
                    key={stage}
                    className={`score-stage score-stage-${stage}`}
                    style={{ "--score-color": coreStageMeta[stage].color } as React.CSSProperties}
                  >
                    <span><strong>Stage {stage}</strong><small>{coreStageMeta[stage].title}</small></span>
                    <i><b style={{ width: `${score}%` }} /></i>
                    <strong>{score}</strong>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <footer>
            规则匹配度不是未来涨跌概率，不构成投资建议。
          </footer>
          </>
        )}
      </section>
    </main>
  );
}
