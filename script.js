"use strict";

/* CONFIG & DOM REFERENCES */
const API_BASE = "https://api.coingecko.com/api/v3";
const VS_CURRENCY = "usd";
const MARKETS_PAGE_SIZE = 100;

const DOM = {
  statusText: document.getElementById("statusText"),
  searchInput: document.getElementById("searchInput"),
  searchResults: document.getElementById("searchResults"),

  assetIcon: document.getElementById("assetIcon"),
  assetName: document.getElementById("assetName"),
  assetSymbol: document.getElementById("assetSymbol"),
  assetRank: document.getElementById("assetRank"),
  assetPrice: document.getElementById("assetPrice"),
  assetChange: document.getElementById("assetChange"),
  statHigh: document.getElementById("statHigh"),
  statLow: document.getElementById("statLow"),
  statVol: document.getElementById("statVol"),
  statCap: document.getElementById("statCap"),

  timeframeGroup: document.getElementById("timeframeGroup"),

  candleDropdown: document.getElementById("candleDropdown"),
  candleTrigger: document.getElementById("candleTrigger"),
  candleMenu: document.getElementById("candleMenu"),
  candleLabel: document.getElementById("candleLabel"),

  indicatorDropdown: document.getElementById("indicatorDropdown"),
  indicatorTrigger: document.getElementById("indicatorTrigger"),
  indicatorMenu: document.getElementById("indicatorMenu"),
  indicatorCount: document.getElementById("indicatorCount"),

  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  resetBtn: document.getElementById("resetBtn"),

  chartStage: document.getElementById("chartStage"),
  chartLoading: document.getElementById("chartLoading"),
  chartError: document.getElementById("chartError"),
  chartErrorText: document.getElementById("chartErrorText"),
  chartRetryBtn: document.getElementById("chartRetryBtn"),

  panePrice: document.getElementById("panePrice"),
  paneVolume: document.getElementById("paneVolume"),
  paneRsi: document.getElementById("paneRsi"),
  paneMacd: document.getElementById("paneMacd"),

  priceCanvas: document.getElementById("priceCanvas"),
  priceOverlay: document.getElementById("priceOverlay"),
  volumeCanvas: document.getElementById("volumeCanvas"),
  rsiCanvas: document.getElementById("rsiCanvas"),
  macdCanvas: document.getElementById("macdCanvas"),

  crosshairTooltip: document.getElementById("crosshairTooltip"),

  watchlistList: document.getElementById("watchlistList"),
  watchlistCount: document.getElementById("watchlistCount"),
};

const COLORS = {
  bull: "#17C995",
  bear: "#FF5470",
  accent: "#5B8DEF",
  accent2: "#F5A623",
  accent3: "#B980F0",
  grid: "#1B2130",
  axisText: "#545D70",
  textSecondary: "#8891A3",
  crosshair: "#3A4256",
};

/* STATE */
const state = {
  markets: [],              // full list of coins (top 100 by market cap)
  activeCoin: null,         // currently selected market object
  days: 30,                 // active timeframe
  candleStyle: "candle",    // candle | heikinashi | line | area | bars
  indicators: { sma20: false, ema50: false, bb: false, rsi: false, macd: false, vol: true },
  candles: [],               // [{t,o,h,l,c}]
  volumes: [],                // aligned volume per candle
  sort: "market_cap_desc",
  view: { offset: 0, count: 90 }, // visible window over candles
  hoverIndex: -1,
  isPanning: false,
  panStartX: 0,
  panStartOffset: 0,
};

let currentController = null; // AbortController for the active chart data fetch

/* API LAYER  (fetch + cache + cancellation) */
const cache = new Map();

async function apiGet(path, { signal } = {}) {
  if (cache.has(path)) return cache.get(path);
  const res = await fetch(`${API_BASE}${path}`, { signal });
  if (!res.ok) {
    throw new Error(`CoinGecko respondió ${res.status}`);
  }
  const data = await res.json();
  cache.set(path, data);
  return data;
}

async function fetchMarkets() {
  return apiGet(
    `/coins/markets?vs_currency=${VS_CURRENCY}&order=market_cap_desc&per_page=${MARKETS_PAGE_SIZE}&page=1&sparkline=true&price_change_percentage=24h`
  );
}

async function fetchOhlc(id, days, signal) {
  return apiGet(`/coins/${id}/ohlc?vs_currency=${VS_CURRENCY}&days=${days}`, { signal });
}

async function fetchVolumeSeries(id, days, signal) {
  const data = await apiGet(`/coins/${id}/market_chart?vs_currency=${VS_CURRENCY}&days=${days}`, { signal });
  return data.total_volumes || [];
}

