# OWS Audit Policy Type

An extension to the OpenWallet Standard policy engine introducing the `audit` policy type — a policy that requires every agent action to be cryptographically committed onchain before it is considered valid.

## motivation

existing OWS policy types gate what an agent can do (spending limits, recipient whitelists, chain restrictions). the audit policy type adds a new dimension: proving that the agent did what it said it did.

without an audit policy, an agent can act and there is no receipt. the audit policy makes the receipt mandatory.

## policy definition

```json
{
  "type": "audit",
  "version": "1",
  "commit_steps": ["policy_config", "market_data", "decision", "policy_check", "execution"],
  "sign_chains": ["ethereum", "solana"],
  "hash_algorithm": "keccak256",
  "commit_network": "status-network-sepolia",
  "gasless": true,
  "tamper_detection": true
}
```

## how it works

1. **policy_config** — before the agent acts, it serializes its full policy config (including this audit policy), signs it with its OWS wallet on all `sign_chains`, and commits the hash onchain. this is the trust anchor — the agent's declared identity and constraints, permanently attributed.

2. **per-step commitment** — every subsequent step listed in `commit_steps` is hashed, OWS-signed on all chains, and committed onchain before the next step begins. no step can be skipped.

3. **tamper detection** — any change to committed content causes a keccak256 mismatch. the content is verifiable against the onchain hash at any time, from chain alone.

4. **chain of custody** — the full session is reconstructible from the blockchain without any server or local file. the OWS wallet address is the agent's permanent identity across all sessions.

## integration with OWS

the audit policy sits alongside existing OWS policy types. it does not replace spending controls or whitelists — it extends them. a fully governed agent would combine:

- `spending_limit` policy — caps transaction amounts
- `allowlist` policy — restricts recipients and chains
- `cooldown` policy — enforces minimum time between actions
- `audit` policy — requires cryptographic commitment of every step

## verification

```bash
node agent.js verify policy_config   # prove declared constraints
node agent.js verify decision        # prove what the agent decided
node agent.js verify policy_check    # prove the policy evaluation result
node agent.js verify execution       # prove what actually ran
```

any of these can be verified from chain alone — no local files required.

## reference implementation

see `agent.js` in this repo. the `commit()` function implements the audit policy: OWS signs each step hash on ethereum and solana, then the hash is committed onchain via a gasless tx on Status Network.
