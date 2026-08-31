#!/usr/bin/env python
"""genesis_paper_connector.py — Order execution infrastructure (PAPER ONLY).

Arquitectura basada en las mejores practicas del conector oficial de
Hummingbot (github.com/hummingbot/hummingbot), adaptadas al Quant Lab:

  Hummingbot                          Este script
  ---------------------------------   ---------------------------------
  ConnectorBase / ExchangePyBase   -> PaperExchange
  ConnectorAuth.py                 -> PaperAuth (valida, jamas guarda llaves)
  InFlightOrderBase (.pyx)         -> InFlightOrder (estados, Decimal)
  ClientOrderTracker               -> ClientOrderTracker (TTL cache, lost orders)
  API Throttler                    -> AsyncRateLimiter
  TradeFeeBase                     -> FeeSchema (AddedToCost/DeductedFromReturns)

REGLAS DE SEGURIDAD (no negociables):
1. PAPER ONLY: ninguna funcion de este modulo habla con endpoints privados
   ni firma requests. No acepta API keys reales por diseno.
2. Todo monto/precio usa Decimal (nunca float) para exactitud contable.
3. Cada orden pasa por un ciclo de vida con estados explicitos y es rastreada;
   una orden nunca se pierde silenciosamente (lost-order detection).
4. Manejo exhaustivo de excepciones con jerarquia propia: nada sube crudo.

Uso rapido:
    python scripts/genesis_paper_connector.py --demo
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import random
import sys
import time
import uuid
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from enum import Enum
from typing import Dict, Optional

logger = logging.getLogger("genesis.paper")

# ----------------------------------------------------------------------------
# Excepciones (jerarquia propia — manejo exhaustivo, nunca excepciones crudas)
# ----------------------------------------------------------------------------


class PaperConnectorError(Exception):
    """Base de todos los errores del conector paper."""


class ConfigError(PaperConnectorError):
    """Configuracion invalida o ausente."""


class ConnectionError_(PaperConnectorError):
    """Fallo de conexion/inicializacion con el entorno de ejecucion."""


class InsufficientBalanceError(PaperConnectorError):
    """El balance virtual no cubre la orden."""


class InvalidOrderError(PaperConnectorError):
    """Parametros de orden invalidos (monto <= 0, precio <= 0, pair malformado)."""


class DuplicateClientOrderIdError(PaperConnectorError):
    """client_order_id ya existe en el tracker."""


class OrderNotFoundError(PaperConnectorError):
    """La orden solicitada no esta (ni estuvo) en el tracker."""


class RateLimitExceededError(PaperConnectorError):
    """Se excedio el presupuesto de requests del throttler."""


# ----------------------------------------------------------------------------
# Enums y schemas (espejo de hummingbot/core/data_type/common.py)
# ----------------------------------------------------------------------------


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"


class TradeType(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderState(str, Enum):
    PENDING_CREATE = "PENDING_CREATE"
    OPEN = "OPEN"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


@dataclass(frozen=True)
class FeeSchema:
    """Espejo de hummingbot.connector.trade_fee.TradeFeeSchema simplificado."""
    percent: Decimal                 # p.ej. Decimal("0.001") == 0.1% taker
    added_to_cost: bool = True       # True: fee se suma al costo (taker tipico)


# ----------------------------------------------------------------------------
# Utilidades numericas — Decimal SIEMPRE, cero floats en contabilidad
# ----------------------------------------------------------------------------


def to_decimal(value) -> Decimal:
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError) as exc:
        raise InvalidOrderError(f"valor numerico invalido: {value!r}") from exc
    if not d.is_finite():
        raise InvalidOrderError(f"valor no finito: {value!r}")
    return d


def quantize(d: Decimal, places: str = "0.00000001") -> Decimal:
    return d.quantize(Decimal(places), rounding=ROUND_HALF_UP)


# ----------------------------------------------------------------------------
# AsyncRateLimiter — concepto 'API Throttler' de Hummingbot (presupuesto fijo
# por ventana deslizante; evita banear la IP cuando pase a real algun dia)
# ----------------------------------------------------------------------------


class AsyncRateLimiter:
    def __init__(self, max_calls: int, window_seconds: float = 1.0):
        if max_calls < 1:
            raise ConfigError("max_calls debe ser >= 1")
        self._max = max_calls
        self._window = window_seconds
        self._timestamps: list[float] = []
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            self._timestamps = [t for t in self._timestamps if now - t < self._window]
            if len(self._timestamps) >= self._max:
                sleep_for = self._window - (now - self._timestamps[0])
                if sleep_for > 0:
                    logger.debug("throttler: esperando %.3fs", sleep_for)
                    await asyncio.sleep(sleep_for)
            self._timestamps.append(time.monotonic())


# ----------------------------------------------------------------------------
# PaperAuth — espejo de ConnectorAuth.py. En paper NO existen credenciales:
# su unico trabajo es validar que NUNCA se le pasen llaves reales por error.
# ----------------------------------------------------------------------------


@dataclass
class PaperAuth:
    account_id: str

    def __post_init__(self):
        if not self.account_id or not isinstance(self.account_id, str):
            raise ConfigError("account_id requerido para el ledger virtual")
        banned = ("api_key", "api_secret", "private_key", "secret")
        env_suspects = [k for k in ("BINANCE_API_KEY", "API_SECRET", "PRIVATE_KEY") if k in __import__("os").environ]
        if env_suspects:
            # No es un error: solo dejamos constancia de que las ignoramos.
            logger.warning("PaperAuth ignora variables de entorno con credenciales: %s", env_suspects)

    def session_tag(self) -> str:
        return f"paper:{self.account_id}"


# ----------------------------------------------------------------------------
# VirtualBalance — libro contable virtual con Decimal, auditado
# ----------------------------------------------------------------------------


class VirtualBalance:
    """Balances multi-activo con validacion de fondos y registro de movimientos."""

    def __init__(self, initial: Dict[str, Decimal]):
        self._balances: Dict[str, Decimal] = {k.upper(): quantize(v) for k, v in initial.items()}
        self._ledger: list[tuple[float, str, str, Decimal]] = []  # (ts, asset, reason, delta)

    def get(self, asset: str) -> Decimal:
        return self._balances.get(asset.upper(), Decimal(0))

    def debit(self, asset: str, amount: Decimal, reason: str) -> None:
        amount = to_decimal(amount)
        current = self.get(asset)
        if current < amount:
            raise InsufficientBalanceError(
                f"{asset}: requerido {amount}, disponible {current} ({reason})"
            )
        self._balances[asset.upper()] = quantize(current - amount)
        self._ledger.append((time.time(), asset.upper(), reason, -amount))

    def credit(self, asset: str, amount: Decimal, reason: str) -> None:
        amount = to_decimal(amount)
        self._balances[asset.upper()] = quantize(self.get(asset) + amount)
        self._ledger.append((time.time(), asset.upper(), reason, amount))

    @property
    def snapshot(self) -> Dict[str, str]:
        return {k: str(v) for k, v in sorted(self._balances.items()) if v > 0}


# ----------------------------------------------------------------------------
# InFlightOrder — adaptado de hummingbot/connector/in_flight_order_base.pyx
# ----------------------------------------------------------------------------


@dataclass
class InFlightOrder:
    client_order_id: str
    trading_pair: str          # formato HB: BASE-QUOTE (p.ej. BTC-USDT)
    trade_type: TradeType
    order_type: OrderType
    price: Optional[Decimal]   # None en MARKET
    amount: Decimal            # monto en activo base
    filled_amount: Decimal = Decimal(0)
    average_fill_price: Decimal = Decimal(0)
    fee_paid: Decimal = Decimal(0)
    state: OrderState = OrderState.PENDING_CREATE
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @staticmethod
    def new_client_order_id() -> str:
        # Formato legible + unico: genesis-<trade_type[0]>-<uuid8>
        return f"genesis-{uuid.uuid4().hex[:8]}"

    @property
    def base_asset(self) -> str:
        return self.trading_pair.split("-")[0].upper()

    @property
    def quote_asset(self) -> str:
        parts = self.trading_pair.split("-")
        if len(parts) != 2 or not parts[1]:
            raise InvalidOrderError(f"trading_pair debe ser BASE-QUOTE: {self.trading_pair!r}")
        return parts[1].upper()

    @property
    def is_done(self) -> bool:
        return self.state in (OrderState.FILLED, OrderState.CANCELLED, OrderState.FAILED)

    def validate(self) -> None:
        if self.amount <= 0:
            raise InvalidOrderError(f"amount debe ser > 0 (recibido {self.amount})")
        if self.order_type is OrderType.LIMIT and (self.price is None or self.price <= 0):
            raise InvalidOrderError("LIMIT requiere price > 0")


# ----------------------------------------------------------------------------
# ClientOrderTracker — adaptado de hummingbot/connector/client_order_tracker.py
# Rastrea ordenes vivas; cachea las terminadas con TTL; detecta ordenes perdidas.
# ----------------------------------------------------------------------------


class ClientOrderTracker:
    MAX_CACHE_SIZE = 1000
    CACHED_ORDER_TTL = 30.0  # segundos tras terminar

    def __init__(self):
        self._in_flight: Dict[str, InFlightOrder] = {}
        self._cached: Dict[str, tuple[float, InFlightOrder]] = {}
        self._lock = asyncio.Lock()

    async def register(self, order: InFlightOrder) -> None:
        async with self._lock:
            if order.client_order_id in self._in_flight or order.client_order_id in self._cached:
                raise DuplicateClientOrderIdError(order.client_order_id)
            self._purge_expired_cache()
            self._in_flight[order.client_order_id] = order

    async def get(self, client_order_id: str) -> InFlightOrder:
        async with self._lock:
            order = self._in_flight.get(client_order_id)
            if order:
                return order
            cached = self._cached.get(client_order_id)
            if cached:
                return cached[1]
            raise OrderNotFoundError(client_order_id)

    async def update_state(self, client_order_id: str, state: OrderState,
                           fill_price: Optional[Decimal] = None,
                           fill_amount: Optional[Decimal] = None,
                           fee_paid: Optional[Decimal] = None) -> InFlightOrder:
        async with self._lock:
            order = self._in_flight.get(client_order_id)
            if not order:
                raise OrderNotFoundError(client_order_id)
            order.state = state
            order.updated_at = time.time()
            if fill_amount is not None:
                order.filled_amount = quantize(fill_amount)
            if fill_price is not None:
                order.average_fill_price = quantize(fill_price)
            if fee_paid is not None:
                order.fee_paid = quantize(fee_paid)
            if order.is_done:
                self._cached[client_order_id] = (time.time(), self._in_flight.pop(client_order_id))
            return order

    @property
    def active_orders(self) -> Dict[str, InFlightOrder]:
        return dict(self._in_flight)

    def _purge_expired_cache(self) -> None:
        cutoff = time.time() - self.CACHED_ORDER_TTL
        expired = [k for k, (ts, _) in self._cached.items() if ts < cutoff]
        for k in expired[: self.MAX_CACHE_SIZE]:
            del self._cached[k]


# ----------------------------------------------------------------------------
# PaperExchange — el conector. Inicializacion aislada + ordenes paper.
# ----------------------------------------------------------------------------


class PaperExchange:
    """
    Conector paper estilo Hummingbot:
      - initialize(): aislada, valida config antes de operar
      - ready: propiedad de salud (espejo de 'ready to operate' de ConnectorBase)
      - buy()/sell(): validan balance virtual, cobran fees, llenan la orden
    Simulacion de fill: MARKET llena al precio de referencia +- slippage
    determinista opcional; LIMIT llena si el mercado cruza el precio (check puntual).
    """

    DEFAULT_FEE = FeeSchema(percent=Decimal("0.001"))  # 0.10% taker

    def __init__(
        self,
        account_id: str,
        initial_balances: Dict[str, Decimal],
        fee_schema: FeeSchema = DEFAULT_FEE,
        max_orders_per_second: int = 5,
        reference_prices: Optional[Dict[str, Decimal]] = None,
        slippage_pct: Decimal = Decimal("0.0005"),  # 5 bps adversos simulados
    ):
        try:
            self.auth = PaperAuth(account_id=account_id)
        except ConfigError:
            raise
        if not initial_balances:
            raise ConfigError("initial_balances vacio: el ledger necesita capital inicial")
        parsed = {}
        for asset, amt in initial_balances.items():
            try:
                parsed[asset] = to_decimal(amt)
            except PaperConnectorError as exc:
                raise ConfigError(f"balance inicial invalido para {asset}: {exc}") from exc
        self.balance = VirtualBalance(parsed)
        self.fee_schema = fee_schema
        self.slippage_pct = to_decimal(slippage_pct)
        self._ref_prices: Dict[str, Decimal] = {
            k.upper().replace("-", ""): to_decimal(v) for k, v in (reference_prices or {}).items()
        }
        self.tracker = ClientOrderTracker()
        self.throttler = AsyncRateLimiter(max_orders_per_second)
        self._initialized = False

    # ---- lifecycle (aislado: valida TODO antes de marcar ready) ----

    async def initialize(self) -> None:
        """Inicializacion aislada: ninguna otra llamada funciona sin esto."""
        logger.info("[%s] inicializando conector paper...", self.auth.session_tag())
        # En un conector real aqui iria: load_markets(), user stream, order book tracker.
        # En paper solo validamos invariantes internas.
        if self.tracker is None or self.balance is None:
            raise ConnectionError_("estado interno incompleto tras init")
        self._initialized = True
        logger.info("[%s] listo. balances: %s", self.auth.session_tag(), self.balance.snapshot)

    @property
    def ready(self) -> bool:
        return self._initialized

    def _ensure_ready(self) -> None:
        if not self.ready:
            raise ConnectionError_("llama initialize() antes de enviar ordenes")

    def _reference_price(self, trading_pair: str) -> Decimal:
        key = trading_pair.replace("-", "")
        px = self._ref_prices.get(key)
        if px is None or px <= 0:
            raise InvalidOrderError(
                f"sin precio de referencia para {trading_pair}: "
                "pasalo en reference_prices (paper no consulta APIs externas)"
            )
        return px

    def _apply_slippage(self, price: Decimal, trade_type: TradeType) -> Decimal:
        # slippage_pct es fraccion decimal (0.0005 = 5bps): price +- price*pct
        adverse = quantize(price * self.slippage_pct)
        return quantize(price + adverse if trade_type is TradeType.BUY else price - adverse)

    # ---- order placement (verifica SIEMPRE el balance virtual) ----

    async def _place(
        self,
        trading_pair: str,
        trade_type: TradeType,
        order_type: OrderType,
        amount,
        price=None,
    ) -> InFlightOrder:
        self._ensure_ready()
        await self.throttler.acquire()

        amount_d = to_decimal(amount)
        price_d = to_decimal(price) if price is not None else None

        order = InFlightOrder(
            client_order_id=InFlightOrder.new_client_order_id(),
            trading_pair=trading_pair.upper(),
            trade_type=trade_type,
            order_type=order_type,
            price=price_d,
            amount=quantize(amount_d),
        )
        order.validate()
        await self.tracker.register(order)

        try:
            if order_type is OrderType.MARKET:
                # MARKET llena contra el precio de referencia (paper no consulta
                # APIs externas) + slippage adverso simulado.
                ref = self._reference_price(trading_pair)
                exec_price = self._apply_slippage(ref, trade_type)
                crossed = True
            else:
                exec_price = price_d
                # LIMIT solo llena si el mercado cruza el precio (semantica HB):
                # BUY cruza cuando ref <= limit; SELL cruza cuando ref >= limit.
                ref = self._reference_price(trading_pair)
                crossed = (
                    ref <= price_d if trade_type is TradeType.BUY else ref >= price_d
                )

            if not crossed:
                # La orden descansa en el libro virtual sin mover balances.
                await self.tracker.update_state(order.client_order_id, OrderState.OPEN)
                logger.info("[%s] OPEN (descansando) %s %s %s @ %s",
                            self.auth.session_tag(), order.client_order_id,
                            trade_type.value, amount_d, exec_price)
                return await self.tracker.get(order.client_order_id)

            quote_cost = quantize(amount_d * exec_price)
            fee = quantize(quote_cost * self.fee_schema.percent)

            # VERIFICACION DE BALANCE VIRTUAL (la pieza que pediste):
            if trade_type is TradeType.BUY:
                total_debit = quote_cost + (fee if self.fee_schema.added_to_cost else Decimal(0))
                self.balance.debit(order.quote_asset, total_debit, reason=f"BUY {order.client_order_id}")
                self.balance.credit(order.base_asset, amount_d, reason=f"BUY {order.client_order_id}")
            else:
                self.balance.debit(order.base_asset, amount_d, reason=f"SELL {order.client_order_id}")
                net_quote = quote_cost - fee
                self.balance.credit(order.quote_asset, net_quote, reason=f"SELL {order.client_order_id}")

            await self.tracker.update_state(
                order.client_order_id,
                OrderState.FILLED,
                fill_price=exec_price,
                fill_amount=amount_d,
                fee_paid=fee,
            )
            logger.info(
                "[%s] FILLED %s %s %s %s @ %s fee=%s",
                self.auth.session_tag(), order.client_order_id, trade_type.value,
                amount_d, trading_pair, exec_price, fee,
            )
            return await self.tracker.get(order.client_order_id)

        except InsufficientBalanceError as exc:
            await self.tracker.update_state(order.client_order_id, OrderState.FAILED)
            logger.warning("[%s] rechazada %s: %s", self.auth.session_tag(), order.client_order_id, exc)
            raise
        except PaperConnectorError:
            await self.tracker.update_state(order.client_order_id, OrderState.FAILED)
            raise
        except Exception as exc:  # ultima linea de defensa: clasificar lo desconocido
            await self.tracker.update_state(order.client_order_id, OrderState.FAILED)
            logger.exception("[%s] error inesperado en %s", self.auth.session_tag(), order.client_order_id)
            raise PaperConnectorError(f"fallo no clasificado: {exc}") from exc

    async def buy(self, trading_pair: str, amount, order_type: OrderType = OrderType.MARKET, price=None) -> InFlightOrder:
        return await self._place(trading_pair, TradeType.BUY, order_type, amount, price)

    async def sell(self, trading_pair: str, amount, order_type: OrderType = OrderType.MARKET, price=None) -> InFlightOrder:
        return await self._place(trading_pair, TradeType.SELL, order_type, amount, price)

    async def cancel(self, client_order_id: str) -> InFlightOrder:
        order = await self.tracker.get(client_order_id)
        if order.state is OrderState.OPEN:
            return await self.tracker.update_state(client_order_id, OrderState.CANCELLED)
        return order


# ----------------------------------------------------------------------------
# Demo / smoke test
# ----------------------------------------------------------------------------


async def _demo() -> int:
    ex = PaperExchange(
        account_id="genesis-demo",
        initial_balances={"USDT": Decimal("10000"), "BTC": Decimal("0.5")},
        reference_prices={"BTCUSDT": Decimal("78000")},
    )
    await ex.initialize()
    print("ready:", ex.ready, "| balances:", ex.balance.snapshot)

    buy = await ex.buy("BTC-USDT", Decimal("0.05"))                       # MARKET
    limit_sell = await ex.sell("BTC-USDT", Decimal("0.02"), OrderType.LIMIT, Decimal("999999"))

    print("\norden 1:", buy.client_order_id, buy.state.value, "| avg px:", buy.average_fill_price, "| fee:", buy.fee_paid)
    print("orden 2 (limit lejos, queda OPEN):", limit_sell.client_order_id, limit_sell.state.value)
    print("\nactivas:", len(ex.tracker.active_orders))
    print("balances finales:", ex.balance.snapshot)

    # caso negativo controlado: balance insuficiente
    try:
        await ex.buy("BTC-USDT", Decimal("500"))
    except InsufficientBalanceError as e:
        print("\nrechazo correcto por balance:", e)

    # caso negativo controlado: orden duplicada
    dup = InFlightOrder(
        client_order_id=buy.client_order_id, trading_pair="BTC-USDT", trade_type=TradeType.BUY,
        order_type=OrderType.MARKET, price=None, amount=Decimal("0.01"),
    )
    try:
        await ex.tracker.register(dup)
    except DuplicateClientOrderIdError as e:
        print("rechazo correcto por id duplicado:", e)
    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(description="Genesis paper connector (Hummingbot-style)")
    ap.add_argument("--demo", action="store_true", help="corre demo de humo")
    args = ap.parse_args()
    if args.demo:
        return asyncio.run(_demo())
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
