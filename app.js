const STAGES = [
  { id: 1, short: "S1", title: "筑底阶段", color: "#5b8def" },
  { id: 2, short: "S2", title: "上升阶段", color: "#22c78a" },
  { id: 3, short: "S3", title: "筑顶阶段", color: "#f2b84b" },
  { id: 4, short: "S4", title: "下降阶段", color: "#ef6a6a" },
];

const form = document.querySelector("#searchForm");
const input = document.querySelector("#symbolInput");
const button = document.querySelector("#searchButton");
const notice = document.querySelector("#notice");
const result = document.querySelector("#result");

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sma(bars, index, period) {
  if (index < period - 1) return null;
  return average(bars.slice(index - period + 1, index + 1).map((bar) => bar.close));
}

function rangePosition(bars, index, lookback) {
  const slice = bars.slice(Math.max(0, index - lookback + 1), index + 1);
  const high = Math.max(...slice.map((bar) => bar.high));
  const low = Math.min(...slice.map((bar) => bar.low));
  return high === low ? 0.5 : (bars[index].close - low) / (high - low);
}

function volumeRatio(bars, index) {
  if (index < 10) return 1;
  const current = average(bars.slice(index - 3, index + 1).map((bar) => bar.volume));
  const baseline = average(bars.slice(index - 10, index - 3).map((bar) => bar.volume));
  return baseline > 0 ? current / baseline : 1;
}

function chooseStage(bar, ma10, ma30, slope, position, volume, previous) {
  const distance = bar.close / ma30 - 1;
  const fastDistance = ma10 / ma30 - 1;
  const score = { 1: 0, 2: 0, 3: 0, 4: 0 };

  score[2] += distance > .02 ? 3 : distance > 0 ? 1 : 0;
  score[2] += slope > .008 ? 3 : slope > .002 ? 2 : 0;
  score[2] += fastDistance > .01 ? 2 : fastDistance > 0 ? 1 : 0;
  score[2] += position > .72 ? 2 : position > .55 ? 1 : 0;
  score[2] += volume > 1.15 && distance > 0 ? 1 : 0;

  score[4] += distance < -.02 ? 3 : distance < 0 ? 1 : 0;
  score[4] += slope < -.008 ? 3 : slope < -.002 ? 2 : 0;
  score[4] += fastDistance < -.01 ? 2 : fastDistance < 0 ? 1 : 0;
  score[4] += position < .28 ? 2 : position < .45 ? 1 : 0;
  score[4] += volume > 1.15 && distance < 0 ? 1 : 0;

  const flat = Math.abs(slope);
  score[1] += flat < .006 ? 3 : flat < .012 ? 1 : 0;
  score[1] += Math.abs(distance) < .06 ? 2 : 0;
  score[1] += position < .58 ? 2 : 0;
  score[1] += previous === 4 || previous === 1 ? 2 : 0;

  score[3] += flat < .008 ? 3 : flat < .015 ? 1 : 0;
  score[3] += Math.abs(distance) < .08 ? 2 : 0;
  score[3] += position > .48 ? 2 : 0;
  score[3] += previous === 2 || previous === 3 ? 2 : 0;

  const ranked = Object.entries(score).map(([stage, value]) => ({ stage: Number(stage), value })).sort((a, b) => b.value - a.value);
  if (previous && ranked[0].stage !== previous && score[previous] >= ranked[0].value - 1) return previous;
  return ranked[0].stage;
}

function analyze(inputBars) {
  const source = [...inputBars].filter((bar) => [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)).sort((a, b) => a.time.localeCompare(b.time));
  let previous = null;
  const bars = source.map((bar, index) => {
    const ma10 = sma(source, index, 10);
    const ma30 = sma(source, index, 30);
    const oldMa30 = index >= 34 ? sma(source, index - 5, 30) : null;
    if (ma10 === null || ma30 === null || oldMa30 === null) return { ...bar, ma30, slope: null, stage: null };
    const slope = ma30 / oldMa30 - 1;
    const stage = chooseStage(bar, ma10, ma30, slope, rangePosition(source, index, 52), volumeRatio(source, index), previous);
    previous = stage;
    return { ...bar, ma30, slope, stage };
  });
  const latest = bars.at(-1);
  if (!latest?.stage || !latest.ma30) throw new Error("至少需要35根完整周线");
  const distance = latest.close / latest.ma30 - 1;
  const position = rangePosition(source, source.length - 1, 52);
  const fit = latest.stage === 2 ? Math.max(0, latest.slope) + Math.max(0, distance)
    : latest.stage === 4 ? Math.max(0, -latest.slope) + Math.max(0, -distance)
    : Math.max(0, .025 - Math.abs(latest.slope)) + Math.max(0, .08 - Math.abs(distance));
  const confidence = Math.round(Math.max(55, Math.min(94, 61 + fit * 220 + Math.abs(position - .5) * 12)));
  return { bars, current: { stage: latest.stage, close: latest.close, ma30: latest.ma30, slope: latest.slope, distance, confidence, asOf: latest.time } };
}

