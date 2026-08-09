# 🔌 BRAVIA API setup

BRAVIA works in two layers:

1. **GitHub Pages frontend** — public/live Coinbase data, public DEX Screener meme radar, paper engine, charts, CA risk screen, Strategy Arena.
2. **Optional BRAVIA Backend** — keeps secret keys off the browser and unlocks Birdeye real-time new-token streaming, GoPlus security enrichment, Helius RPC reads and Jupiter quote modelling.

> Never paste secret API keys into `app.js`, GitHub Pages, issues, commits or ChatGPT messages. Put them only in your private server environment variables.

## Providers

| Provider | Used for | Secret required? | BRAVIA without it |
|---|---|---:|---|
| Coinbase Advanced Trade | normal crypto WebSocket + market universe | No for public feeds | ✅ fully live |
| DEX Screener | Solana pair/liquidity/volume/transaction data | No | ✅ public meme fallback |
| Birdeye | real-time new token/new pair stream + holder profile | Yes | ⏱ falls back to polling |
| GoPlus | Solana token security enrichment | Access token | 🟡 public risk metrics only |
| Helius | Solana RPC / wallet balance reads / future chain stream | Yes | 🟡 optional |
| Jupiter Swap V2 | route/order quote modelling for Solana | API key | 🟡 optional |
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

### Birdeye
Create an API key in the Birdeye developer portal. This is the key that matters most for the intended sniper because BRAVIA subscribes to the Solana `SUBSCRIBE_TOKEN_NEW_LISTING` stream.

### Helius
Create a Helius API key. The backend uses it for read-only Solana RPC calls. It is also the provider to extend if you later want raw low-latency on-chain subscriptions.

### GoPlus
Create API credentials/access token for the Solana Token Security API. It enriches RugCheck with token-security flags.

### Jupiter
Create a Jupiter developer API key. BRAVIA's backend exposes a quote/order modelling proxy without putting the key in the browser.

### OpenAI
Create an OpenAI API key and keep it only on the backend. The optional AI Supervisor summarizes paper-session results and diagnostics; it is not in the millisecond execution loop and does not place trades.

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

Expected response includes provider readiness and `liveExecutionEnabled: false`.

## Deploying the backend

The `server/` directory is a normal Node service and includes a `Dockerfile`. It can be deployed to a Node/Docker host. Configure all secrets in the host's encrypted environment-variable settings; do not commit a populated `.env` file.

## Why the sniper has two speeds

**Public mode:** DEX Screener polling is useful for the UI and testing but it is not guaranteed to be the instant a token is created.

**Backend mode:** Birdeye's real-time new-token WebSocket pushes listings to the server. The server broadcasts them to the browser over SSE. That is the intended low-latency sniper path.

Even then, BRAVIA does not treat “token created” as “safe to buy.” A candidate must have an executable market/pool and pass the chosen preset.
