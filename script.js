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

  performanceGrid: document.getElementById("performanceGrid"),
  performanceCoinName: document.getElementById("performanceCoinName"),
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
  // vertical scale applied to each pane's value axis — adjusted by dragging
  // the right-hand axis (price / indicator numbers) up (zoom in) or down (zoom out)
  paneScale: { price: 1, volume: 1, rsi: 1, macd: 1 },
  // vertical pan applied to each pane, as a fraction of its current visible range —
  // adjusted by dragging inside the plot area (up/down), independent of horizontal pan
  paneOffset: { price: 0, volume: 0, rsi: 0, macd: 0 },
  paneGeom: {}, // last-rendered {top,bottom} pixel bounds per pane, used to convert drag px -> offset fraction
  axisDrag: { active: false, pane: null, startY: 0, startScale: 1, pointerId: null },
  vPan: { active: false, pane: null, startY: 0, startOffset: 0, rangePx: 1 },
  pointers: new Map(), // active pointers, for touch pan + pinch-to-zoom
  pinch: { active: false, startDist: 0, startCount: 90 },
};

const SCALE_MIN = 0.35;
const SCALE_MAX = 4;

function clampScale(v) {
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, v));
}

function resetPaneAdjustments() {
  state.paneScale = { price: 1, volume: 1, rsi: 1, macd: 1 };
  state.paneOffset = { price: 0, volume: 0, rsi: 0, macd: 0 };
}

/* Rescale a [min,max] value range around a fixed anchor.
   anchor "center" keeps the midpoint fixed (price / RSI / MACD panes);
   anchor "zero" keeps the baseline fixed at 0 (volume bars grow from the bottom). */
function applyPaneScale(min, max, scale, anchor) {
  if (!scale || scale === 1) return { min, max };
  if (anchor === "zero") {
    return { min, max: min + (max - min) / scale };
  }
  const center = (min + max) / 2;
  const half = (max - min) / 2 / scale;
  return { min: center - half, max: center + half };
}

/* Shift a [min,max] range by a fraction of its own size — this is what makes
   dragging inside the chart move the visible price/indicator window up or down. */
function applyPaneOffset(min, max, offsetFraction) {
  if (!offsetFraction) return { min, max };
  const shift = (max - min) * offsetFraction;
  return { min: min + shift, max: max + shift };
}

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

/* Full available price history for one coin (daily resolution) — used to compute
   the historical-performance cards (1S/1M/3M/6M/1A/3A/5A). Fetched once per coin,
   independent of the candlestick timeframe, so switching 1D/7D/30D/… doesn't refetch it.

   NOTE: CoinGecko's free/public API restricts market_chart to a maximum of ~365 days
   of history — "days=max" (and days > 365) returns 401 Unauthorized on that tier, which
   the browser also reports as a CORS error since the error response carries no
   Access-Control-Allow-Origin header. So we request the largest free-tier-safe window
   (365 days) instead; periods beyond that (3A/5A) are simply marked unavailable below. */
const MAX_FREE_HISTORY_DAYS = 365;

