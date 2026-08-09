# 🔌 BRAVIA API setup

BRAVIA works in two layers:

1. **GitHub Pages frontend** — public/live Coinbase data, public DEX Screener meme radar, paper engine, charts, CA risk screen and Strategy Arena.
2. **Optional BRAVIA Backend** — keeps secret keys off the browser and unlocks two independent real-time Solana detection paths (Helius + Birdeye), GoPlus security enrichment, Helius RPC reads, Jupiter quote modelling and the optional OpenAI supervisor.

> Never paste secret API keys into `app.js`, GitHub Pages, issues, commits or ChatGPT messages. Put them only in your private server environment variables.

## Providers

| Provider | Used for | Secret required? | BRAVIA without it |
|---|---|---:|---|
| Coinbase Advanced Trade | normal crypto WebSocket + market universe | No for public feeds | ✅ fully live |
| DEX Screener | Solana pair/liquidity/volume/transaction data | No | ✅ public meme fallback |
| Helius | real-time Pump.fun creation stream + Solana RPC/read-only wallet balance | Yes | ⏱ loses the on-chain creation stream |
| Birdeye | independent real-time new-listing stream + holder/security intelligence | Yes | 🟡 Helius + public fallback can still run |
| GoPlus | Solana token security enrichment | Access token | 🟡 public risk metrics only |
| Jupiter Swap V2 | route/order quote modelling for Solana | API key | 🟡 optional in paper mode |
| OpenAI | paper-session supervisor / diagnostics | API key | 🟡 optional |

## Environment variables

Copy `server/.env.example` to your hosting provider's environment-variable panel:

```env
PORT=8787
ALLOWED_ORIGIN=https://mmoya113.github.io
BIRDEYE_API_KEY=...
HELIUS_API_KEY=...
GOPLUS_ACCESS_TOKEN=...
JUPITER_API_KEY=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5
```

The frontend only needs the deployed backend URL. Open **Setup → BRAVIA Backend**, paste that URL and press **Save & Test**.

## What you still need to create

### Helius — highest priority for the sniper
Create a Helius API key. BRAVIA V3.1 opens a Solana WebSocket `transactionSubscribe` against the official Pump.fun program and watches creation transactions containing `InitializeMint2`. When it detects a mint, it immediately queues the CA for market/pool resolution. The same key is used for read-only Solana RPC calls.

### Birdeye — second independent real-time source
Create a Birdeye API key with access to the WebSocket feature you intend to use. BRAVIA also subscribes to `SUBSCRIBE_TOKEN_NEW_LISTING` with meme-platform listings enabled. This gives the sniper a second discovery path rather than relying on one provider.

### GoPlus
Create API credentials/access token for the Solana Token Security API. It enriches RugCheck with token-security flags.

### Jupiter
Create a Jupiter developer API key. BRAVIA's backend exposes a quote/order-modelling proxy without putting the key in the browser. The current build does **not** submit or sign live transactions.

### OpenAI — optional
Create an OpenAI API key and keep it only on the backend. The optional AI Supervisor summarizes paper-session results and diagnostics; it is not in the low-latency execution loop and does not place trades.

## Running the backend locally

```bash
cd server
npm install
# configure environment variables
npm start
```

Health check:

```text
GET /health
```

Expected response includes provider readiness, Helius/Birdeye sniper connection state and `liveExecutionEnabled: false`.

## Deploying the backend

The `server/` directory is a normal Node service and includes a `Dockerfile`. A root `render.yaml` blueprint is also included. Configure all secrets in the host's encrypted environment-variable settings; do not commit a populated `.env` file.

## How the sniper now detects tokens

**Public fallback:** DEX Screener fresh-token polling is useful for the UI and paper testing, but it is not guaranteed to observe the exact instant a token is created.

**Helius path:** the backend watches Pump.fun creation transactions on Solana. A detected mint is pushed into BRAVIA's throttled pair-resolution queue immediately.

**Birdeye path:** the backend independently listens to Birdeye's real-time new-listing WebSocket. Events enter the same pair-resolution queue.

The resolver is deliberately rate-limited and retries because **mint creation and a usable/indexed trading market are not the same event**. As soon as market/liquidity data becomes available, the browser receives the candidate over SSE and the selected sniper preset decides whether to paper-enter.

This is designed for low latency, but BRAVIA does not claim an exact one-second fill: provider latency, indexing, pool availability and network conditions are outside the program's control.
