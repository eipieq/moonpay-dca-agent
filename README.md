# proof of agent

![proof of agent](proof-of-agent.jpg)

AI agents act. nobody can prove what they decided, why, or what actually ran.

this project fixes that. every step an agent takes — what market data it saw, what it decided, what it executed — gets committed onchain as a keccak256 hash, permanently, for free. the tx hash is the receipt. the chain is the audit log.

run `node agent.js replay` and any session reconstructs from the blockchain alone. no server, no trust.

the DCA execution is the demo. the onchain audit layer is the actual thing.

## how it works

three steps, three onchain commits per run:

1. **market data** — agent fetches live portfolio + trending tokens via MoonPay CLI, commits a hash of everything it saw
2. **decision** — agent reasons via OpenAI, commits the decision hash (verdict, reasoning, confidence)
3. **execution** — agent runs the swap via MoonPay CLI or skips, commits the result hash

every commit is a gasless tx on Status Network. `gasPrice: 0n`, permanent, free.

the tamper demo is the best part. run the agent, change one word in `last-session.json`, run verify — it catches it. that's the whole thesis in one command.

## usage

```bash
node agent.js           # run a full cycle, get 3 tx hashes
node agent.js replay    # reconstruct all sessions from chain alone
node agent.js verify    # prove decision content matches its onchain hash
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
| wallet | [OpenWallet Standard](https://openwallet.sh/) — keys encrypted at rest, agent never touches them |
| execution | [MoonPay CLI](https://www.moonpay.com/agents) — balances, market data, swaps via `mp` |
| decision engine | OpenAI GPT-4o-mini |
| audit log | Status Network Sepolia — gasless, `gasPrice: 0n` |
| smart contract | `DecisionLog.sol` — stores keccak256 hashes + timestamps onchain |

## tracks

| track | how we qualify |
|---|---|
| MoonPay CLI Agents | `mp` is the primary action layer — market data, balances, swap execution all go through it |
| OpenWallet Standard | `ows` manages all keys — encrypted at rest, agent never touches the private key directly |
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
