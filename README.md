# proof of agent

![proof of agent](proof-of-agent.jpg)

AI agents act. nobody can prove what they decided, why, or what actually ran.

this project fixes that. every step an agent takes — what market data it saw, what it decided, what it executed — gets committed onchain as a keccak256 hash, permanently, for free. the tx hash is the receipt. the chain is the audit log.

run `node agent.js replay` and every onchain session is listed from the blockchain alone — hashes, agent address, timestamps. no server, no trust.

the DCA execution is the demo. the onchain audit layer is the actual thing.

## how it works

five steps, five onchain commits per run:

0. **policy config** — before the agent acts, it declares its constraints. the policy config is serialized, OWS-signed on ethereum and solana, and committed onchain. this is the trust anchor — proof of what rules the agent agreed to operate under.
1. **market data** — fetches SOL + ETH prices, trending tokens, and portfolio balance via MoonPay CLI. OWS signs the hash. committed onchain.
2. **decision** — reasons via OpenAI GPT-4o-mini (verdict, reasoning, confidence, action). OWS signs the decision hash. committed onchain.
3. **policy check** — 6-gate engine evaluates the decision against the declared config: spending limit, token whitelist, chain whitelist, cooldown, confidence threshold, verdict gate. result committed onchain — pass or block.
4. **execution** — if policy approved and AI said execute_dca, runs the swap via MoonPay CLI. if blocked, logs the reason. OWS signs the result. committed onchain.

every commit is a gasless tx on Status Network. `gasPrice: 0n`, permanent, free.

OWS is the root of trust — not just the wallet layer. the agent signs its constraints before it acts. every subsequent step is attributed to that same OWS identity. keys stay encrypted at rest, agent never touches them directly.

the tamper demo is the best part. run the agent, change one word in `last-session.json`, run verify — it catches it on any of the five steps.

## policy engine

```js
const policy = {
  maxSpendUsdc:      5,           // max $ per cycle
  allowedTokens:     [sol],       // token buy whitelist
  allowedChains:     ["solana"],  // chain whitelist
  cooldownMinutes:   30,          // min minutes between executions
  minConfidence:     "medium",    // minimum AI confidence to execute
  requireBuyVerdict: true,        // VERDICT: BUY required
};
```

the config is committed onchain before the agent acts. the policy check is committed onchain after the decision. you can prove what rules the agent declared, and prove it followed them. a policy check you cannot tamper with is more valuable than one you can.

## usage

```bash
node agent.js              # run a full cycle — 5 tx hashes
node agent.js watch        # run autonomously every 30 min
node agent.js watch 60     # run every 60 min
node agent.js replay       # reconstruct all sessions from chain alone
node agent.js verify policy_config        # prove what constraints the agent declared
node agent.js verify decision             # prove what the agent decided
node agent.js verify policy_check         # prove the policy evaluation result
node agent.js verify execution            # prove what actually ran
```

## setup

```bash
npm install
npm install -g @moonpay/cli @open-wallet-standard/core

mp login --email your@email.com
mp wallet create --name AgentWallet
ows wallet create --name AgentWallet

cp .env.example .env
```

to actually execute swaps, fund the MoonPay `AgentWallet` Solana address with USDC on Solana. without funds the agent still runs, decides, and logs everything onchain — the swap just fails gracefully.

## stack

| layer | tool |
|---|---|
| wallet | [OpenWallet Standard](https://openwallet.sh/) — multi-chain signing (ethereum + solana), keys encrypted at rest, audit policy type extension |
| execution | [MoonPay CLI](https://www.moonpay.com/agents) — trending tokens, SOL + ETH prices, portfolio, Polymarket, bridge quotes, swaps via `mp` |
| decision engine | OpenAI GPT-4o-mini |
| audit log | Status Network Sepolia — gasless, `gasPrice: 0n` |
| smart contract | `DecisionLog.sol` — stores keccak256 hashes + timestamps onchain |

## tracks

| track | how we qualify |
|---|---|
| MoonPay CLI Agents | `mp` is the primary action layer — market data, balances, swap execution all go through it |
| OpenWallet Standard | `ows` manages all keys — multi-chain signing (ethereum + solana), encrypted at rest. extends OWS with a new `audit` policy type (see `policies/audit-policy.md`) |
| Synthesis Open Track | onchain audit primitive for any autonomous agent system |
| Student Founder's Bet | current MSE + IIT Madras BS Data Science student |

**what makes it different:** every other agent logs to a backend or logs nothing. this one commits each reasoning step to a public blockchain with cryptographic proof. you can audit any session after the fact from chain alone. that's new.

## proof of deployment

| field | value |
|---|---|
| contract | `0xF1DD974deD8ECF432AF9A0abb10584dE92d2Fc1e` |
| network | Status Network Sepolia |
| chain ID | 1660990954 |
| gas price | 0 (gasless at protocol level) |
| sessions onchain | 5 |

**sample session tx hashes:**

| step | tx hash |
|---|---|
| market_data | `0x86ea0eaedd13f836505b9feae492735662064dcc97e907e2a27395cc304c30b8` |
| decision | `0x6b4e83504bcaee7a963b77be76ee80f1f8e0250e1626ea403dc53b8b18799c78` |
| execution | `0x699841f1cdce6b39cca06c90d04a90466da5af91f065bb9365f4408531dc7c91` |
