import { NextRequest, NextResponse } from "next/server";
import { fetchAll } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { transactionId, context, mode } = await req.json();
  // mode: "trace" (single transaction) or "sankey" (full flow map)

  const allTxns = await fetchAll("transactions", "id, date, amount, direction, account, account_name, bank, ext_bank, description, counterparty, beneficiary, category, flag, match_group");
  const active = allTxns.filter(t => t.flag !== "disqualified");

  if (mode === "sankey") {
    return buildSankeyData(active);
  }

  if (mode === "trace" && transactionId) {
    return traceTransaction(active, transactionId, context);
  }

  return NextResponse.json({ error: "Invalid mode. Use 'trace' or 'sankey'" }, { status: 400 });
}

function buildSankeyData(txns: any[]) {
  // Build flow: Source Accounts → Hub Accounts → External Destinations
  const flowMap: Record<string, { from: string; to: string; amount: number; count: number }> = {};

  // Withdrawals going to external entities
  for (const t of txns) {
    if (t.flag === "disqualified") continue;
    const amount = Math.abs(t.amount || 0);
    if (amount === 0) continue;

    const dir = (t.direction || "").toLowerCase();
    const acct = `${t.account || ""} (${t.bank || ""})`;

    if (dir === "withdraw" && amount > 0) {
      const dest = t.counterparty || t.ext_bank || "Unknown";
      const key = `${acct}→${dest}`;
      if (!flowMap[key]) flowMap[key] = { from: acct, to: dest, amount: 0, count: 0 };
      flowMap[key].amount += amount;
      flowMap[key].count++;
    }

    if (dir === "contribution" && amount > 0) {
      const source = t.counterparty || t.ext_bank || "Unknown";
      const key = `${source}→${acct}`;
      if (!flowMap[key]) flowMap[key] = { from: source, to: acct, amount: 0, count: 0 };
      flowMap[key].amount += amount;
      flowMap[key].count++;
    }
  }

  // Get top flows by amount
  const allFlows = Object.values(flowMap).sort((a, b) => b.amount - a.amount);

  // Group by node for the Sankey
  const nodes = new Set<string>();
  allFlows.forEach(f => { nodes.add(f.from); nodes.add(f.to); });

  return NextResponse.json({
    flows: allFlows.slice(0, 50),
    nodes: [...nodes],
    total_flows: allFlows.length,
  });
}

function traceTransaction(txns: any[], txnId: number, context?: string) {
  const target = txns.find(t => t.id === txnId);
  if (!target) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const absAmount = Math.abs(target.amount || 0);
  const targetDate = new Date(target.date);
  const targetAccount = target.account || "";
  const targetBank = target.bank || "";

  // Build the chain
  const chain: any = {
    source: null,
    hub: { ...target, role: "origin" },
    destinations: [],
  };

  // If this is an outflow, find where the money came from
  if ((target.amount || 0) < 0 || (target.direction || "").toLowerCase() === "withdraw") {
    chain.hub.role = "outflow";

    // Find matching inflow in same account (within 3 days before)
    const inflow = txns.find(t =>
      t.id !== txnId &&
      t.account === targetAccount &&
      (t.amount || 0) > 0 &&
      Math.abs(Math.abs(t.amount) - absAmount) < absAmount * 0.05 &&
      Math.abs(new Date(t.date).getTime() - targetDate.getTime()) < 3 * 24 * 60 * 60 * 1000 &&
      new Date(t.date).getTime() <= targetDate.getTime()
    );
    if (inflow) chain.source = { ...inflow, role: "source_deposit" };

    // Find the original source (different bank, same amount, before the inflow)
    if (inflow) {
      const original = txns.find(t =>
        t.id !== inflow.id &&
        t.account !== targetAccount &&
        (t.amount || 0) < 0 &&
        Math.abs(Math.abs(t.amount) - absAmount) < absAmount * 0.05 &&
        Math.abs(new Date(t.date).getTime() - new Date(inflow.date).getTime()) < 5 * 24 * 60 * 60 * 1000
      );
      if (original) chain.source = { ...original, role: "original_source" };
    }
  }

  // If this is an inflow, find where the money went
  if ((target.amount || 0) > 0 || (target.direction || "").toLowerCase() === "contribution") {
    chain.hub.role = "inflow";

    // Find outflows from same account within 7 days after
    const outflows = txns.filter(t =>
      t.id !== txnId &&
      t.account === targetAccount &&
      (t.amount || 0) < 0 &&
      t.flag !== "disqualified" &&
      new Date(t.date).getTime() >= targetDate.getTime() &&
      new Date(t.date).getTime() - targetDate.getTime() < 7 * 24 * 60 * 60 * 1000
    ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Find outflows that could have been funded by this deposit
    let remaining = absAmount;
    for (const out of outflows) {
      if (remaining <= 0) break;
      const outAmt = Math.abs(out.amount || 0);
      if (outAmt <= remaining * 1.1) { // Allow 10% tolerance
        chain.destinations.push({ ...out, role: "outflow", allocated: Math.min(outAmt, remaining) });
        remaining -= outAmt;
      }
    }

    // Also check if there's a matched transaction from another bank
    if (target.match_group) {
      const matched = txns.filter(t => t.match_group === target.match_group && t.id !== txnId);
      if (matched.length > 0) {
        chain.source = { ...matched[0], role: "cross_bank_source" };
      }
    }
  }

  // Also check match_group for the target itself
  if (target.match_group && !chain.source) {
    const matched = txns.filter(t => t.match_group === target.match_group && t.id !== txnId);
    if (matched.length > 0) {
      const match = matched[0];
      if ((match.amount || 0) < 0) chain.source = { ...match, role: "cross_bank_source" };
      else chain.destinations.push({ ...match, role: "cross_bank_dest" });
    }
  }

  return NextResponse.json({
    chain,
    target_amount: absAmount,
    destinations_total: chain.destinations.reduce((s: number, d: any) => s + Math.abs(d.amount || 0), 0),
    unaccounted: absAmount - chain.destinations.reduce((s: number, d: any) => s + Math.abs(d.amount || 0), 0),
  });
}