/* TECHNICAL INDICATORS (pure functions over close-price arrays) */
function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out[i] = seed;
      prev = seed;
    } else if (i >= period) {
      const v = values[i] * k + prev * (1 - k);
      out[i] = v;
      prev = v;
    }
  }
  return out;
}

function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (mid[i] == null) continue;
    const slice = values.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const variance = slice.reduce((a, v) => a + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, mid, lower };
}

function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) {
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  // signal = EMA(signalPeriod) of macdLine, computed only over the defined portion
  const firstValid = macdLine.findIndex((v) => v != null);
  const signalLine = new Array(values.length).fill(null);
  if (firstValid !== -1) {
    const compact = macdLine.slice(firstValid).map((v) => v);
    const sig = ema(compact, signalPeriod);
    sig.forEach((v, idx) => {
      if (v != null) signalLine[firstValid + idx] = v;
    });
  }
  const histogram = values.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null
  );
  return { macdLine, signalLine, histogram };
}

function computeHeikinAshi(candles) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.o + c.h + c.l + c.c) / 4;
    const haOpen = i === 0 ? (c.o + c.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    const haHigh = Math.max(c.h, haOpen, haClose);
    const haLow = Math.min(c.l, haOpen, haClose);
    out.push({ t: c.t, o: haOpen, h: haHigh, l: haLow, c: haClose });
  }
  return out;
}

/* Aggregate raw [timestamp, volume] points into one volume figure per candle */
function alignVolumeToCandles(candles, volumePoints) {
  if (!candles.length) return [];
  const bucketMs =
    candles.length > 1 ? candles[1].t - candles[0].t : 24 * 60 * 60 * 1000;
  const result = new Array(candles.length).fill(0);
  let vi = 0;
  for (let i = 0; i < candles.length; i++) {
    const bucketEnd = candles[i].t + bucketMs / 2;
    const bucketStart = candles[i].t - bucketMs / 2;
    while (vi < volumePoints.length && volumePoints[vi][0] < bucketStart) vi++;
    let sum = 0, count = 0, cursor = vi;
    while (cursor < volumePoints.length && volumePoints[cursor][0] < bucketEnd) {
      sum += volumePoints[cursor][1];
      count++;
      cursor++;
    }
    result[i] = count ? sum / count === sum ? sum : sum : sum; // aggregate sum in-bucket
    if (count === 0 && volumePoints[vi]) result[i] = volumePoints[vi][1];
  }
  return result;
}

/* FORMATTING HELPERS */
function fmtPrice(v) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1000) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return "$" + v.toFixed(2);
  if (v >= 0.01) return "$" + v.toFixed(4);
  return "$" + v.toFixed(6);
}
function fmtCompact(v) {
  if (v == null || isNaN(v)) return "—";
  return "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}
function fmtAxisPrice(v) {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}
function fmtDate(ts, days) {
  const d = new Date(ts);
  if (days <= 1) return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (days <= 90) return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  return d.toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
}

/* CANVAS SETUP */
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* CHART ENGINE */
const PANE_MARGIN_RIGHT = 58;
const PANE_MARGIN_BOTTOM_AXIS = 20;

function getDisplayCandles() {
  return state.candleStyle === "heikinashi" ? computeHeikinAshi(state.candles) : state.candles;
}

function clampView() {
  const total = state.candles.length;
  if (total === 0) return;
  state.view.count = Math.max(15, Math.min(state.view.count, total));
  const maxOffset = Math.max(0, total - state.view.count);
  state.view.offset = Math.max(0, Math.min(state.view.offset, maxOffset));
}

function visibleIndices() {
  const total = state.candles.length;
  const start = state.view.offset;
  const end = Math.min(total, start + state.view.count);
  return { start, end };
}

function lastActivePane() {
  if (state.indicators.macd) return "macd";
  if (state.indicators.rsi) return "rsi";
  if (state.indicators.vol) return "vol";
  return "price";
}

function xForIndex(idx, start, count, plotWidth) {
  const slot = plotWidth / count;
  return (idx - start) * slot + slot / 2;
}

function drawTimeAxis(ctx, w, h, start, end) {
  const displayCandles = getDisplayCandles();
  const count = end - start;
  const plotWidth = w - PANE_MARGIN_RIGHT;
  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.axisText;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textBaseline = "top";
  const labelEvery = Math.max(1, Math.ceil(count / 6));
  for (let i = start; i < end; i += labelEvery) {
    const x = xForIndex(i, start, count, plotWidth);
    ctx.beginPath();
    ctx.moveTo(x, h - PANE_MARGIN_BOTTOM_AXIS);
    ctx.lineTo(x, h - PANE_MARGIN_BOTTOM_AXIS + 4);
    ctx.stroke();
    const label = fmtDate(displayCandles[i].t, state.days);
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, Math.min(Math.max(x - tw / 2, 2), plotWidth - tw - 2), h - PANE_MARGIN_BOTTOM_AXIS + 6);
  }
  ctx.restore();
}

