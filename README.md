# Vertex — Crypto Market Terminal
Terminal de mercado de criptomonedas con estética de trading profesional (estilo TradingView), construido como pieza de portfolio. Todo el motor de gráficos está escrito a mano en **Canvas 2D con JavaScript vanilla** — sin librerías de charting de terceros.

**Demo en vivo:** https://Onyx2006.github.io/CryptoApp

![Vertex screenshot](docs/screenshot.png)

## Características
- **Gráfico de velas real** dibujado desde cero sobre `<canvas>`, con 5 estilos intercambiables:
  velas japonesas, Heikin-Ashi, línea, área y barras OHLC.
- **Indicadores técnicos** calculados manualmente (sin librerías):
  - Media móvil simple (SMA 20)
  - Media móvil exponencial (EMA 50)
  - Bandas de Bollinger (20, 2σ)
  - RSI (14) en panel independiente
  - MACD (12, 26, 9) con histograma, en panel independiente
  - Volumen agregado por vela
- **Crosshair interactivo** sincronizado entre todos los paneles, con tooltip de OHLC y variación %.
- **Zoom (rueda del ratón o pellizco con dos dedos en táctil) y pan** (arrastrar) sobre el histórico de velas.
- **Escala de eje ajustable**: pincha y arrastra verticalmente sobre el eje derecho (donde aparecen
  los números) de cualquier panel —precio, volumen, RSI o MACD— para agrandar o comprimir esa escala.
  Arriba amplía, abajo aleja. Doble clic la restablece. Funciona igual con ratón y con el dedo.
- **5 marcos temporales**: 1D, 7D, 30D, 90D, 1A.
- **Watchlist en vivo** de los 100 principales activos por capitalización, con sparklines de 7 días,
  ordenación (cap. mercado / ganadores / perdedores) y buscador instantáneo.
- **Totalmente responsive**, con interacciones táctiles nativas (Pointer Events) para pan, zoom,
  pellizco y ajuste de escala en móvil, foco de teclado visible y `prefers-reduced-motion` respetado.
- **Favicon propio** en SVG + PNG (velas alcista/bajista con la paleta de marca).

## Arquitectura
Tres archivos, sin build step ni dependencias de terceros en producción:

```
index.html   → estructura semántica de la interfaz
style.css    → sistema de diseño (tokens, layout, componentes)
script.js    → capa de datos + motor de gráficos + lógica de UI
```

`script.js` se organiza en módulos funcionales dentro del mismo archivo:
1. **Capa de API** — `fetch` con caché en memoria y cancelación de peticiones obsoletas mediante
   `AbortController` (si el usuario cambia de activo o de marco temporal antes de que la petición
   anterior termine, esta se cancela).
2. **Indicadores técnicos** — funciones puras (`sma`, `ema`, `bollinger`, `rsi`, `macd`) que operan
   sobre arrays de precios de cierre.
3. **Motor de gráficos** — funciones de dibujo por panel (`drawPricePane`, `drawVolumePane`,
   `drawRsiPane`, `drawMacdPane`) que comparten un mismo estado de vista (offset/zoom) para
   mantener sincronizado el eje temporal entre paneles.
4. **UI** — watchlist, buscador, toolbar de indicadores/velas/marcos temporales.

## API utilizada
[CoinGecko API pública](https://www.coingecko.com/api) — gratuita, sin necesidad de API key.
- `GET /coins/markets` — listado de mercados para la watchlist y el buscador.
- `GET /coins/{id}/ohlc` — velas OHLC para el gráfico principal.
- `GET /coins/{id}/market_chart` — serie de volumen, agregada por vela en el cliente.

## Tecnologías
- HTML5 semántico
- CSS3 (custom properties, grid, sin frameworks)
- JavaScript vanilla (ES2020+), Canvas 2D API
- Fetch API + AbortController
- CoinGecko API pública

## Créditos de datos
Datos de mercado cortesía de [CoinGecko](https://www.coingecko.com).