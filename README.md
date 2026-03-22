# proof of agent

AI agents act. nobody can prove what they decided, why, or what actually ran. logs get deleted, APIs go down, nobody audits the model outputs.

this project fixes that. every step an agent takes — what market data it saw, what it decided, what it executed — gets committed onchain as a keccak256 hash, permanently, for free. the tx hash is the receipt. the chain is the audit log.

you can reconstruct any agent session from the blockchain alone. no server, no trust, no "just believe us."

the DCA execution is the demo. the onchain audit layer is the actual thing.

## how it works

three steps, three onchain commits per run:

1. **market data** — agent fetches live portfolio + trending tokens via MoonPay CLI, commits a hash of everything it saw
2. **decision** — agent reasons about the data via OpenAI, commits the decision hash (verdict, reasoning, confidence)
3. **execution** — agent executes the swap via MoonPay CLI (or skips), commits the result hash

every commit is a gasless tx on Status Network. `gasPrice: 0n`, permanent, verified.

then run `node agent.js replay` and the full session reconstructs from chain alone.

## stack

- wallet layer: [OpenWallet Standard](https://openwallet.sh/) — keys encrypted at rest, agent never touches them
- execution layer: [MoonPay CLI](https://www.moonpay.com/agents) — balances, market data, swap execution
- decision engine: OpenAI GPT-4o-mini
- audit layer: Status Network Sepolia — `DecisionLog.sol` at `0xF1DD974deD8ECF432AF9A0abb10584dE92d2Fc1e`

## setup

```bash
npm install
npm install -g @moonpay/cli @open-wallet-standard/core
```

```bash
mp login --email your@email.com
mp wallet create --name AgentWallet
ows wallet create --name AgentWallet
```

```bash
cp .env.example .env
# fill in OPENAI_API_KEY, PRIVATE_KEY, DECISION_LOG_ADDRESS
```

## run

```bash
node agent.js
```

runs a full DCA cycle and commits every step onchain. prints three tx hashes.

```bash
node agent.js replay
```

reads all entries from the contract and reconstructs every session. no backend, pure chain.

## example output

```
proof of agent — run starting

ows wallet:
ID: 3311e53b  Name: AgentWallet  Secured: ✓

fetching market data...
[market_data] committed → 0xfbd265...

asking the agent...
VERDICT: BUY
REASONING: SOL showing positive momentum with high volume...
CONFIDENCE: medium
ACTION: execute_dca

[decision] committed → 0x095891...

executing...
[execution] committed → 0xe293ed...

── proof of agent ──────────────────────
market_data tx:  0xfbd265...
decision tx:     0x095891...
execution tx:    0xe293ed...
```

```
$ node agent.js replay

replaying 3 onchain entries from 0xF1DD974...

── session 1 ── 2026-03-22T14:43:28.000Z
  step:   market_data
  hash:   0xe7a351...
  agent:  0x483Ad5...
  step:   decision
  hash:   0xbf310d...
  agent:  0x483Ad5...
  step:   execution
  hash:   0xa246bc...
  agent:  0x483Ad5...
```

## why it qualifies

**MoonPay CLI Agents:** MoonPay CLI is the execution layer. market data, balances, and swaps all go through `mp`.

**OpenWallet Standard:** OWS manages the non-custodial wallet. keys never exposed to the agent.

**the real thing though:** this is the only submission that makes agent actions verifiable after the fact. run it, get receipts, replay from chain. that's new.

## proof of deployment

contract: `0xF1DD974deD8ECF432AF9A0abb10584dE92d2Fc1e`
network: Status Network Sepolia (chainId: 1660990954)
sample session tx hashes:
- market_data: `0xfbd26539a20240d800b835aa45ec0768c575eb9ad5a6c857e0e7eb908eef309b`
- decision: `0x095891644fd0f1c2b9ef72bf1a47a8f6a61a39fe8cbdc964b468fe8d2363eef4`
- execution: `0xe293edbea27f12ed813e0f8aade969d8b840b0b9ee9ae9225a55c3b565392775`