function drawPriceAxis(ctx, w, h, min, max, topPad, bottomPad, formatFn) {
  const plotTop = topPad;
  const plotBottom = h - bottomPad;
  const steps = 5;
  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.axisText;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= steps; i++) {
    const v = max - (i / steps) * (max - min);
    const y = plotTop + (i / steps) * (plotBottom - plotTop);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w - PANE_MARGIN_RIGHT, y);
    ctx.stroke();
    ctx.fillText(formatFn(v), w - PANE_MARGIN_RIGHT + 7, y);
  }
  ctx.restore();
}

function priceToY(price, min, max, top, bottom) {
  if (max === min) return (top + bottom) / 2;
  return bottom - ((price - min) / (max - min)) * (bottom - top);
}

/* Price pane (candles / line / area / bars + overlays) */
let indicatorCache = null; // recomputed whenever candles/style changes

function recomputeIndicators() {
  const closes = state.candles.map((c) => c.c);
  indicatorCache = {
    sma20: sma(closes, 20),
    ema50: ema(closes, 50),
    bb: bollinger(closes, 20, 2),
    rsi: rsi(closes, 14),
    macd: macd(closes, 12, 26, 9),
  };
}

function drawPricePane() {
  const { ctx, w, h } = fitCanvas(DOM.priceCanvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.candles.length) return;

  clampView();
  const { start, end } = visibleIndices();
  const count = end - start;
  const displayCandles = getDisplayCandles();
  const plotWidth = w - PANE_MARGIN_RIGHT;
  const topPad = 14;
  const bottomPad = lastActivePane() === "price" ? PANE_MARGIN_BOTTOM_AXIS : 8;

  // compute min/max across visible candles + active overlays
  let min = Infinity, max = -Infinity;
  for (let i = start; i < end; i++) {
    min = Math.min(min, displayCandles[i].l);
    max = Math.max(max, displayCandles[i].h);
    if (state.indicators.sma20 && indicatorCache.sma20[i] != null) {
      min = Math.min(min, indicatorCache.sma20[i]);
      max = Math.max(max, indicatorCache.sma20[i]);
    }
    if (state.indicators.ema50 && indicatorCache.ema50[i] != null) {
      min = Math.min(min, indicatorCache.ema50[i]);
      max = Math.max(max, indicatorCache.ema50[i]);
    }
    if (state.indicators.bb && indicatorCache.bb.upper[i] != null) {
      min = Math.min(min, indicatorCache.bb.lower[i]);
      max = Math.max(max, indicatorCache.bb.upper[i]);
    }
  }
  if (!isFinite(min) || !isFinite(max)) return;
  const pad = (max - min) * 0.08 || max * 0.01 || 1;
  min -= pad;
  max += pad;

  const top = topPad, bottom = h - bottomPad;
  const y = (price) => priceToY(price, min, max, top, bottom);

  // grid + price axis
  drawPriceAxis(ctx, w, h, min, max, top, h - bottom, fmtAxisPrice);
  if (lastActivePane() === "price") drawTimeAxis(ctx, w, h, start, end);

  const slot = plotWidth / count;

  if (state.candleStyle === "line" || state.candleStyle === "area") {
    ctx.save();
    // build the line-only path first so the stroke never includes the fill's closing edges
    const linePath = new Path2D();
    for (let i = start; i < end; i++) {
      const x = xForIndex(i, start, count, plotWidth);
      const py = y(displayCandles[i].c);
      if (i === start) linePath.moveTo(x, py); else linePath.lineTo(x, py);
    }
    if (state.candleStyle === "area") {
      const fillPath = new Path2D(linePath);
      const lastX = xForIndex(end - 1, start, count, plotWidth);
      const firstX = xForIndex(start, start, count, plotWidth);
      fillPath.lineTo(lastX, bottom);
      fillPath.lineTo(firstX, bottom);
      fillPath.closePath();
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, "rgba(91,141,239,0.35)");
      grad.addColorStop(1, "rgba(91,141,239,0.02)");
      ctx.fillStyle = grad;
      ctx.fill(fillPath);
    }
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.stroke(linePath);
    ctx.restore();
  } else if (state.candleStyle === "bars") {
    ctx.save();
    ctx.lineWidth = 1.4;
    for (let i = start; i < end; i++) {
      const c = displayCandles[i];
      const bull = c.c >= c.o;
      ctx.strokeStyle = bull ? COLORS.bull : COLORS.bear;
      const x = xForIndex(i, start, count, plotWidth);
      const tick = Math.max(3, slot * 0.28);
      ctx.beginPath();
      ctx.moveTo(x, y(c.h));
      ctx.lineTo(x, y(c.l));
      ctx.moveTo(x - tick, y(c.o));
      ctx.lineTo(x, y(c.o));
      ctx.moveTo(x, y(c.c));
      ctx.lineTo(x + tick, y(c.c));
      ctx.stroke();
    }
    ctx.restore();
  } else {
    // candlestick (default) / heikin-ashi share rendering
    const bodyW = Math.max(1.5, slot * 0.62);
    for (let i = start; i < end; i++) {
      const c = displayCandles[i];
      const bull = c.c >= c.o;
      const x = xForIndex(i, start, count, plotWidth);
      ctx.strokeStyle = bull ? COLORS.bull : COLORS.bear;
      ctx.fillStyle = bull ? COLORS.bull : COLORS.bear;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y(c.h));
      ctx.lineTo(x, y(c.l));
      ctx.stroke();
      const yOpen = y(c.o), yClose = y(c.c);
      const top2 = Math.min(yOpen, yClose);
      const bh = Math.max(1, Math.abs(yClose - yOpen));
      ctx.fillRect(x - bodyW / 2, top2, bodyW, bh);
    }
  }

  // overlays
  function drawLine(arr, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (let i = start; i < end; i++) {
      if (arr[i] == null) continue;
      const x = xForIndex(i, start, count, plotWidth);
      const py = y(arr[i]);
      if (!started) { ctx.moveTo(x, py); started = true; } else ctx.lineTo(x, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (state.indicators.bb) {
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let i = start; i < end; i++) {
      if (indicatorCache.bb.upper[i] == null) continue;
      const x = xForIndex(i, start, count, plotWidth);
      const py = y(indicatorCache.bb.upper[i]);
      if (!started) { ctx.moveTo(x, py); started = true; } else ctx.lineTo(x, py);
    }
    for (let i = end - 1; i >= start; i--) {
      if (indicatorCache.bb.lower[i] == null) continue;
      const x = xForIndex(i, start, count, plotWidth);
      ctx.lineTo(x, y(indicatorCache.bb.lower[i]));
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(185,128,240,0.08)";
    ctx.fill();
    ctx.restore();
    drawLine(indicatorCache.bb.upper, "rgba(185,128,240,0.55)");
    drawLine(indicatorCache.bb.lower, "rgba(185,128,240,0.55)");
    drawLine(indicatorCache.bb.mid, COLORS.accent3);
  }
  if (state.indicators.sma20) drawLine(indicatorCache.sma20, COLORS.accent2);
  if (state.indicators.ema50) drawLine(indicatorCache.ema50, COLORS.accent);

  // stash geometry for crosshair / other panes
  state._geom = { start, end, count, plotWidth, w, h, top, bottom, min, max, slot };
}

/* Volume pane */
function drawVolumePane() {
  if (!state.indicators.vol) return;
  const { ctx, w, h } = fitCanvas(DOM.volumeCanvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.candles.length || !state._geom) return;
  const { start, end, count, plotWidth } = state._geom;
  const topPad = 6, bottomPad = lastActivePane() === "vol" ? PANE_MARGIN_BOTTOM_AXIS : 4;
  const max = Math.max(...state.volumes.slice(start, end), 1);
  const top = topPad, bottom = h - bottomPad;
  drawPriceAxis(ctx, w, h, 0, max, top, h - bottom, fmtCompact);
  if (lastActivePane() === "vol") drawTimeAxis(ctx, w, h, start, end);

  const slot = plotWidth / count;
  const bodyW = Math.max(1, slot * 0.6);
  const displayCandles = getDisplayCandles();
  for (let i = start; i < end; i++) {
    const v = state.volumes[i] || 0;
    const x = xForIndex(i, start, count, plotWidth);
    const barH = (v / max) * (bottom - top);
    const bull = displayCandles[i].c >= displayCandles[i].o;
    ctx.fillStyle = bull ? "rgba(23,201,149,0.55)" : "rgba(255,84,112,0.55)";
    ctx.fillRect(x - bodyW / 2, bottom - barH, bodyW, barH);
  }
}

/* RSI pane */
function drawRsiPane() {
  if (!state.indicators.rsi) return;
  const { ctx, w, h } = fitCanvas(DOM.rsiCanvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.candles.length || !state._geom) return;
  const { start, end, count, plotWidth } = state._geom;
  const topPad = 10, bottomPad = lastActivePane() === "rsi" ? PANE_MARGIN_BOTTOM_AXIS : 6;
  const top = topPad, bottom = h - bottomPad;
  drawPriceAxis(ctx, w, h, 0, 100, top, h - bottom, (v) => v.toFixed(0));
  if (lastActivePane() === "rsi") drawTimeAxis(ctx, w, h, start, end);

  const y = (v) => priceToY(v, 0, 100, top, bottom);
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = "rgba(255,84,112,0.4)";
  ctx.beginPath(); ctx.moveTo(0, y(70)); ctx.lineTo(plotWidth, y(70)); ctx.stroke();
  ctx.strokeStyle = "rgba(23,201,149,0.4)";
  ctx.beginPath(); ctx.moveTo(0, y(30)); ctx.lineTo(plotWidth, y(30)); ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = COLORS.accent3;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  let started = false;
  for (let i = start; i < end; i++) {
    const v = indicatorCache.rsi[i];
    if (v == null) continue;
    const x = xForIndex(i, start, count, plotWidth);
    const py = y(v);
    if (!started) { ctx.moveTo(x, py); started = true; } else ctx.lineTo(x, py);
  }
  ctx.stroke();
  ctx.restore();
}

/* MACD pane */
function drawMacdPane() {
  if (!state.indicators.macd) return;
  const { ctx, w, h } = fitCanvas(DOM.macdCanvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.candles.length || !state._geom) return;
  const { start, end, count, plotWidth } = state._geom;
  const topPad = 10, bottomPad = lastActivePane() === "macd" ? PANE_MARGIN_BOTTOM_AXIS : 6;
  const top = topPad, bottom = h - bottomPad;

  const { macdLine, signalLine, histogram } = indicatorCache.macd;
  let min = 0, max = 0;
  for (let i = start; i < end; i++) {
    [macdLine[i], signalLine[i], histogram[i]].forEach((v) => {
      if (v != null) { min = Math.min(min, v); max = Math.max(max, v); }
    });
  }
  if (min === max) { min -= 1; max += 1; }
  const padv = (max - min) * 0.15;
  min -= padv; max += padv;

  drawPriceAxis(ctx, w, h, min, max, top, h - bottom, (v) => v.toFixed(2));
  if (lastActivePane() === "macd") drawTimeAxis(ctx, w, h, start, end);

  const y = (v) => priceToY(v, min, max, top, bottom);
  const zeroY = y(0);
  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(plotWidth, zeroY); ctx.stroke();
  ctx.restore();

  const slot = plotWidth / count;
  const bodyW = Math.max(1, slot * 0.5);
  for (let i = start; i < end; i++) {
    const v = histogram[i];
    if (v == null) continue;
    const x = xForIndex(i, start, count, plotWidth);
    const py = y(v);
    ctx.fillStyle = v >= 0 ? "rgba(23,201,149,0.5)" : "rgba(255,84,112,0.5)";
    ctx.fillRect(x - bodyW / 2, Math.min(py, zeroY), bodyW, Math.abs(py - zeroY) || 1);
  }

  function line(arr, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    let started = false;
    for (let i = start; i < end; i++) {
      if (arr[i] == null) continue;
      const x = xForIndex(i, start, count, plotWidth);
      const py = y(arr[i]);
      if (!started) { ctx.moveTo(x, py); started = true; } else ctx.lineTo(x, py);
    }
    ctx.stroke();
    ctx.restore();
  }
  line(macdLine, COLORS.accent);
  line(signalLine, COLORS.accent2);
}

function renderAll() {
  if (!state.candles.length) return;
  drawPricePane();
  drawVolumePane();
  drawRsiPane();
  drawMacdPane();
  hideCrosshair();
}

/* CROSSHAIR */
function setupCrosshair() {
  const canvases = [
    { el: DOM.priceCanvas, pane: DOM.panePrice },
    { el: DOM.volumeCanvas, pane: DOM.paneVolume },
    { el: DOM.rsiCanvas, pane: DOM.paneRsi },
    { el: DOM.macdCanvas, pane: DOM.paneMacd },
  ];

  canvases.forEach(({ el }) => {
    el.addEventListener("mousemove", onCrosshairMove);
    el.addEventListener("mouseleave", hideCrosshair);
    el.addEventListener("mousedown", onPanStart);
    el.addEventListener("wheel", onWheelZoom, { passive: false });
  });
  window.addEventListener("mousemove", onPanMove);
  window.addEventListener("mouseup", onPanEnd);
}

function onCrosshairMove(e) {
  if (!state._geom || !state.candles.length) return;
  if (state.isPanning) return;
  const rect = e.target.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const { start, count, plotWidth } = state._geom;
  const slot = plotWidth / count;
  let idx = start + Math.floor(x / slot);
  idx = Math.max(0, Math.min(state.candles.length - 1, idx));
  state.hoverIndex = idx;
  drawOverlayCrosshair(e, idx);
}

function hideCrosshair() {
  state.hoverIndex = -1;
  const { ctx, w, h } = fitCanvas(DOM.priceOverlay);
  ctx.clearRect(0, 0, w, h);
  DOM.crosshairTooltip.hidden = true;
}

function drawOverlayCrosshair(e, idx) {
  const { ctx, w, h } = fitCanvas(DOM.priceOverlay);
  ctx.clearRect(0, 0, w, h);
  if (!state._geom) return;
  const { start, count, plotWidth, top, bottom, min, max } = state._geom;
  const displayCandles = getDisplayCandles();
  const c = displayCandles[idx];
  const x = xForIndex(idx, start, count, plotWidth);
  const yPrice = priceToY(c.c, min, max, top, bottom);

  ctx.save();
  ctx.strokeStyle = COLORS.crosshair;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0); ctx.lineTo(x, h);
  ctx.moveTo(0, yPrice); ctx.lineTo(plotWidth, yPrice);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#0A0D14";
  ctx.strokeStyle = COLORS.accent;
  ctx.beginPath();
  ctx.arc(x, yPrice, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const raw = state.candles[idx];
  const bull = raw.c >= raw.o;
  const changePct = ((raw.c - raw.o) / raw.o) * 100;
  const tooltip = DOM.crosshairTooltip;
  tooltip.hidden = false;
  tooltip.innerHTML = `
    <div><b>${fmtDate(raw.t, state.days)}</b></div>
    <div>Apertura&nbsp; <b>${fmtPrice(raw.o)}</b></div>
    <div>Máximo&nbsp;&nbsp; <b>${fmtPrice(raw.h)}</b></div>
    <div>Mínimo&nbsp;&nbsp; <b>${fmtPrice(raw.l)}</b></div>
    <div>Cierre&nbsp;&nbsp;&nbsp; <b class="${bull ? "ch-up" : "ch-down"}">${fmtPrice(raw.c)}</b></div>
    <div class="${bull ? "ch-up" : "ch-down"}">${fmtPct(changePct)}</div>
  `;
  const stageRect = DOM.chartStage.getBoundingClientRect();
  const paneRect = DOM.panePrice.getBoundingClientRect();
  let left = paneRect.left - stageRect.left + x + 14;
  let top2 = paneRect.top - stageRect.top + 10;
  if (left + 160 > stageRect.width) left = paneRect.left - stageRect.left + x - 170;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top2}px`;
}

function onWheelZoom(e) {
  if (!state.candles.length) return;
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  zoom(dir);
}
function zoom(dir) {
  const factor = dir > 0 ? 1.15 : 0.87;
  const total = state.candles.length;
  const newCount = Math.round(state.view.count * factor);
  const center = state.view.offset + state.view.count / 2;
  state.view.count = Math.max(15, Math.min(total, newCount));
  state.view.offset = Math.round(center - state.view.count / 2);
  clampView();
  renderAll();
}

function onPanStart(e) {
  state.isPanning = true;
  state.panStartX = e.clientX;
  state.panStartOffset = state.view.offset;
}
function onPanMove(e) {
  if (!state.isPanning || !state._geom) return;
  const dx = e.clientX - state.panStartX;
  const slot = state._geom.plotWidth / state._geom.count;
  const deltaCandles = Math.round(-dx / slot);
  state.view.offset = state.panStartOffset + deltaCandles;
  clampView();
  renderAll();
}
function onPanEnd() {
  state.isPanning = false;
}

window.addEventListener("resize", () => {
  clearTimeout(window.__resizeT);
  window.__resizeT = setTimeout(renderAll, 80);
});

/* UI — asset header / stats */
function updateAssetHeader(market) {
  DOM.assetIcon.src = market.image;
  DOM.assetIcon.alt = market.name;
  DOM.assetName.textContent = market.name;
  DOM.assetSymbol.textContent = market.symbol.toUpperCase();
  DOM.assetRank.textContent = market.market_cap_rank ? `#${market.market_cap_rank}` : "";
  DOM.assetPrice.textContent = fmtPrice(market.current_price);
  const chg = market.price_change_percentage_24h;
  DOM.assetChange.textContent = fmtPct(chg);
  DOM.assetChange.className = "asset-change " + (chg >= 0 ? "is-up" : "is-down");
  DOM.statHigh.textContent = fmtPrice(market.high_24h);
  DOM.statLow.textContent = fmtPrice(market.low_24h);
  DOM.statVol.textContent = fmtCompact(market.total_volume);
  DOM.statCap.textContent = fmtCompact(market.market_cap);
  document.title = `${fmtPrice(market.current_price)} · ${market.symbol.toUpperCase()} — Vertex`;
}

/* WATCHLIST */
function renderSparkline(canvas, prices, bull) {
  const dpr = window.devicePixelRatio || 1;
  const w = 56, h = 28;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!prices || prices.length < 2) return;
  const min = Math.min(...prices), max = Math.max(...prices);
  ctx.beginPath();
  prices.forEach((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / (max - min || 1)) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = bull ? COLORS.bull : COLORS.bear;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function getSortedMarkets() {
  const arr = [...state.markets];
  switch (state.sort) {
    case "change_desc":
      arr.sort((a, b) => (b.price_change_percentage_24h ?? -Infinity) - (a.price_change_percentage_24h ?? -Infinity));
      break;
    case "change_asc":
      arr.sort((a, b) => (a.price_change_percentage_24h ?? Infinity) - (b.price_change_percentage_24h ?? Infinity));
      break;
    default:
      arr.sort((a, b) => a.market_cap_rank - b.market_cap_rank);
  }
  return arr;
}

function renderWatchlist() {
  const list = getSortedMarkets();
  DOM.watchlistCount.textContent = list.length;
  DOM.watchlistList.innerHTML = "";
  const frag = document.createDocumentFragment();
  list.forEach((m) => {
    const row = document.createElement("div");
    row.className = "wl-row" + (state.activeCoin && state.activeCoin.id === m.id ? " is-active" : "");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    const chg = m.price_change_percentage_24h;
    const bull = chg >= 0;
    row.innerHTML = `
      <img src="${m.image}" alt="" loading="lazy">
      <div class="wl-row__mid">
        <div class="row-name">${m.name}</div>
        <div class="row-symbol">${m.symbol}</div>
      </div>
      <canvas class="wl-row__spark"></canvas>
      <div class="wl-row__right">
        <div class="row-price">${fmtPrice(m.current_price)}</div>
        <div class="row-change ${bull ? "is-up" : "is-down"}">${fmtPct(chg)}</div>
      </div>
    `;
    const sparkCanvas = row.querySelector(".wl-row__spark");
    const prices = m.sparkline_in_7d && m.sparkline_in_7d.price;
    requestAnimationFrame(() => renderSparkline(sparkCanvas, prices, bull));
    row.addEventListener("click", () => selectCoin(m));
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") selectCoin(m); });
    frag.appendChild(row);
  });
  DOM.watchlistList.appendChild(frag);
}

/* SEARCH */
function setupSearch() {
  DOM.searchInput.addEventListener("input", () => {
    const q = DOM.searchInput.value.trim().toLowerCase();
    if (!q) { DOM.searchResults.hidden = true; return; }
    const matches = state.markets
      .filter((m) => m.name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q))
      .slice(0, 8);
    DOM.searchResults.innerHTML = "";
    if (!matches.length) {
      DOM.searchResults.innerHTML = `<div class="search-empty">Sin resultados para “${q}”</div>`;
    } else {
      matches.forEach((m) => {
        const item = document.createElement("div");
        item.className = "search-result-item";
        item.innerHTML = `<img src="${m.image}" alt=""><span class="sr-name">${m.name}</span><span class="sr-symbol">${m.symbol}</span>`;
        item.addEventListener("click", () => {
          selectCoin(m);
          DOM.searchInput.value = "";
          DOM.searchResults.hidden = true;
        });
        DOM.searchResults.appendChild(item);
      });
    }
    DOM.searchResults.hidden = false;
  });
  document.addEventListener("click", (e) => {
    if (!DOM.searchResults.contains(e.target) && e.target !== DOM.searchInput) {
      DOM.searchResults.hidden = true;
    }
  });
}

/* TOOLBAR WIRING */
function setupToolbar() {
  DOM.timeframeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".tf-btn");
    if (!btn) return;
    [...DOM.timeframeGroup.children].forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    state.days = Number(btn.dataset.days);
    loadCoinData();
  });

  function toggleDropdown(trigger, menu) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains("is-open");
      document.querySelectorAll(".dd-menu.is-open").forEach((m) => m.classList.remove("is-open"));
      if (!isOpen) menu.classList.add("is-open");
    });
  }
  toggleDropdown(DOM.candleTrigger, DOM.candleMenu);
  toggleDropdown(DOM.indicatorTrigger, DOM.indicatorMenu);
  document.addEventListener("click", () => {
    document.querySelectorAll(".dd-menu.is-open").forEach((m) => m.classList.remove("is-open"));
  });

  DOM.candleMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".dd-item");
    if (!item) return;
    [...DOM.candleMenu.children].forEach((c) => c.classList.remove("is-active"));
    item.classList.add("is-active");
    state.candleStyle = item.dataset.style;
    DOM.candleLabel.textContent = item.textContent;
    renderAll();
  });

  DOM.indicatorMenu.addEventListener("click", (e) => e.stopPropagation());
  DOM.indicatorMenu.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = state.indicators[cb.dataset.ind];
    cb.addEventListener("change", () => {
      state.indicators[cb.dataset.ind] = cb.checked;
      applyPaneVisibility();
      updateIndicatorCount();
      renderAll();
    });
  });
  updateIndicatorCount();

  DOM.zoomInBtn.addEventListener("click", () => zoom(-1));
  DOM.zoomOutBtn.addEventListener("click", () => zoom(1));
  DOM.resetBtn.addEventListener("click", () => {
    state.view.offset = Math.max(0, state.candles.length - 90);
    state.view.count = Math.min(90, state.candles.length);
    renderAll();
  });

  DOM.chartRetryBtn.addEventListener("click", loadCoinData);
}

