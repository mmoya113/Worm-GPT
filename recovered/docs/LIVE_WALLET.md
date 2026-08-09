# 🔐 Live wallet architecture

The current repository intentionally keeps **real-money execution disabled**.

## What the site can do now

- Connect to an injected Solana wallet provider (for example when opened inside a compatible wallet browser).
- Read the wallet's **public address** after the user approves connection.
- Never request a seed phrase or private key.
- Use the optional backend for read-only RPC balance information.

## How a real Solana swap normally works

A safe browser-wallet flow is:

```text
BRAVIA strategy → Jupiter order/route → unsigned transaction
                                         ↓
                                 user's wallet signs
                                         ↓
                                   transaction sent
```

The wallet keeps custody of its secret key. BRAVIA should not need the seed phrase.

## Why autonomous execution is hard-locked

A browser wallet normally requires explicit signing/approval. A server-side hot wallet could technically sign automatically, but that means placing real private-key material in an always-online process and greatly increases financial/security risk.

For that reason `server/index.mjs` contains:

```js
const LIVE_EXECUTION_ENABLED = false;
```

and exposes no endpoint that autonomously signs or submits a real-money trade.

## Before any live mode is considered

Paper results need to survive realistic fees, slippage, failed fills, latency and a long forward test. A 24-hour winning run is not enough to prove profitability. Exchange/wallet age and KYC rules also need to be satisfied by the actual account owner.
