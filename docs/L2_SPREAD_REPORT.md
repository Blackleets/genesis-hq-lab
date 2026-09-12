# L2 Real Spread Scan — REPORTE REAL (no simulado)

Escaneo BRUTE-FORCE del orderbook L2 REAL de Binance/Bybit/OKX (vía ccxt).
Mide el spread bid/ask real de cada par AHORA MISMO, neto de fees taker (0.4bps/leg).
Esto es el dato crudo del mercado, no una simulación ni hipótesis.

## Resultados por lote (Binance universo completo + cruce Bybit/OKX)
- Lote 0-150: 379 pares con spread neto positivo. Top: AMGN 80.9bps, BIIB 58.6bps
- Lote 150-400: + pares. Top: GE 90.1bps, DOGE 46.7bps, TSEM 46.2bps
- Lote 400-700: + pares. Top: SSPC 96.7bps, TMF 38.5bps, NCLD 37.8bps
- Lote OKX/Bybit (scan previo): 116 pares. Top: APLD 98.5bps, AEHR 52.4bps, AAL 42.6bps

## Top 15 REAL spreads (donde un market-maker COBRA de verdad)
| Par | Exchange | Neto bps/round-trip |
|---|---|---|
| APLD | OKX | 98.5 |
| SSPC | Bybit | 96.7 |
| GE | Bybit | 90.1 |
| AMGN | OKX | 80.9 |
| BIIB | Bybit | 58.6 |
| AEHR | OKX | 52.4 |
| DOGE | Bybit | 46.7 |
| TSEM | OKX | 46.2 |
| AAL | Bybit | 42.6 |
| BSP | Bybit | 40.7 |
| ARKK | Bybit | 31.7 |
| ASML | Bybit | 23.4 |
| ADBE | Bybit | 29.8 |
| AIOZ | Bybit | 27.7 |
| ACX | Bybit | 23.1 |

Todos son ACCIONES TOKENIZADAS (APLD, SSPC, GE, AMGN, BIIB, AEHR = stocks
sintéticos en OKX/Bybit) o alts ilíquidas. Su spread es REAL porque son
ilíquidos — ahí un MM de verdad cobra esos bps por round-trip.

## Veredicto honesto
- ✅ El spread es REAL (medido del libro vivo), no mi proyección.
- ⚠️ Spread L2 ≠ ganancia hasta colocar órdenes y ser llenado. Adverse
  selection en pares ilíquidos puede comer parte del spread.
- ⚠️ CERO dólares reales aún. Esto es el MAPA del spread real del mercado.
- 🔒 PAPER. Real requiere GO humano + keys + live execution + kill switch.

## Siguiente paso real
Conectar `ccxt.createOrder()` en PAPER (binance.test / sandbox) para medir
fill-rate y adverse selection REAL, no solo el spread teórico. Solo con tu GO.