function updateIndicatorCount() {
  const activeOverlaysAndPanes = ["sma20", "ema50", "bb", "rsi", "macd"].filter((k) => state.indicators[k]).length;
  DOM.indicatorCount.hidden = activeOverlaysAndPanes === 0;
  DOM.indicatorCount.textContent = activeOverlaysAndPanes;
}

function applyPaneVisibility() {
  DOM.paneVolume.hidden = !state.indicators.vol;
  DOM.paneRsi.hidden = !state.indicators.rsi;
  DOM.paneMacd.hidden = !state.indicators.macd;
}

/* DATA LOADING */
function setLoading(isLoading) {
  DOM.chartLoading.hidden = !isLoading;
  if (isLoading) DOM.chartError.hidden = true;
}
function setError(msg) {
  DOM.chartError.hidden = false;
  DOM.chartErrorText.textContent = msg || "No se han podido cargar los datos.";
  DOM.chartLoading.hidden = true;
}

async function loadCoinData() {
  if (!state.activeCoin) return;
  if (currentController) currentController.abort();
  currentController = new AbortController();
  const { signal } = currentController;
  setLoading(true);
  try {
    const [ohlc, volumePoints] = await Promise.all([
      fetchOhlc(state.activeCoin.id, state.days, signal),
      fetchVolumeSeries(state.activeCoin.id, state.days, signal),
    ]);
    if (signal.aborted) return;
    state.candles = ohlc.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
    state.volumes = alignVolumeToCandles(state.candles, volumePoints);
    state.view.count = Math.min(90, state.candles.length);
    state.view.offset = Math.max(0, state.candles.length - state.view.count);
    recomputeIndicators();
    applyPaneVisibility();
    setLoading(false);
    renderAll();
    DOM.statusText.textContent = "En directo";
  } catch (err) {
    if (err.name === "AbortError") return; // expected: superseded by a newer request
    console.error("No se pudieron cargar los datos del gráfico:", err);
    setError("No se han podido cargar los datos de mercado. Puede que se haya alcanzado el límite de peticiones de la API pública.");
  }
}

