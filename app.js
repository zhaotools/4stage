const STAGES = [
  { id: 1, short: "S1", title: "筑底阶段", color: "#5b8def" },
  { id: 2, short: "S2", title: "上升阶段", color: "#22c78a" },
  { id: 3, short: "S3", title: "筑顶阶段", color: "#f2b84b" },
  { id: 4, short: "S4", title: "下降阶段", color: "#ef6a6a" },
];

const form = document.querySelector("#searchForm");
const input = document.querySelector("#symbolInput");
const button = document.querySelector("#searchButton");
const clearButton = document.querySelector("#clearButton");
const notice = document.querySelector("#notice");
const result = document.querySelector("#result");
const datalist = document.querySelector("#assetOptions");
const selects = {
  crypto_bluechip: document.querySelector("#cryptoSelect"),
  a_etf: document.querySelector("#aEtfSelect"),
  us_etf: document.querySelector("#usEtfSelect"),
};

let assets = [];
let lookup = new Map();

function formatNumber(value) {
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function chartSvg(analysis, code) {
  const bars = analysis.bars.filter((bar) => bar.stage && bar.ma30).slice(-220);
  if (!bars.length) return `<p class="empty-chart">历史数据不足</p>`;
  const w = 1100;
  const h = 350;
  const p = 28;
  const low = Math.min(...bars.map((bar) => bar.low)) * 0.94;
  const high = Math.max(...bars.map((bar) => bar.high)) * 1.06;
  const x = (index) => p + index / Math.max(1, bars.length - 1) * (w - p * 2);
  const y = (value) => h - p - (value - low) / (high - low) * (h - p * 2);
  const regions = [];
  bars.forEach((bar, index) => {
    const current = regions.at(-1);
    if (!current || current.stage !== bar.stage) regions.push({ from: index, to: index + 1, stage: bar.stage });
    else current.to = index + 1;
  });
  const backgrounds = regions.map((region) => {
    const stage = STAGES[region.stage - 1];
    const left = x(region.from);
    const right = region.to >= bars.length ? w - p : x(region.to);
    const label = right - left > 75
      ? `<text x="${(left + right) / 2}" y="51" text-anchor="middle" fill="${stage.color}" font-size="13" font-weight="700">${stage.short} ${stage.title}</text>`
      : "";
    return `<rect x="${left}" y="${p}" width="${Math.max(1, right - left)}" height="${h - p * 2}" fill="${stage.color}" opacity=".105"/><line x1="${left}" x2="${left}" y1="${p}" y2="${h - p}" stroke="${stage.color}" opacity=".32"/>${label}`;
  }).join("");
  const candles = bars.map((bar, index) => {
    const up = bar.close >= bar.open;
    const color = up ? "#22c78a" : "#ef6a6a";
    const candleWidth = Math.max(1.8, Math.min(5, (w - p * 2) / bars.length * 0.55));
    return `<line x1="${x(index)}" x2="${x(index)}" y1="${y(bar.high)}" y2="${y(bar.low)}" stroke="${color}"/><rect x="${x(index) - candleWidth / 2}" y="${Math.min(y(bar.open), y(bar.close))}" width="${candleWidth}" height="${Math.max(1.5, Math.abs(y(bar.open) - y(bar.close)))}" fill="${color}"/>`;
  }).join("");
  const ma = bars.map((bar, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(bar.ma30).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${code}历史周线">${backgrounds}${candles}<path d="${ma}" fill="none" stroke="#72a8ff" stroke-width="2"/></svg>`;
}

function marketName(asset) {
  if (asset.group === "crypto_bluechip" && asset.exchange === "CRYPTO") return "加密资产 · 7×24小时";
  if (asset.group === "a_etf" || asset.group === "a_index" || asset.group === "hs300") return "A股市场 · 周线";
  return "美国市场 · 周线";
}

function render(asset, data) {
  const analysis = data.analysis;
  const stage = STAGES[analysis.current.stage - 1];
  const transition = analysis.current.transition;
  const fromStage = transition ? STAGES[transition.from - 1] : null;
  const stageHeading = transition
    ? `${fromStage.short}→${stage.short} <span>${transition.label}</span>`
    : `${stage.short} <span>${stage.title}</span>`;
  const stageCaption = transition
    ? `阶段转换 · 确认 ${transition.confirmationWeeks}/${transition.requiredWeeks} 周 · 完整周线截至 ${analysis.current.asOf}`
    : `当前阶段 · 完整周线截至 ${analysis.current.asOf}`;
  const stageSummary = transition?.type === "breakdown"
    ? "价格显著跌破30周均线 · 连续完整周线确认中"
    : transition?.type === "recovery"
      ? "价格显著站回30周均线 · 连续完整周线确认中"
      : transition
        ? "阶段信号正在切换 · 连续完整周线确认中"
        : `${analysis.current.slope > 0.002 ? "均线向上" : analysis.current.slope < -0.002 ? "均线向下" : "均线趋平"} · 完整周线确认`;
  const interpretation = transition
    ? `系统已识别${fromStage.short}向${stage.short}的${transition.label}，始于 ${transition.startedAt}。当前确认进度为 ${transition.confirmationWeeks}/${transition.requiredWeeks} 周；满足连续完整周线条件后才确认新阶段，信号失效则恢复原阶段。`
    : "后台仅使用已收盘的完整周线，依据价格与30周均线的位置、均线5周斜率、10/30周趋势关系、52周区间位置和量能变化统一计算。";
  const latest = analysis.bars.at(-1);
  const prior = analysis.bars.at(-2);
  const change = latest && prior ? latest.close / prior.close - 1 : 0;
  result.className = "";
  result.innerHTML = `
    <section class="workspace">
      <aside class="asset-report">
        <small>${marketName(asset)}</small>
        <h1>${asset.symbol}</h1>
        <p class="sub">${data.name} · ${data.source} · 后台分析</p>
        <div class="current-stage">
          <small>${stageCaption}</small>
          <h2 class="${transition ? "is-transition" : ""}" style="color:${stage.color}">${stageHeading}</h2>
          <p>${stageSummary}</p>
        </div>
        <div class="quote-box">
          <div><small>最新价格</small><b>${formatNumber(analysis.current.close)}</b></div>
          <div><small>本周涨跌</small><b class="${change < 0 ? "down" : "positive"}">${change >= 0 ? "+" : ""}${(change * 100).toFixed(2)}%</b></div>
          <div><small>阶段置信度</small><b>${analysis.current.confidence}%</b></div>
          <div><small>距离30周均线</small><b class="${analysis.current.distance < 0 ? "down" : "positive"}">${analysis.current.distance >= 0 ? "+" : ""}${(analysis.current.distance * 100).toFixed(2)}%</b></div>
        </div>
        <div class="interpretation">
          <b>ⓘ 当前状态解读</b>
          <p>${interpretation}</p>
        </div>
      </aside>
      <div class="analysis-area">
        <nav class="stage-tabs">${STAGES.map((item) => `<div class="${item.id === stage.id ? "active" : ""}" style="--stage:${item.color}"><b>${item.short}</b><span>${item.title}</span></div>`).join("")}</nav>
        <section class="chart-panel">
          <div class="panel-head">
            <div><small>BACKEND WEEKLY DATA</small><h3>历史阶段 · 周线</h3></div>
            <div class="legend">K线　<span style="color:#72a8ff">—</span> 30周均线</div>
          </div>
          <div class="chart-wrap">${chartSvg(analysis, asset.symbol)}</div>
          <div class="axis"><span>${analysis.bars.at(-220)?.time.slice(0, 4) || ""}</span><span>历史阶段</span><span>当前</span></div>
        </section>
      </div>
    </section>`;
  requestAnimationFrame(() => {
    const chart = result.querySelector(".chart-wrap");
    if (chart) chart.scrollLeft = chart.scrollWidth - chart.clientWidth;
  });
}

function registerAsset(asset) {
  const keys = [
    asset.symbol,
    asset.providerSymbol,
    asset.name,
    ...(asset.aliases || []),
    ...(asset.searchTerms || []),
  ].filter(Boolean);
  keys.forEach((key) => lookup.set(String(key).trim().toUpperCase(), asset));
}

function resolveAsset(query) {
  const key = query.trim().toUpperCase().replace(/\s+/g, "");
  if (!key) return null;
  if (lookup.has(key)) return lookup.get(key);
  const matches = assets.filter((asset) => {
    const haystack = [asset.symbol, asset.providerSymbol, asset.name, ...(asset.aliases || []), ...(asset.searchTerms || [])].join(" ").toUpperCase();
    return haystack.includes(key);
  });
  return matches.length === 1 ? matches[0] : null;
}

function populateSelect(select, group, label) {
  const groupAssets = assets.filter((asset) => asset.group === group);
  const sections = [];
  groupAssets.forEach((asset) => {
    const sectionName = asset.section || label;
    let section = sections.find((item) => item.name === sectionName);
    if (!section) {
      section = { name: sectionName, assets: [] };
      sections.push(section);
    }
    section.assets.push(asset);
  });
  const options = sections.map((section) => `<optgroup label="${section.name}">${section.assets.map((asset) => `<option value="${asset.symbol}">${asset.name} · ${asset.symbol}</option>`).join("")}</optgroup>`).join("");
  select.innerHTML = `<option value="">${label}（${groupAssets.length}）</option>${options}`;
}

async function load(rawCode) {
  const asset = resolveAsset(rawCode);
  notice.hidden = true;
  if (!asset) {
    notice.textContent = "未找到该资产。可输入代码、简称，或使用下拉框选择。";
    notice.hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = "读取中…";
  result.className = "loading-card";
  result.textContent = "正在读取后台分析结果…";
  try {
    const response = await fetch(`./data/${encodeURIComponent(asset.symbol)}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error("该资产的后台数据暂未生成");
    const data = await response.json();
    if (!data.analysis?.current) throw new Error("后台分析结果格式异常");
    render(asset, data);
    input.value = asset.symbol;
    updateClearButton();
    Object.values(selects).forEach((select) => {
      select.value = asset.symbol;
    });
  } catch (error) {
    result.className = "loading-card";
    result.textContent = "未能读取分析结果";
    notice.textContent = error.message || "查询失败，请稍后再试";
    notice.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "分析阶段";
  }
}

async function initialize() {
  try {
    const response = await fetch("./data/assets.json", { cache: "no-store" });
    if (!response.ok) throw new Error("后台资产清单暂不可用");
    const manifest = await response.json();
    assets = manifest.assets || [];
    lookup = new Map();
    assets.forEach(registerAsset);
    datalist.innerHTML = assets.map((asset) => `<option value="${asset.symbol}">${asset.name}</option>`).join("");
    populateSelect(selects.crypto_bluechip, "crypto_bluechip", "加密蓝筹");
    populateSelect(selects.a_etf, "a_etf", "A股ETF");
    populateSelect(selects.us_etf, "us_etf", "美股ETF");
    await load(resolveAsset("BTC") ? "BTC" : assets[0]?.symbol || "");
  } catch (error) {
    result.className = "loading-card";
    result.textContent = "后台数据尚未就绪";
    notice.textContent = error.message;
    notice.hidden = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  load(input.value);
});

function updateClearButton() {
  clearButton.hidden = input.value.length === 0;
}

input.addEventListener("input", updateClearButton);
clearButton.addEventListener("click", () => {
  input.value = "";
  updateClearButton();
  input.focus();
});

Object.values(selects).forEach((select) => {
  select.addEventListener("change", () => {
    if (select.value) load(select.value);
  });
});

updateClearButton();
initialize();
