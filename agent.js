require("dotenv").config();

const { spawnSync } = require("child_process");
const { ethers } = require("ethers");
const OpenAI = require("openai");

const wallet = "AgentWallet";
const chain = "solana";
const sol = "So11111111111111111111111111111111111111111";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const amount = "1";

const rpc = "https://public.sepolia.rpc.status.network";
const logAddress = process.env.DECISION_LOG_ADDRESS;
const logAbi = [
  "function log(bytes32 outputHash, string calldata prompt) external",
  "function getLogs() external view returns (tuple(bytes32 outputHash, string prompt, address agent, uint256 timestamp)[])",
];

function mp(args) {
  const r = spawnSync("mp", args.split(" "), { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim();
}

function ows(args) {
  const r = spawnSync("ows", args.split(" "), { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim();
}

function getContract() {
  const provider = new ethers.JsonRpcProvider(rpc);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  return new ethers.Contract(logAddress, logAbi, signer);
}

async function commit(step, content) {
  const contract = getContract();
  const hash = ethers.keccak256(ethers.toUtf8Bytes(content));
  const tx = await contract.log(hash, `proof-of-agent:${step}`, { gasPrice: 0n, gasLimit: 3000000n });
  const receipt = await tx.wait();
  console.log(`  [${step}] committed → ${receipt.hash}`);
  return { txHash: receipt.hash, outputHash: hash, content };
}

// ── replay: reconstruct full session from chain alone ─────────────────────────
async function replay() {
  const provider = new ethers.JsonRpcProvider(rpc);
  const contract = new ethers.Contract(logAddress, logAbi, provider);
  const logs = await contract.getLogs();

  if (logs.length === 0) {
    console.log("no logs found on chain yet. run the agent first.");
    return;
  }

  console.log(`replaying ${logs.length} onchain entries from ${logAddress}\n`);

  // group by session (sets of 3: market, decision, execution)
  let session = 1;
  const entries = logs.filter(e => e.prompt.startsWith("proof-of-agent:"));

  if (entries.length === 0) {
    console.log("no proof-of-agent entries yet.");
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const step = entry.prompt.replace("proof-of-agent:", "");
    const time = new Date(Number(entry.timestamp) * 1000).toISOString();

    if (step === "market_data") {
      console.log(`── session ${session} ── ${time}`);
    }

    console.log(`  step:   ${step}`);
    console.log(`  hash:   ${entry.outputHash}`);
    console.log(`  agent:  ${entry.agent}`);

    if (step === "execution") {
      console.log();
      session++;
    }
  }
}

// ── run: fetch, decide, execute, commit every step ───────────────────────────
async function run() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log("proof of agent — run starting\n");

  // ows wallet
  console.log("ows wallet:");
  console.log(ows("wallet list").split("\n").slice(0, 3).join("\n"));

  // step 1: market data
  console.log("\nfetching market data...");
  const trending = mp(`token trending list --chain ${chain} --page 1 --limit 3`);
  const solData = mp(`token retrieve --chain solana --token ${sol}`);
  let balances = "";
  try { balances = mp(`token balance list --wallet ${wallet} --chain ${chain}`); }
  catch { balances = "unfunded"; }

  const market = `trending:\n${trending.substring(0, 600)}\n\nsol:\n${solData.substring(0, 300)}\n\nbalance: ${balances}`;
  console.log(solData.split("\n").slice(0, 5).join("\n"));

  console.log("\ncommitting to chain...");
  const s1 = await commit("market_data", market);

  // step 2: ai decision
  console.log("\nasking the agent...");
  const prompt = `you are a DCA agent. here is the current market state:\n\n${market}\n\nshould i DCA $${amount} USDC into SOL right now?\n\nreply with:\nVERDICT: BUY or SKIP\nREASONING: 2-3 sentences\nCONFIDENCE: low / medium / high\nACTION: execute_dca or skip_cycle`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 200,
    messages: [
      { role: "system", content: "you are a DCA crypto agent. be direct." },
      { role: "user", content: prompt },
    ],
  });

  const decision = res.choices[0].message.content;
  console.log("\n" + decision);

  console.log("\ncommitting to chain...");
  const s2 = await commit("decision", decision);

  // step 3: execution
  console.log("\nexecuting...");
  let execution = "skipped — agent chose skip_cycle";
  if (decision.includes("ACTION: execute_dca")) {
    try {
      execution = mp(`token swap --wallet ${wallet} --chain ${chain} --from-token ${usdc} --from-amount ${amount} --to-token ${sol}`);
      console.log(execution);
    } catch (e) {
      execution = `swap attempted — ${e.message.split("\n")[0]}`;
      console.log(execution);
    }
  } else {
    console.log("agent skipped this cycle");
  }

  console.log("\ncommitting to chain...");
  const s3 = await commit("execution", execution);

  // summary
  console.log("\n── proof of agent ──────────────────────────");
  console.log("every step is now permanently onchain.");
  console.log("run `node agent.js replay` to reconstruct this session from chain alone.\n");
  console.log("market_data tx: ", s1.txHash);
  console.log("decision tx:    ", s2.txHash);
  console.log("execution tx:   ", s3.txHash);
  console.log("────────────────────────────────────────────");
}

const mode = process.argv[2];
if (mode === "replay") {
  replay().catch((e) => { console.error(e.message); process.exit(1); });
} else {
  run().catch((e) => { console.error(e.message); process.exit(1); });
}
