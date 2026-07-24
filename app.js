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

function visibleChartBars(analysis) {
  return analysis.bars.filter((bar) => bar.stage && bar.ma30).slice(-220);
}

function chartSvg(analysis, code) {
  const bars = visibleChartBars(analysis);
  if (!bars.length) return `<p class="empty-chart">历史数据不足</p>`;
  const w = 1100;
  const h = window.matchMedia("(max-width: 760px)").matches ? 350 : 560;
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
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${code}历史周线">${backgrounds}${candles}<path d="${ma}" fill="none" stroke="#72a8ff" stroke-width="2"/><line class="chart-hover-line" x1="0" x2="0" y1="${p}" y2="${h - p}"/><circle class="chart-hover-dot" cx="0" cy="0" r="4"/></svg><div class="chart-tooltip" hidden></div>`;
}

function chartAxis(analysis) {
  const bars = visibleChartBars(analysis);
  if (!bars.length) return "";
  const tickCount = 7;
  const indexes = Array.from({ length: tickCount }, (_, index) => (
    Math.round(index * (bars.length - 1) / (tickCount - 1))
  ));
  return indexes.map((index) => `<span>${bars[index].time.slice(0, 7)}</span>`).join("");
}

function bindChartTooltip(container, analysis) {
  const bars = visibleChartBars(analysis);
  const svg = container.querySelector("svg");
  const tooltip = container.querySelector(".chart-tooltip");
  const hoverLine = container.querySelector(".chart-hover-line");
  const hoverDot = container.querySelector(".chart-hover-dot");
  if (!bars.length || !svg || !tooltip || !hoverLine || !hoverDot) return;

  const padding = 28;
  const low = Math.min(...bars.map((bar) => bar.low)) * 0.94;
  const high = Math.max(...bars.map((bar) => bar.high)) * 1.06;

  svg.addEventListener("mousemove", (event) => {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const chartX = (event.clientX - rect.left) / rect.width * viewBox.width;
    const ratio = Math.max(0, Math.min(1, (chartX - padding) / (viewBox.width - padding * 2)));
    const index = Math.round(ratio * (bars.length - 1));
    const bar = bars[index];
    const stage = STAGES[bar.stage - 1];
    const x = padding + index / Math.max(1, bars.length - 1) * (viewBox.width - padding * 2);
    const y = viewBox.height - padding
      - (bar.close - low) / (high - low) * (viewBox.height - padding * 2);

    hoverLine.setAttribute("x1", x);
    hoverLine.setAttribute("x2", x);
    hoverLine.classList.add("visible");
    hoverDot.setAttribute("cx", x);
    hoverDot.setAttribute("cy", y);
    hoverDot.style.fill = stage.color;
    hoverDot.classList.add("visible");
    tooltip.innerHTML = `<b>${bar.time}</b><span>收盘价　${formatNumber(bar.close)}</span><strong style="color:${stage.color}">${stage.short} ${stage.title}</strong>`;
    tooltip.hidden = false;

    const wrapRect = container.getBoundingClientRect();
    const cursorX = event.clientX - wrapRect.left;
    const cursorY = event.clientY - wrapRect.top;
    const placeLeft = cursorX > wrapRect.width * 0.72;
    tooltip.style.left = `${container.scrollLeft + cursorX + (placeLeft ? -tooltip.offsetWidth - 14 : 14)}px`;
    tooltip.style.top = `${Math.max(8, cursorY - tooltip.offsetHeight - 12)}px`;
  });

  svg.addEventListener("mouseleave", () => {
    tooltip.hidden = true;
    hoverLine.classList.remove("visible");
    hoverDot.classList.remove("visible");
  });
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
  const evidenceRows = (analysis.current.evidence || []).map((item) => {
    const icon = item.state === "support" ? "✓" : item.state === "warning" ? "!" : "•";
    return `
      <div class="evidence-row ${item.state}">
        <i>${icon}</i>
        <div><b>${item.label}</b><small>${item.detail}</small></div>
        <strong>${item.value}</strong>
      </div>`;
  }).join("");
  const evidenceContent = `
    <header><b>当前阶段的证据</b><small>${stage.short} · 基于 ${analysis.current.asOf} 完整周线</small></header>
    <div class="evidence-list">${evidenceRows}</div>
    <p class="evidence-summary">${analysis.current.explanation || ""}</p>`;
  result.className = "";
  result.innerHTML = `
    <section class="workspace">
      <aside class="asset-report">
        <small>${marketName(asset)}</small>
        <h1>${asset.symbol}</h1>
        <p class="sub">${data.name}</p>
        <div class="current-stage">
          <small>${stageCaption}</small>
          <h2 class="${transition ? "is-transition" : ""}" style="color:${stage.color}">${stageHeading}</h2>
          <p>${stageSummary}</p>
        </div>
        <section class="stage-evidence desktop-evidence">${evidenceContent}</section>
      </aside>
      <div class="analysis-area">
        <nav class="stage-tabs">${STAGES.map((item) => `<div class="${item.id === stage.id ? "active" : ""}" style="--stage:${item.color}"><b>${item.short}</b><span>${item.title}</span></div>`).join("")}</nav>
        <section class="chart-panel">
          <div class="panel-head">
            <div><small>BACKEND WEEKLY DATA</small><h3>历史阶段 · 周线</h3></div>
            <div class="chart-meta">
              <div class="legend">K线　<span style="color:#72a8ff">—</span> 30周均线</div>
              <small>K线更新至 ${analysis.current.latestAsOf} · 阶段确认至 ${analysis.current.asOf}</small>
            </div>
          </div>
          <div class="chart-wrap">${chartSvg(analysis, asset.symbol)}</div>
          <div class="axis">${chartAxis(analysis)}</div>
        </section>
        <section class="stage-evidence mobile-evidence">${evidenceContent}</section>
      </div>
    </section>`;
  requestAnimationFrame(() => {
    const chart = result.querySelector(".chart-wrap");
    if (chart) {
      chart.scrollLeft = chart.scrollWidth - chart.clientWidth;
      bindChartTooltip(chart, analysis);
    }
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
  select.innerHTML = `<option value="">${label}</option>${options}`;
  select.dataset.placeholder = label;
  select.closest("label").dataset.display = label;
}

function updateSelectDisplay(select) {
  select.closest("label").dataset.display = select.value || select.dataset.placeholder || "";
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
      updateSelectDisplay(select);
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
    updateSelectDisplay(select);
    if (select.value) load(select.value);
  });
});

updateClearButton();
initialize();
