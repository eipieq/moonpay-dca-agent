require("dotenv").config();

const { spawnSync } = require("child_process");
const { ethers } = require("ethers");
const OpenAI = require("openai");
const fs = require("fs");

const wallet = "AgentWallet";
const chain = "solana";
const sol = "So11111111111111111111111111111111111111111";
const eth = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const amount = "1";

// ── policy engine config ───────────────────────────────────────────────────────
const policy = {
  maxSpendUsdc:      5,           // max $ per cycle
  allowedTokens:     [sol],       // token buy whitelist
  allowedChains:     ["solana"],  // chain whitelist
  cooldownMinutes:   30,          // min minutes between executions
  minConfidence:     "medium",    // low / medium / high — minimum to execute
  requireBuyVerdict: true,        // VERDICT: BUY required to execute
};

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

function owsSign(message, chainName = "ethereum") {
  const r = spawnSync("ows", [
    "sign", "message",
    "--chain", chainName,
    "--wallet", wallet,
    "--message", message,
    "--json"
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return JSON.parse(r.stdout.trim());
}

function owsAddress(chainName = "ethereum") {
  try {
    const r = spawnSync("ows", [
      "wallet", "show",
      "--name", wallet,
      "--chain", chainName,
      "--json"
    ], { encoding: "utf8" });
    if (r.status !== 0) return null;
    const data = JSON.parse(r.stdout.trim());
    return data.address || data.publicKey || null;
  } catch { return null; }
}

function getContract() {
  const provider = new ethers.JsonRpcProvider(rpc);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  return new ethers.Contract(logAddress, logAbi, signer);
}

async function commit(step, content) {
  const contract = getContract();
  const hash = ethers.keccak256(ethers.toUtf8Bytes(content));

  // multi-chain ows signing — ethereum + solana
  const signatures = {};
  for (const chainName of ["ethereum", "solana"]) {
    try {
      const signed = owsSign(hash, chainName);
      signatures[chainName] = signed.signature || signed;
      console.log(`  [${step}] ows signed (${chainName}) → ${String(signatures[chainName]).slice(0, 20)}...`);
    } catch (e) {
      console.log(`  [${step}] ows sign skipped (${chainName}): ${e.message.split("\n")[0]}`);
    }
  }
  const signature = Object.keys(signatures).length > 0 ? signatures : null;

  const tx = await contract.log(hash, `proof-of-agent:${step}`, { gasPrice: 0n, gasLimit: 3000000n });
  const receipt = await tx.wait();
  console.log(`  [${step}] committed → ${receipt.hash}`);
  return { txHash: receipt.hash, outputHash: hash, content, signature };
}

// ── policy engine ──────────────────────────────────────────────────────────────
function runPolicy(decision, lastSession) {
  const confidenceLevels = ["low", "medium", "high"];
  const checks = [];
  let blocked = null;

  function check(name, pass, reason) {
    checks.push({ name, pass, reason });
    if (!pass && !blocked) blocked = name;
  }

  // 1. spending limit — cap max USDC per cycle
  const spend = parseFloat(amount);
  check(
    "spending_limit",
    spend <= policy.maxSpendUsdc,
    `$${spend} ${spend <= policy.maxSpendUsdc ? "<=" : ">"} $${policy.maxSpendUsdc} max per cycle`
  );

  // 2. allowed token — only whitelisted tokens can be bought
  check(
    "allowed_token",
    policy.allowedTokens.includes(sol),
    `${sol.slice(0, 8)}... ${policy.allowedTokens.includes(sol) ? "is" : "not"} on whitelist`
  );

  // 3. allowed chain — only whitelisted chains
  check(
    "allowed_chain",
    policy.allowedChains.includes(chain),
    `${chain} ${policy.allowedChains.includes(chain) ? "is" : "not"} on whitelist`
  );

  // 4. cooldown — enforce minimum time between executions
  let cooldownPass = true;
  let cooldownReason = "no previous session — cooldown waived";
  if (lastSession) {
    const lastTs = new Date(lastSession.ts).getTime();
    const elapsedMin = (Date.now() - lastTs) / 1000 / 60;
    cooldownPass = elapsedMin >= policy.cooldownMinutes;
    cooldownReason = `${Math.floor(elapsedMin)} min elapsed (min: ${policy.cooldownMinutes} min)`;
  }
  check("cooldown", cooldownPass, cooldownReason);

  // 5. confidence gate — only execute if AI confidence meets threshold
  const rawConf = (decision.match(/CONFIDENCE:\s*(\w+)/i)?.[1] || "low").toLowerCase();
  const actualConf = confidenceLevels.includes(rawConf) ? rawConf : "low";
  const minIdx = confidenceLevels.indexOf(policy.minConfidence);
  const actualIdx = confidenceLevels.indexOf(actualConf);
  check(
    "confidence_gate",
    actualIdx >= minIdx,
    `confidence ${actualConf} ${actualIdx >= minIdx ? ">=" : "<"} required ${policy.minConfidence}`
  );

  // 6. verdict gate — VERDICT: BUY must be present to execute
  const hasBuy = decision.includes("VERDICT: BUY");
  check(
    "verdict_gate",
    !policy.requireBuyVerdict || hasBuy,
    hasBuy ? "VERDICT: BUY confirmed" : "VERDICT: BUY not found — execution blocked"
  );

  // format policy report
  const lines = [
    `policy evaluation: ${checks.length} checks`,
    `timestamp: ${new Date().toISOString()}`,
    "",
  ];
  for (const c of checks) {
    lines.push(`${c.pass ? "✓" : "✗"} ${c.name}: ${c.reason}`);
  }
  lines.push("");
  lines.push(blocked ? `result: BLOCKED by ${blocked}` : "result: APPROVED — all checks passed");

  return {
    content: lines.join("\n"),
    approved: !blocked,
    blocked,
    checks,
  };
}

// ── policy config serialization ───────────────────────────────────────────────
function serializePolicy() {
  return [
    `policy_config v1`,
    `timestamp: ${new Date().toISOString()}`,
    `wallet: ${wallet}`,
    `chain: ${chain}`,
    ``,
    `maxSpendUsdc: ${policy.maxSpendUsdc}`,
    `allowedTokens: ${policy.allowedTokens.join(", ")}`,
    `allowedChains: ${policy.allowedChains.join(", ")}`,
    `cooldownMinutes: ${policy.cooldownMinutes}`,
    `minConfidence: ${policy.minConfidence}`,
    `requireBuyVerdict: ${policy.requireBuyVerdict}`,
  ].join("\n");
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

  const entries = logs.filter(e => e.prompt.startsWith("proof-of-agent:"));
  if (entries.length === 0) {
    console.log("no proof-of-agent entries yet.");
    return;
  }

  // group by session — session starts at market_data, ends at execution
  let session = 1;
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

// ── run: fetch, decide, policy check, execute, commit every step ──────────────
async function run() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log("proof of agent — run starting\n");

  // ows wallet — show addresses across chains
  console.log("ows wallet:");
  console.log(ows("wallet list").split("\n").slice(0, 3).join("\n"));
  const ethAddr = owsAddress("ethereum");
  const solAddr = owsAddress("solana");
  if (ethAddr) console.log(`  eth address: ${ethAddr}`);
  if (solAddr) console.log(`  sol address: ${solAddr}`);

  // load last session for cooldown check
  let lastSession = null;
  try {
    if (fs.existsSync("last-session.json")) {
      lastSession = JSON.parse(fs.readFileSync("last-session.json"));
    }
  } catch {}

  // ── step 0: policy config — agent declares constraints before acting ───────
  console.log("\ndeclaring policy config...");
  const policyConfig = serializePolicy();
  console.log(policyConfig);
  console.log("\ncommitting to chain...");
  const s0 = await commit("policy_config", policyConfig);

  // ── step 1: market data ────────────────────────────────────────────────────
  console.log("\nfetching market data...");
  const trending = mp(`token trending list --chain ${chain} --page 1 --limit 3`);
  const solData = mp(`token retrieve --chain solana --token ${sol}`);

  let ethData = "";
  try { ethData = mp(`token retrieve --chain ethereum --token ${eth}`); }
  catch { ethData = "unavailable"; }

  let portfolio = "";
  try { portfolio = mp(`portfolio show --wallet ${wallet}`); }
  catch {
    try { portfolio = mp(`token balance list --wallet ${wallet} --chain ${chain}`); }
    catch { portfolio = "unfunded"; }
  }

  const market = [
    `trending:\n${trending.substring(0, 600)}`,
    `sol:\n${solData.substring(0, 300)}`,
    `eth:\n${ethData.substring(0, 200)}`,
    `portfolio: ${portfolio.substring(0, 300)}`,
  ].join("\n\n");

  console.log(solData.split("\n").slice(0, 5).join("\n"));
  console.log("\ncommitting to chain...");
  const s1 = await commit("market_data", market);

  // ── step 2: ai decision ────────────────────────────────────────────────────
  console.log("\nasking the agent...");
  const prompt = [
    "you are a DCA agent. here is the current market state:",
    "",
    market,
    "",
    `should i DCA $${amount} USDC into SOL right now? consider SOL price, ETH trend, portfolio balance, and trending tokens.`,
    "",
    "reply with:",
    "VERDICT: BUY or SKIP",
    "REASONING: 2-3 sentences",
    "CONFIDENCE: low / medium / high",
    "ACTION: execute_dca or skip_cycle",
  ].join("\n");

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

  // ── step 3: policy check ───────────────────────────────────────────────────
  console.log("\nrunning policy checks...");
  const policyResult = runPolicy(decision, lastSession);
  console.log("\n" + policyResult.content);
  console.log("\ncommitting to chain...");
  const s3 = await commit("policy_check", policyResult.content);

  // ── step 4: execution ──────────────────────────────────────────────────────
  console.log("\nexecuting...");
  let execution = "";

  if (!policyResult.approved) {
    execution = `blocked — policy: ${policyResult.blocked}`;
    console.log(execution);
  } else if (decision.includes("ACTION: execute_dca")) {
    try {
      execution = mp(`token swap --wallet ${wallet} --chain ${chain} --from-token ${usdc} --from-amount ${amount} --to-token ${sol}`);
      console.log(execution);
    } catch (e) {
      execution = `swap attempted — ${e.message.split("\n")[0]}`;
      console.log(execution);
    }
  } else {
    execution = "skipped — agent chose skip_cycle";
    console.log("agent skipped this cycle");
  }

  console.log("\ncommitting to chain...");
  const s4 = await commit("execution", execution);

  // save session
  const session = {
    ts: new Date().toISOString(),
    steps: {
      policy_config: { txHash: s0.txHash, outputHash: s0.outputHash, content: s0.content, signature: s0.signature },
      market_data:   { txHash: s1.txHash, outputHash: s1.outputHash, content: s1.content, signature: s1.signature },
      decision:      { txHash: s2.txHash, outputHash: s2.outputHash, content: s2.content, signature: s2.signature },
      policy_check:  { txHash: s3.txHash, outputHash: s3.outputHash, content: s3.content, signature: s3.signature },
      execution:     { txHash: s4.txHash, outputHash: s4.outputHash, content: s4.content, signature: s4.signature },
    }
  };
  fs.writeFileSync("last-session.json", JSON.stringify(session, null, 2));

  // summary
  console.log("\n── proof of agent ──────────────────────────");
  console.log("every step is now permanently onchain.");
  console.log("session saved to last-session.json\n");
  console.log("policy_config tx: ", s0.txHash);
  console.log("market_data tx:   ", s1.txHash);
  console.log("decision tx:      ", s2.txHash);
  console.log("policy_check tx:  ", s3.txHash);
  console.log("execution tx:     ", s4.txHash);
  console.log(`\npolicy result:   ${policyResult.approved ? "APPROVED" : `BLOCKED (${policyResult.blocked})`}`);
  if (s2.signature) {
    console.log(`ows signed on:   ${Object.keys(s2.signature).join(", ")}`);
    if (ethAddr) console.log(`ows eth address: ${ethAddr}`);
    if (solAddr) console.log(`ows sol address: ${solAddr}`);
  }
  console.log("\nto verify:");
  console.log(`  node agent.js verify policy_config ${s0.txHash}`);
  console.log(`  node agent.js verify decision ${s2.txHash}`);
  console.log(`  node agent.js verify policy_check ${s3.txHash}`);
  console.log("────────────────────────────────────────────");
}

// ── verify: prove content matches an onchain hash ────────────────────────────
async function verify() {
  const step = process.argv[3] || "decision";
  const txHash = process.argv[4];

  if (!fs.existsSync("last-session.json")) {
    console.log("no session found. run the agent first.");
    return;
  }

  const session = JSON.parse(fs.readFileSync("last-session.json"));
  const entry = session.steps[step];
  if (!entry) {
    console.log(`unknown step "${step}". use: policy_config, market_data, decision, policy_check, or execution`);
    return;
  }

  const content = entry.content;
  const hash = txHash || entry.txHash;
  console.log(`verifying step: ${step}`);
  console.log(`tx: ${hash}\n`);

  const computed = ethers.keccak256(ethers.toUtf8Bytes(content));
  console.log("computed hash:", computed);

  const provider = new ethers.JsonRpcProvider(rpc);
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) {
    console.log("tx not found on chain:", hash);
    return;
  }

  const contract = new ethers.Contract(logAddress, logAbi, provider);
  const logs = await contract.getLogs();
  const match = logs.find(e => e.outputHash === computed);

  if (match) {
    console.log("✓ verified — this content was committed onchain");
    console.log("  step:      ", match.prompt.replace("proof-of-agent:", ""));
    console.log("  agent:     ", match.agent);
    console.log("  timestamp: ", new Date(Number(match.timestamp) * 1000).toISOString());
    console.log("  hash:      ", computed);
  } else {
    console.log("✗ not verified — hash not found onchain");
    console.log("  content was tampered with, or this tx is not a proof-of-agent log");
    console.log("\n  to demo tampering, edit last-session.json and change one word, then re-run verify");
  }
}

// ── watch: run autonomously on a loop ─────────────────────────────────────────
async function watch() {
  const intervalMin = parseInt(process.argv[3]) || 30;
  const intervalMs = intervalMin * 60 * 1000;

  console.log(`proof of agent — watch mode (every ${intervalMin} min)\n`);
  console.log("ctrl+c to stop\n");

  let cycle = 1;
  while (true) {
    console.log(`\n══ cycle ${cycle} ── ${new Date().toISOString()} ══`);
    try {
      await run();
    } catch (e) {
      console.error(`cycle ${cycle} error: ${e.message}`);
    }
    cycle++;
    console.log(`\nnext cycle in ${intervalMin} min...`);
    await new Promise(res => setTimeout(res, intervalMs));
  }
}

const mode = process.argv[2];
if (mode === "replay") {
  replay().catch((e) => { console.error(e.message); process.exit(1); });
} else if (mode === "verify") {
  verify().catch((e) => { console.error(e.message); process.exit(1); });
} else if (mode === "watch") {
  watch().catch((e) => { console.error(e.message); process.exit(1); });
} else {
  run().catch((e) => { console.error(e.message); process.exit(1); });
}
