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
  const usedIds = new Set<number>([txnId]);

  // Find matching transaction: same absolute amount (±5%), within N days, on any account
  const findMatch = (amount: number, date: Date, sign: "positive" | "negative" | "any", withinDays: number) => {
    return txns.filter(t => {
      if (usedIds.has(t.id)) return false;
      if (t.flag === "disqualified") return false;
      const tAmt = Math.abs(t.amount || 0);
      if (Math.abs(tAmt - amount) > amount * 0.05) return false;
      const daysDiff = Math.abs(new Date(t.date).getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > withinDays) return false;
      if (sign === "positive" && (t.amount || 0) <= 0) return false;
      if (sign === "negative" && (t.amount || 0) >= 0) return false;
      return true;
    }).sort((a, b) => {
      // Prefer different account, then closest date
      const aDiff = a.account !== target.account ? 0 : 1;
      const bDiff = b.account !== target.account ? 0 : 1;
      if (aDiff !== bDiff) return aDiff - bDiff;
      return Math.abs(new Date(a.date).getTime() - date.getTime()) - Math.abs(new Date(b.date).getTime() - date.getTime());
    });
  };

  // Build chain: start from target, trace backward and forward
  const chain: any[] = [{ ...target, step: 0, role: "start" }];

  // TRACE FORWARD from target: follow where money went
  // If target is negative (outflow), the next step is a positive (inflow) somewhere
  // If target is positive (inflow), the next step is a negative (outflow) from same/diff account
  let current = target;
  for (let i = 0; i < 10; i++) {
    const curDate = new Date(current.date);
    const curAmt = Math.abs(current.amount || 0);
    const isNeg = (current.amount || 0) < 0;

    // Money left (negative) → find where it arrived (positive, different account preferred)
    // Money arrived (positive) → find where it left (negative, same account preferred)
    const nextSign = isNeg ? "positive" : "negative";
    const candidates = findMatch(curAmt, curDate, nextSign, 5);

    if (candidates.length > 0) {
      const match = candidates[0];
      usedIds.add(match.id);
      chain.push({ ...match, step: i + 1, role: "forward" });
      current = match;
    } else {
      // For inflows, also look for split outflows (multiple smaller outflows)
      if (!isNeg) {
        const outflows = txns.filter(t => {
          if (usedIds.has(t.id) || t.flag === "disqualified") return false;
          if (t.account !== current.account) return false;
          if ((t.amount || 0) >= 0) return false;
          const tDate = new Date(t.date);
          return tDate.getTime() >= curDate.getTime() && (tDate.getTime() - curDate.getTime()) < 7 * 24 * 60 * 60 * 1000;
        }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let remaining = curAmt;
        for (const out of outflows) {
          if (remaining <= 0) break;
          const outAmt = Math.abs(out.amount || 0);
          if (outAmt <= remaining * 1.1) {
            usedIds.add(out.id);
            chain.push({ ...out, step: i + 1, role: "split" });
            remaining -= outAmt;
          }
        }
      }
      break;
    }
  }

  // TRACE BACKWARD from target: follow where money came from
  current = target;
  for (let i = 0; i < 10; i++) {
    const curDate = new Date(current.date);
    const curAmt = Math.abs(current.amount || 0);
    const isNeg = (current.amount || 0) < 0;

    // Money arrived (positive) → find where it came from (negative, different account preferred)
    // Money left (negative) → find what funded it (positive, same account preferred, before this date)
    const prevSign = isNeg ? "positive" : "negative";
    const candidates = findMatch(curAmt, curDate, prevSign, 5)
      .filter(t => new Date(t.date).getTime() <= curDate.getTime() + 24 * 60 * 60 * 1000); // allow 1 day after

    if (candidates.length > 0) {
      const match = candidates[0];
      usedIds.add(match.id);
      chain.unshift({ ...match, step: -(i + 1), role: "backward" });
      current = match;
    } else {
      break;
    }
  }

  return NextResponse.json({
    chain,
    target_id: txnId,
    target_amount: absAmount,
    chain_length: chain.length,
  });
}