function selectCoin(market) {
  state.activeCoin = market;
  updateAssetHeader(market);
  renderWatchlist();
  loadCoinData();
}

/* BOOTSTRAP */
async function init() {
  setupToolbar();
  setupCrosshair();
  setupSearch();
  applyPaneVisibility();

  DOM.watchlistList.innerHTML = Array.from({ length: 10 })
    .map(() => '<div class="wl-skeleton"></div>')
    .join("");

  document.querySelectorAll(".watchlist__sort .sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".watchlist__sort .sort-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.sort = btn.dataset.sort;
      renderWatchlist();
    });
  });

  try {
    DOM.statusText.textContent = "Cargando mercados…";
    state.markets = await fetchMarkets();
    DOM.statusText.textContent = "En directo";
    renderWatchlist();
    const bitcoin = state.markets.find((m) => m.id === "bitcoin") || state.markets[0];
    selectCoin(bitcoin);
  } catch (err) {
    console.error(err);
    DOM.statusText.textContent = "Error de conexión";
    setError("No se ha podido conectar con la API de CoinGecko. Comprueba tu conexión o inténtalo de nuevo en unos minutos.");
    DOM.watchlistList.innerHTML = '<div class="search-empty">No se pudieron cargar los mercados.</div>';
  }
}

init();