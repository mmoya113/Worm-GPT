# BRAVIA Trading Engine — Phase 1

A clean replacement for the previous repository contents.

## What works now

- Live BTC-USD, ETH-USD and SOL-USD market data from Coinbase Advanced Trade public WebSocket.
- Neon mobile-first dashboard.
- $10 paper wallet.
- START / STOP paper bot.
- AUTO, ULTRA, FAST, BALANCED, TREND and CUSTOM strategy presets.
- Signal engine based on live momentum, acceleration, 24h trend, spread and short-term volatility.
- Paper fills modeled from live bid/ask plus 0.05% slippage and 0.40% fee per side.
- Take-profit, stop-loss, trailing exits, max-hold exits and signal reversals.
- Positions, PnL, fees, win rate, max drawdown, trade history metrics and live logs.
- No private keys, exchange account or real orders.

## Run

This phase is a static web app. Serve the repository with any static server, or enable GitHub Pages for the repository and open `index.html`.

The browser connects directly to Coinbase's public market-data WebSocket. No API key is required for the public ticker feed.

## Safety boundary

Phase 1 is intentionally **paper-only**. It contains no code for signing transactions, accessing a wallet or placing real orders.

## Next phases

- **Phase 2:** memecoin scanner + Solana sniper paper engine + security presets.
- **Phase 3:** Strategy Arena / Test All Modes + persistence + final analytics + production hardening.
