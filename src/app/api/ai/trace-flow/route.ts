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
  const DAY = 24 * 60 * 60 * 1000;

  // Find candidates matching by amount (±5%), within N days, with given sign
  const findCandidates = (amount: number, date: Date, sign: "positive" | "negative", withinDays: number, preferAccount?: "same" | "different", refAccount?: string) => {
    return txns.filter(t => {
      if (usedIds.has(t.id)) return false;
      if (t.flag === "disqualified") return false;
      const tAmt = Math.abs(t.amount || 0);
      if (tAmt === 0) return false;
      if (Math.abs(tAmt - amount) > amount * 0.05) return false;
      const daysDiff = Math.abs(new Date(t.date).getTime() - date.getTime()) / DAY;
      if (daysDiff > withinDays) return false;
      if (sign === "positive" && (t.amount || 0) <= 0) return false;
      if (sign === "negative" && (t.amount || 0) >= 0) return false;
      return true;
    }).sort((a, b) => {
      const acct = refAccount || target.account;
      // Primary: prefer the right account relationship
      if (preferAccount === "different") {
        const aMatch = a.account !== acct ? 0 : 1;
        const bMatch = b.account !== acct ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      } else if (preferAccount === "same") {
        const aMatch = a.account === acct ? 0 : 1;
        const bMatch = b.account === acct ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      // Secondary: closest date
      return Math.abs(new Date(a.date).getTime() - date.getTime()) - Math.abs(new Date(b.date).getTime() - date.getTime());
    });
  };

  // Find FX delivery (FOREIGN CASH / MXN DELD / EUR DELD) paired with an FX SPOT
  const findFxDelivery = (fxSpot: any) => {
    const fxDate = new Date(fxSpot.date);
    // Look in ALL txns including disqualified (delivery records are disqualified)
    return txns.find(t =>
      !usedIds.has(t.id) &&
      t.account === fxSpot.account &&
      (t.amount || 0) > 0 &&
      Math.abs(new Date(t.date).getTime() - fxDate.getTime()) < 3 * DAY &&
      ((t.description || "").toUpperCase().includes("MXN DELD") ||
       (t.description || "").toUpperCase().includes("EUR DELD") ||
       (t.description || "").toUpperCase().includes("FOREIGN CASH"))
    );
  };

  // ── TRACE BACKWARD: where did the money come from? ──
  // Follow the chain: if current is positive (inflow), find the negative (outflow) that sent it
  // If current is negative (outflow), find the positive (inflow) that funded it on same account
  const backwardChain: any[] = [];
  let current = target;
  for (let i = 0; i < 10; i++) {
    const curDate = new Date(current.date);
    const curAmt = Math.abs(current.amount || 0);
    const isPositive = (current.amount || 0) > 0;

    if (isPositive) {
      // This is a deposit — find the outflow (negative) that sent it, prefer DIFFERENT account, on or before this date
      const candidates = findCandidates(curAmt, curDate, "negative", 5, "different", current.account)
        .filter(t => new Date(t.date).getTime() <= curDate.getTime() + DAY);
      if (candidates.length === 0) break;
      const match = candidates[0];
      usedIds.add(match.id);
      backwardChain.unshift({ ...match, step: -(i + 1), role: "source" });
      current = match;
    } else {
      // This is an outflow — find the inflow (positive) that funded it on SAME account, on or before this date
      const candidates = findCandidates(curAmt, curDate, "positive", 5, "same", current.account)
        .filter(t => new Date(t.date).getTime() <= curDate.getTime() + DAY);
      if (candidates.length === 0) break;
      const match = candidates[0];
      usedIds.add(match.id);
      backwardChain.unshift({ ...match, step: -(i + 1), role: "source" });
      current = match;
    }
  }

  // ── TRACE FORWARD: where did the money go? ──
  // Follow the chain: if current is negative (outflow), find the positive (inflow) that received it
  // If current is positive (inflow), find the negative (outflow) from same account that sent it onward
  const forwardChain: any[] = [];
  current = target;
  for (let i = 0; i < 10; i++) {
    const curDate = new Date(current.date);
    const curAmt = Math.abs(current.amount || 0);
    const isNegative = (current.amount || 0) < 0;

    if (isNegative) {
      // This is an outflow — find where it landed (positive, DIFFERENT account, on or after)
      const candidates = findCandidates(curAmt, curDate, "positive", 5, "different", current.account)
        .filter(t => new Date(t.date).getTime() >= curDate.getTime() - DAY);
      if (candidates.length === 0) break;
      const match = candidates[0];
      usedIds.add(match.id);
      forwardChain.push({ ...match, step: i + 1, role: "forward" });
      current = match;
    } else {
      // This is an inflow — find the outflow (negative) from SAME account that sent it onward
      const candidates = findCandidates(curAmt, curDate, "negative", 5, "same", current.account)
        .filter(t => new Date(t.date).getTime() >= curDate.getTime() - DAY);

      if (candidates.length > 0) {
        const match = candidates[0];
        usedIds.add(match.id);
        forwardChain.push({ ...match, step: i + 1, role: "forward" });
        current = match;

        // If this is an FX SPOT, attach the delivery record
        const desc = (match.description || "").toUpperCase();
        if (desc.includes("SPOT CURRENCY") || desc.includes("FX SPOT")) {
          const delivery = findFxDelivery(match);
          if (delivery) {
            usedIds.add(delivery.id);
            forwardChain.push({ ...delivery, step: i + 1.5, role: "fx_delivery", note: "FX delivery — shows final recipient" });
          }
        }
      } else {
        // No single matching outflow — look for SPLITS (multiple smaller outflows from same account)
        const outflows = txns.filter(t => {
          if (usedIds.has(t.id) || t.flag === "disqualified") return false;
          if (t.account !== current.account) return false;
          if ((t.amount || 0) >= 0) return false;
          const tDate = new Date(t.date);
          return tDate.getTime() >= curDate.getTime() - DAY && (tDate.getTime() - curDate.getTime()) < 7 * DAY;
        }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)); // largest first

        let remaining = curAmt;
        const splits: any[] = [];
        for (const out of outflows) {
          if (remaining <= 0) break;
          const outAmt = Math.abs(out.amount || 0);
          if (outAmt <= remaining * 1.1) {
            usedIds.add(out.id);
            const split = { ...out, step: i + 1, role: "split" };
            splits.push(split);
            remaining -= outAmt;

            // Check for FX delivery on each split
            const desc = (out.description || "").toUpperCase();
            if (desc.includes("SPOT CURRENCY") || desc.includes("FX SPOT")) {
              const delivery = findFxDelivery(out);
              if (delivery) {
                usedIds.add(delivery.id);
                splits.push({ ...delivery, step: i + 1.5, role: "fx_delivery", note: "FX delivery — shows final recipient" });
              }
            }
          }
        }
        forwardChain.push(...splits);
        break;
      }
    }
  }

  const chain = [...backwardChain, { ...target, step: 0, role: "start" }, ...forwardChain];

  return NextResponse.json({
    chain,
    target_id: txnId,
    target_amount: absAmount,
    chain_length: chain.length,
  });
}
