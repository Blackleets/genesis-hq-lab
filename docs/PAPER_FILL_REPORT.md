# Paper Fill Tester — REPORTE REAL (adverse selection medido)

Medicion de FILL RATE + ADVERSE SELECTION con polling REAL del orderbook L2
vivo (NO se colocan ordenes, es read-only PAPER). Esto separa "el spread
existe" de "un MM real gana".

## Resultados (120 snapshots @1s por par, datos vivos)
| Par | Exchange | Fills | Net bps/fill | Veredicto |
|---|---|---|---|---|
| ETHUSDT | Binance | 79 | -1.86 | PERDEDOR (spread~0, adverse total) |
| BTCUSDT | Binance | 54 | -1.75 | PERDEDOR (spread~0, adverse total) |
| APLD | OKX | 0 | sin fills | ILIQUIDO (nadie llena) |
| GE | Bybit | 28 | -0.96 | PERDEDOR (adverse selection come spread) |

## Veredicto honesto
El market-maker PASIVO es perdedor en todos los pares probados con datos
reales:
1. ETH/BTC: spread real ~0 -> no cubre fees, adverse selection total.
2. GE (tokenizado): spread gordo (90bps) pero adverse selection se come casi
   todo (-0.96 bps/fill).
3. APLD (tokenizado): spread 98bps pero CERO fills en 120 polls -> iliquido
   de verdad, no se puede realizar el edge.

## Conclusión
El spread L2 existe en papel, pero en practica (fills reales + adverse
selection) el MM pasivo PIERDE. Este es el hallazgo que ahorra dinero real:
NO deployar MM pasivo con $ real hasta resolver adverse selection.

## Siguiente paso real (si se quiere ganar de verdad)
- MM ACTIVO (quote agility / jitter) para evitar adverse selection.
- O reversion a VWAP en los tokenizados con fills reales (usar fill-rate como
  filtro: solo pares con fills > X en ventana de prueba).
- O pivotar a otro edge (ya descartado directional en uptrend, funding en
  bear, MM pasivo pierde). El laboratorio queda vivo midiendo.

CERO dolares reales. PAPER. Real requiere GO humano + keys + kill switch.