function inferMarket(code) {
  if (code.endsWith(".SH") || code.endsWith(".SZ")) return "cn";
  if (/^[A-Z0-9]{2,12}(USDT|USDC)$/.test(code)) return "crypto";
  if (/^[A-Z][A-Z0-9.-]{0,14}$/.test(code)) return "us";
  throw new Error("无法识别代码格式");
}

async function fetchCrypto(code) {
  let lastError;
  for (const host of ["https://api.binance.com", "https://api1.binance.com"]) {
    try {
      const response = await fetch(`${host}/api/v3/klines?symbol=${encodeURIComponent(code)}&interval=1w&limit=300`);
      if (!response.ok) throw new Error(response.status === 400 ? "未找到该加密资产" : "行情请求失败");
      const rows = await response.json();
      return {
        name: code,
        source: "Binance Public API",
        bars: rows.map((row) => ({ time: new Date(Number(row[0])).toISOString().slice(0, 10), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) })),
      };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("加密行情暂时不可用");
}

async function fetchYahoo(code) {
  const symbol = code.endsWith(".SH") ? code.replace(/\.SH$/, ".SS") : code;
  let lastError;
  for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1wk&range=10y&events=div%2Csplits`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("免费行情请求失败");
      const payload = await response.json();
      if (payload.chart?.error) throw new Error(payload.chart.error.description || "未找到该资产");
      const data = payload.chart?.result?.[0];
      const quote = data?.indicators?.quote?.[0];
      if (!data?.timestamp || !quote) throw new Error("没有可用的历史行情");
      const bars = data.timestamp.flatMap((timestamp, index) => {
        const values = [quote.open?.[index], quote.high?.[index], quote.low?.[index], quote.close?.[index], quote.volume?.[index]];
        if (values.some((value) => value == null)) return [];
        return [{ time: new Date(timestamp * 1000).toISOString().slice(0, 10), open: Number(values[0]), high: Number(values[1]), low: Number(values[2]), close: Number(values[3]), volume: Number(values[4]) }];
      });
      return { name: data.meta?.longName || data.meta?.shortName || code, source: "Yahoo Finance", bars };
    } catch (error) { lastError = error; }
  }
  throw new Error(`${lastError?.message || "行情暂时不可用"}。如持续出现，请查看 README 中的免费接口说明。`);
}

async function fetchChina(code) {
  const rawCode = code.replace(/\.(SH|SZ)$/, "");
  const market = code.endsWith(".SH") ? "1" : "0";
  const params = new URLSearchParams({
    secid: `${market}.${rawCode}`,
    klt: "102",
    fqt: "1",
    lmt: "520",
    end: "20500101",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f61",
  });
  const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`);
  if (!response.ok) throw new Error("A股行情请求失败");
  const payload = await response.json();
  const data = payload?.data;
  if (!data?.klines?.length) throw new Error("未找到该A股资产");
  const bars = data.klines.flatMap((line) => {
    const [time, open, close, high, low, volume] = line.split(",");
    const values = [open, high, low, close, volume].map(Number);
    if (values.some((value) => !Number.isFinite(value))) return [];
    return [{ time, open: values[0], high: values[1], low: values[2], close: values[3], volume: values[4] }];
  });
  return { name: data.name || code, source: "东方财富 · 前复权", bars };
}