async function fetchFullHistory(id, signal) {
  const data = await apiGet(`/coins/${id}/market_chart?vs_currency=${VS_CURRENCY}&days=${MAX_FREE_HISTORY_DAYS}`, { signal });
  return data.prices || [];
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
  const availableH = Math.max(1, plotBottom - plotTop);
  const MIN_LABEL_GAP = 34; // px — keeps decimal numbers from crowding on short panes
  const steps = Math.max(2, Math.min(6, Math.floor(availableH / MIN_LABEL_GAP)));
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
  ({ min, max } = applyPaneScale(min, max, state.paneScale.price, "center"));
  ({ min, max } = applyPaneOffset(min, max, state.paneOffset.price));

  const top = topPad, bottom = h - bottomPad;
  state.paneGeom.price = { top, bottom };
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
  let max = Math.max(...state.volumes.slice(start, end), 1);
  let min = 0;
  ({ max } = applyPaneScale(0, max, state.paneScale.volume, "zero"));
  ({ min, max } = applyPaneOffset(min, max, state.paneOffset.volume));
  const top = topPad, bottom = h - bottomPad;
  state.paneGeom.volume = { top, bottom };
  drawPriceAxis(ctx, w, h, min, max, top, h - bottom, fmtCompact);
  if (lastActivePane() === "vol") drawTimeAxis(ctx, w, h, start, end);

  const slot = plotWidth / count;
  const bodyW = Math.max(1, slot * 0.6);
  const displayCandles = getDisplayCandles();
  const y = (v) => priceToY(v, min, max, top, bottom);
  const baseline = y(0);
  for (let i = start; i < end; i++) {
    const v = state.volumes[i] || 0;
    const x = xForIndex(i, start, count, plotWidth);
    const barY = y(v);
    const bull = displayCandles[i].c >= displayCandles[i].o;
    ctx.fillStyle = bull ? "rgba(23,201,149,0.55)" : "rgba(255,84,112,0.55)";
    ctx.fillRect(x - bodyW / 2, Math.min(barY, baseline), bodyW, Math.abs(baseline - barY) || 1);
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
  state.paneGeom.rsi = { top, bottom };
  let { min: rsiMin, max: rsiMax } = applyPaneScale(0, 100, state.paneScale.rsi, "center");
  ({ min: rsiMin, max: rsiMax } = applyPaneOffset(rsiMin, rsiMax, state.paneOffset.rsi));
  drawPriceAxis(ctx, w, h, rsiMin, rsiMax, top, h - bottom, (v) => v.toFixed(0));
  if (lastActivePane() === "rsi") drawTimeAxis(ctx, w, h, start, end);

  const y = (v) => priceToY(v, rsiMin, rsiMax, top, bottom);
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
  state.paneGeom.macd = { top, bottom };

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
  ({ min, max } = applyPaneScale(min, max, state.paneScale.macd, "center"));
  ({ min, max } = applyPaneOffset(min, max, state.paneOffset.macd));

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

/* Redraw a single pane — used while dragging its value axis so we don't pay
   the cost of re-measuring/redrawing every canvas on each pointermove. */
function renderPane(key) {
  if (!state.candles.length) return;
  if (key === "price") { drawPricePane(); return; }
  if (key === "volume") { drawVolumePane(); return; }
  if (key === "rsi") { drawRsiPane(); return; }
  if (key === "macd") { drawMacdPane(); return; }
}

/* CROSSHAIR, PAN, ZOOM & AXIS DRAG-TO-SCALE */
const AXIS_DRAG_SENSITIVITY = 140; // px of vertical drag needed to ~double/halve the scale

function setupCrosshair() {
  const panes = [
    { el: DOM.priceCanvas, key: "price" },
    { el: DOM.volumeCanvas, key: "volume" },
    { el: DOM.rsiCanvas, key: "rsi" },
    { el: DOM.macdCanvas, key: "macd" },
  ];

  panes.forEach(({ el, key }) => {
    el.style.touchAction = "none"; // we handle pan/zoom/scroll ourselves
    el.addEventListener("pointerdown", (e) => onPointerDown(e, key));
    el.addEventListener("pointermove", (e) => onPointerHover(e, key));
    el.addEventListener("pointerleave", () => { if (!state.isPanning && !state.axisDrag.active) hideCrosshair(); });
    el.addEventListener("dblclick", (e) => onAxisDoubleClick(e, key));
    el.addEventListener("wheel", onWheelZoom, { passive: false });
  });
  window.addEventListener("pointermove", onPointerMoveGlobal);
  window.addEventListener("pointerup", onPointerUpGlobal);
  window.addEventListener("pointercancel", onPointerUpGlobal);
}

function isInAxisZone(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  return x > rect.width - PANE_MARGIN_RIGHT;
}

function onPointerDown(e, key) {
  if (!state.candles.length) return;
  state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // two fingers down anywhere on a pane => start pinch-to-zoom (horizontal)
  if (state.pointers.size === 2) {
    state.axisDrag.active = false;
    state.isPanning = false;
    state.vPan.active = false;
    const pts = [...state.pointers.values()];
    state.pinch.active = true;
    state.pinch.startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    state.pinch.startCount = state.view.count;
    hideCrosshair();
    return;
  }

  if (isInAxisZone(e)) {
    // drag on the right-hand value axis (price or indicator numbers) to rescale it:
    // drag up = zoom in / enlarge, drag down = zoom out / shrink
    state.axisDrag.active = true;
    state.axisDrag.pane = key;
    state.axisDrag.startY = e.clientY;
    state.axisDrag.startScale = state.paneScale[key];
    state.axisDrag.pointerId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    hideCrosshair();
  } else {
    state.isPanning = true;
    state.panStartX = e.clientX;
    state.panStartOffset = state.view.offset;

    const geom = state.paneGeom[key];
    state.vPan.active = true;
    state.vPan.pane = key;
    state.vPan.startY = e.clientY;
    state.vPan.startOffset = state.paneOffset[key];
    state.vPan.rangePx = geom ? Math.max(1, geom.bottom - geom.top) : 1;
  }
}

function onPointerHover(e, key) {
  if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (state.axisDrag.active || state.isPanning || state.pinch.active) return;

  e.currentTarget.style.cursor = isInAxisZone(e) ? "ns-resize" : "crosshair";

  if (!state._geom || !state.candles.length) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const { start, count, plotWidth } = state._geom;
  const slot = plotWidth / count;
  let idx = start + Math.floor(x / slot);
  idx = Math.max(0, Math.min(state.candles.length - 1, idx));
  state.hoverIndex = idx;
  drawOverlayCrosshair(e, idx);
}

function onAxisDoubleClick(e, key) {
  if (!isInAxisZone(e)) return;
  state.paneScale[key] = 1;
  state.paneOffset[key] = 0;
  renderAll();
}

function onPointerMoveGlobal(e) {
  if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (state.pinch.active && state.pointers.size === 2) {
    const pts = [...state.pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const ratio = dist / state.pinch.startDist;
    const total = state.candles.length;
    const center = state.view.offset + state.view.count / 2;
    state.view.count = Math.max(15, Math.min(total, Math.round(state.pinch.startCount / ratio)));
    state.view.offset = Math.round(center - state.view.count / 2);
    clampView();
    renderAll();
    return;
  }

  if (state.axisDrag.active) {
    const delta = state.axisDrag.startY - e.clientY; // up = positive = zoom in
    const factor = Math.pow(2, delta / AXIS_DRAG_SENSITIVITY);
    state.paneScale[state.axisDrag.pane] = clampScale(state.axisDrag.startScale * factor);
    renderPane(state.axisDrag.pane);
    return;
  }

  if (state.isPanning && state._geom) {
    const dx = e.clientX - state.panStartX;
    const slot = state._geom.plotWidth / state._geom.count;
    const deltaCandles = Math.round(-dx / slot);
    state.view.offset = state.panStartOffset + deltaCandles;
    clampView();

    if (state.vPan.active) {
      const dy = e.clientY - state.vPan.startY;
      state.paneOffset[state.vPan.pane] = state.vPan.startOffset + dy / state.vPan.rangePx;
    }
    renderAll();
  }
}

function onPointerUpGlobal(e) {
  state.pointers.delete(e.pointerId);
  if (state.pointers.size < 2) state.pinch.active = false;
  if (state.axisDrag.pointerId === e.pointerId) {
    state.axisDrag.active = false;
    state.axisDrag.pointerId = null;
  }
  state.isPanning = false;
  state.vPan.active = false;
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
  if (left < 4) left = 4;
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

window.addEventListener("resize", () => {
  clearTimeout(window.__resizeT);
  window.__resizeT = setTimeout(() => {
    renderAll();
    if (lastPerformancePeriods.length) renderPerformance(lastPerformancePeriods);
  }, 80);
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
function renderSparkline(canvas, prices, bull, w = 56, h = 28) {
  const dpr = window.devicePixelRatio || 1;
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

/* HISTORICAL PERFORMANCE (1S / 1M / 3M / 6M / 1A / 3A / 5A) */
const PERFORMANCE_PERIODS = [
  { key: "7d", label: "1 SEMANA", days: 7 },
  { key: "1m", label: "1 MES", days: 30 },
  { key: "3m", label: "3 MESES", days: 90 },
  { key: "6m", label: "6 MESES", days: 180 },
  { key: "1y", label: "1 AÑO", days: 365 },
  { key: "3y", label: "3 AÑOS", days: 365 * 3 },
  { key: "5y", label: "5 AÑOS", days: 365 * 5 },
];

let performanceController = null;
let lastPerformancePeriods = [];

function computePerformancePeriods(pricePoints) {
  if (!pricePoints || pricePoints.length < 2) return [];
  const now = pricePoints[pricePoints.length - 1];
  const nowPrice = now[1];
  const oldestTs = pricePoints[0][0];

  return PERFORMANCE_PERIODS.map((period) => {
    // CoinGecko's free public API only gives us up to MAX_FREE_HISTORY_DAYS of
    // history (see fetchFullHistory) — periods beyond that can never be computed
    // here, regardless of how old the coin is, so we say so explicitly.
    if (period.days > MAX_FREE_HISTORY_DAYS) {
      return { ...period, available: false, reason: "plan-limit" };
    }

    const targetTs = now[0] - period.days * 86400000;
    if (targetTs < oldestTs) return { ...period, available: false, reason: "no-history" };

    // first point at or after the target timestamp
    let idx = pricePoints.findIndex((p) => p[0] >= targetTs);
    if (idx === -1) idx = 0;
    const pastPrice = pricePoints[idx][1];
    const pct = pastPrice ? ((nowPrice - pastPrice) / pastPrice) * 100 : null;
    const slice = pricePoints.slice(idx).map((p) => p[1]);
    return { ...period, available: pct != null, pct, sparkline: slice };
  });
}

async function loadPerformance(coinId) {
  if (performanceController) performanceController.abort();
  performanceController = new AbortController();
  const { signal } = performanceController;

  DOM.performanceCoinName.textContent = state.activeCoin ? state.activeCoin.name : "";
  DOM.performanceGrid.innerHTML = Array.from({ length: 7 })
    .map(() => '<div class="perf-card perf-card--skeleton"></div>')
    .join("");

  try {
    const prices = await fetchFullHistory(coinId, signal);
    if (signal.aborted) return;
    if (state.activeCoin && state.activeCoin.id !== coinId) return; // superseded by a newer selection
    renderPerformance(computePerformancePeriods(prices));
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("No se pudo cargar el rendimiento histórico:", err);
    DOM.performanceGrid.innerHTML = '<div class="perf-empty">No se pudo cargar el rendimiento histórico.</div>';
  }
}

function renderPerformance(periods) {
  lastPerformancePeriods = periods;
  DOM.performanceGrid.innerHTML = "";
  if (!periods.length) {
    DOM.performanceGrid.innerHTML = '<div class="perf-empty">Sin histórico suficiente para este activo.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  periods.forEach((p) => {
    const card = document.createElement("div");
    card.className = "perf-card";
    if (!p.available) {
      card.classList.add("perf-card--empty");
      const note = p.reason === "plan-limit" ? "requiere API de pago" : "sin histórico";
      card.innerHTML = `
        <div class="perf-card__label">${p.label}</div>
        <div class="perf-card__pct perf-card__pct--empty">N/D</div>
        <div class="perf-card__note">${note}</div>
      `;
      frag.appendChild(card);
      return;
    }
    const bull = p.pct >= 0;
    card.innerHTML = `
      <div class="perf-card__label">${p.label}</div>
      <div class="perf-card__pct ${bull ? "is-up" : "is-down"}">${fmtPct(p.pct)}</div>
      <canvas class="perf-card__spark"></canvas>
    `;
    const canvas = card.querySelector(".perf-card__spark");
    requestAnimationFrame(() => {
      const rect = canvas.getBoundingClientRect();
      renderSparkline(canvas, p.sparkline, bull, Math.max(40, Math.round(rect.width)), Math.max(24, Math.round(rect.height)));
    });
    frag.appendChild(card);
  });
  DOM.performanceGrid.appendChild(frag);
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
    state.paneScale = { price: 1, volume: 1, rsi: 1, macd: 1 };
    state.paneOffset = { price: 0, volume: 0, rsi: 0, macd: 0 };
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
    DOM.statusText.textContent = "en directo";
  } catch (err) {
    if (err.name === "AbortError") return; // expected: superseded by a newer request
    console.error("No se pudieron cargar los datos del gráfico:", err);
    setError("No se han podido cargar los datos de mercado. Puede que se haya alcanzado el límite de peticiones de la API pública.");
  }
}

function selectCoin(market) {
  state.activeCoin = market;
  state.paneScale = { price: 1, volume: 1, rsi: 1, macd: 1 };
  state.paneOffset = { price: 0, volume: 0, rsi: 0, macd: 0 };
  updateAssetHeader(market);
  renderWatchlist();
  loadCoinData();
  loadPerformance(market.id);
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
    DOM.statusText.textContent = "cargando mercados…";
    state.markets = await fetchMarkets();
    DOM.statusText.textContent = "en directo";
    renderWatchlist();
    const bitcoin = state.markets.find((m) => m.id === "bitcoin") || state.markets[0];
    selectCoin(bitcoin);
  } catch (err) {
    console.error(err);
    DOM.statusText.textContent = "error de conexión";
    setError("No se ha podido conectar con la API de CoinGecko. Comprueba tu conexión o inténtalo de nuevo en unos minutos.");
    DOM.watchlistList.innerHTML = '<div class="search-empty">No se pudieron cargar los mercados.</div>';
  }
}

init();