function formatNumber(value) {
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function chartSvg(analysis, code) {
  const bars = analysis.bars.filter((bar) => bar.stage && bar.ma30).slice(-220);
  const w = 1100, h = 350, p = 28;
  const low = Math.min(...bars.map((bar) => bar.low)) * .94;
  const high = Math.max(...bars.map((bar) => bar.high)) * 1.06;
  const x = (i) => p + i / Math.max(1, bars.length - 1) * (w - p * 2);
  const y = (value) => h - p - (value - low) / (high - low) * (h - p * 2);
  const regions = [];
  bars.forEach((bar, index) => {
    const current = regions.at(-1);
    if (!current || current.stage !== bar.stage) regions.push({ from: index, to: index + 1, stage: bar.stage });
    else current.to = index + 1;
  });
  const backgrounds = regions.map((region) => {
    const stage = STAGES[region.stage - 1];
    const left = x(region.from), right = region.to >= bars.length ? w - p : x(region.to);
    const label = right - left > 75 ? `<text x="${(left + right) / 2}" y="51" text-anchor="middle" fill="${stage.color}" font-size="13" font-weight="700">${stage.short} ${stage.title}</text>` : "";
    return `<rect x="${left}" y="${p}" width="${Math.max(1, right - left)}" height="${h - p * 2}" fill="${stage.color}" opacity=".105"/><line x1="${left}" x2="${left}" y1="${p}" y2="${h - p}" stroke="${stage.color}" opacity=".32"/>${label}`;
  }).join("");
  const candles = bars.map((bar, index) => {
    const up = bar.close >= bar.open, color = up ? "#22c78a" : "#ef6a6a";
    const cw = Math.max(1.8, Math.min(5, (w - p * 2) / bars.length * .55));
    return `<line x1="${x(index)}" x2="${x(index)}" y1="${y(bar.high)}" y2="${y(bar.low)}" stroke="${color}"/><rect x="${x(index) - cw / 2}" y="${Math.min(y(bar.open), y(bar.close))}" width="${cw}" height="${Math.max(1.5, Math.abs(y(bar.open) - y(bar.close)))}" fill="${color}"/>`;
  }).join("");
  const ma = bars.map((bar, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(bar.ma30).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${code}历史周线">${backgrounds}${candles}<path d="${ma}" fill="none" stroke="#72a8ff" stroke-width="2"/></svg>`;
}

function render(code, market, data, analysis) {
  const stage = STAGES[analysis.current.stage - 1];
  const latest = analysis.bars.at(-1), prior = analysis.bars.at(-2);
  const change = latest && prior ? latest.close / prior.close - 1 : 0;
  const marketName = market === "crypto" ? "加密资产 · 7×24小时" : market === "us" ? "美国市场 · 周线" : "A股市场 · 周线";
  result.className = "";
  result.innerHTML = `
    <section class="workspace">
      <aside class="asset-report">
        <small>${marketName}</small><h1>${code}</h1><p class="sub">${data.name} · ${data.source}</p>
        <div class="current-stage"><small>当前阶段 · 截至 ${analysis.current.asOf}</small><h2 style="color:${stage.color}">${stage.short} <span>${stage.title}</span></h2><p>${analysis.current.slope > .002 ? "均线向上" : analysis.current.slope < -.002 ? "均线向下" : "均线趋平"} · 周线确认</p></div>
        <div class="quote-box">
          <div><small>最新价格</small><b>${formatNumber(analysis.current.close)}</b></div>
          <div><small>本周涨跌</small><b class="${change < 0 ? "down" : "positive"}">${change >= 0 ? "+" : ""}${(change * 100).toFixed(2)}%</b></div>
          <div><small>阶段置信度</small><b>${analysis.current.confidence}%</b></div>
          <div><small>距离30周均线</small><b class="${analysis.current.distance < 0 ? "down" : "positive"}">${analysis.current.distance >= 0 ? "+" : ""}${(analysis.current.distance * 100).toFixed(2)}%</b></div>
        </div>
        <div class="interpretation"><b>ⓘ 阶段解读</b><p>依据价格与30周均线的位置、均线5周斜率、10/30周趋势关系、52周区间位置和量能变化综合判断。</p></div>
      </aside>
      <div class="analysis-area">
        <nav class="stage-tabs">${STAGES.map((item) => `<div class="${item.id === stage.id ? "active" : ""}" style="--stage:${item.color}"><b>${item.short}</b><span>${item.title}</span></div>`).join("")}</nav>
        <section class="chart-panel"><div class="panel-head"><div><small>REAL WEEKLY DATA</small><h3>历史阶段 · 周线</h3></div><div class="legend">K线　<span style="color:#72a8ff">—</span> 30周均线</div></div><div class="chart-wrap">${chartSvg(analysis, code)}</div><div class="axis"><span>${analysis.bars.at(-220)?.time.slice(0, 4) || ""}</span><span>历史阶段</span><span>当前</span></div></section>
      </div>
    </section>`;
}

async function load(rawCode) {
  const code = rawCode.trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return;
  notice.hidden = true;
  button.disabled = true;
  button.textContent = "分析中…";
  result.className = "loading-card";
  result.textContent = "正在读取真实周线并计算四阶段…";
  try {
    const market = inferMarket(code);
    const data = market === "crypto"
      ? await fetchCrypto(code)
      : market === "cn"
        ? await fetchChina(code)
        : await fetchYahoo(code);
    render(code, market, data, analyze(data.bars));
    input.value = code;
  } catch (error) {
    result.className = "loading-card";
    result.textContent = "未能完成分析";
    notice.textContent = error.message || "查询失败，请稍后再试";
    notice.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "分析阶段";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  load(input.value);
});

load("BTCUSDT");
