import { NextRequest, NextResponse } from "next/server";
import { getSupabase, fetchAll } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const { instructions, context } = await req.json().catch(() => ({}));
  const db = getSupabase();

  // Get manual examples
  const { data: manual } = await db
    .from("transactions")
    .select("description, amount, counterparty, category, subcategory, flag, direction")
    .eq("categorized_by", "manual")
    .neq("category", "")
    .limit(20);

  if (!manual || manual.length < 1) {
    return NextResponse.json({ error: "Need at least 1 manually categorized transaction as example." }, { status: 400 });
  }

  // Get ALL transactions, filter uncategorized client-side (same logic as stats)
  const cols = "id, description, amount, counterparty, reference, date, symbol, security, direction, account, account_name, strategy, category, flag, categorized_by";
  const allTxns = await fetchAll("transactions", cols);
  const uncategorized = allTxns.filter(t => (!t.category || t.category === "") && t.flag !== "disqualified");

  if (uncategorized.length === 0) {
    return NextResponse.json({ message: "All transactions are already categorized", preview: [] });
  }

  // Pre-match: for M61750002 credit memos, find matching Loan Adela entries
  const loanAdelaTxns = allTxns.filter(t => (t.account || "").toLowerCase().includes("loan adela") || (t.account_name || "").toLowerCase().includes("loan adela"));
  const matchContext: Record<number, string> = {};

  for (const txn of uncategorized) {
    const acct = (txn.account || "").toUpperCase();
    const desc = (txn.description || "").toUpperCase();
    if (acct.includes("M61750002") && (desc.includes("CREDIT MEMORANDUM") || desc.includes("ADVANCE ON LOAN"))) {
      // Find matching Loan Adela entry by amount and close date
      const absAmount = Math.abs(txn.amount || 0);
      const match = loanAdelaTxns.find(la => {
        const laAmount = Math.abs(la.amount || 0);
        const amountMatch = Math.abs(laAmount - absAmount) < 1; // within $1
        const dateClose = txn.date === la.date || Math.abs(new Date(txn.date).getTime() - new Date(la.date).getTime()) < 3 * 24 * 60 * 60 * 1000; // within 3 days
        return amountMatch && dateClose;
      });
      if (match) {
        matchContext[txn.id] = `MATCHED LOAN ADELA ENTRY: "${match.description}" (amount: ${match.amount}, date: ${match.date}). Use this to determine if money went to our account or external.`;
      }
    }
  }

  // Process max 100 at a time to avoid timeout
  const toProcess = uncategorized.slice(0, 100);

  // Get categories
  const { data: categories } = await db.from("categories").select("name, description, is_suspicious");

  const examples = manual.map(m => ({
    description: m.description, amount: m.amount, counterparty: m.counterparty,
    category: m.category, direction: m.direction,
    ...(m.flag ? { flag: m.flag } : {}),
  }));

  const categoryList = (categories || []).map(c =>
    `- ${c.name}: ${c.description}${c.is_suspicious ? " [SUSPICIOUS]" : ""}`
  ).join("\n");

  const client = new Anthropic({ apiKey });
  const batchSize = 25;
  const allResults: any[] = [];
  const errors: string[] = [];

  for (let i = 0; i < toProcess.length; i += batchSize) {
    const batch = toProcess.slice(i, i + batchSize);
    const txnList = batch.map(t => ({
      id: t.id, desc: (t.description || "").slice(0, 80), amount: t.amount,
      cp: t.counterparty, dir: t.direction, date: t.date,
      acct: t.account || t.account_name, sym: t.symbol,
      ...(matchContext[t.id] ? { loan_match: matchContext[t.id] } : {}),
    }));

    const prompt = `You are a forensic accountant investigating potential financial fraud.
${context ? `\n## INVESTIGATION BACKGROUND\n${context}\n` : ""}${instructions ? `\n## INVESTIGATOR INSTRUCTIONS\n${instructions}\n` : ""}
## AVAILABLE CATEGORIES
${categoryList}

## EXAMPLES (${examples.length} manually categorized)
${JSON.stringify(examples.slice(0, 10).map(e => ({ desc: (e.description || "").slice(0, 60), amount: e.amount, cat: e.category, dir: e.direction, flag: e.flag })), null, 2)}

## TRANSACTIONS TO CATEGORIZE
${JSON.stringify(txnList, null, 2)}

For each transaction, respond with a JSON array where each element has:
- "id": transaction id
- "category": exact category name
- "subcategory": optional label
- "flag": "normal" | "review" | "suspicious" | "critical" | "disqualified"
- "confidence": 0.0-1.0
- "reasoning": brief explanation

CRITICAL RULES FOR M61750002 (JPM Brokerage — PASS-THROUGH account):
M61750002 is a pass-through. Money enters and exits. Same amount appears positive then negative within 1-2 days. Do NOT double-count.

- CREDIT MEMORANDUM on M61750002 (positive) → flag = "disqualified". Funding side only. Real outflow is the paired FX SPOT/wire.
- FX SPOT CURRENCY on M61750002 (negative) → "LOC External Transfer", flag "critical". This is the REAL outflow.
- FOREIGN CASH / MXN DELD / EUR DELD on M61750002 (positive) → flag = "disqualified". FX delivery record, misleading positive amount.
- PAYMENTS "WIRE TO" on M61750002 (negative) → "LOC External Transfer" if external, "Internal Transfer" if to our accounts.
- PAYMENTS "FUNDS TRANSFERRED" on M61750002 → "Internal Transfer" if both accounts are ours.
- SECURITY PENDING / TIME DEPOSITS → "Time Deposit".
- DEBIT MEMORANDUM on M61750002 → "LOC Interest Payment".

OTHER RULES:
- "Line of Credit" = ONLY for "Loan Adela" account. NEVER for M61750002.
- "LOC Funded Deposit" = ONLY on our INVESTMENT accounts (NOT M61750002) when description mentions loan/advance.
- If transaction has "loan_match" field → read it to understand where loan money went.

Do NOT include "direction" in the response — direction will not be changed.
Be aggressive about flagging suspicious transactions. ALL LOC-related = "suspicious" or "critical", NEVER "normal".
Respond with ONLY the JSON array.`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      let text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
      if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n").replace(/```\s*$/, "");

      let results;
      try {
        results = JSON.parse(text);
      } catch (parseErr) {
        errors.push(`Batch ${i}: JSON parse failed — response starts with: ${text.slice(0, 100)}`);
        continue;
      }

      if (!Array.isArray(results)) {
        errors.push(`Batch ${i}: AI returned non-array: ${JSON.stringify(results).slice(0, 100)}`);
        continue;
      }

      // Attach original transaction data for preview
      for (const r of results) {
        const orig = toProcess.find(t => t.id === r.id);
        if (orig) {
          allResults.push({
            ...r,
            original: {
              description: orig.description,
              amount: orig.amount,
              date: orig.date,
              counterparty: orig.counterparty,
              beneficiary: orig.beneficiary,
              direction: orig.direction,
              category: orig.category,
              flag: orig.flag,
              account: orig.account || orig.account_name,
              symbol: orig.symbol,
              security: orig.security,
            },
          });
        }
      }
    } catch (err: any) {
      errors.push(`Batch ${i}: ${err.message || String(err)}`);
      continue;
    }
  }

  return NextResponse.json({
    message: `AI generated ${allResults.length} proposals (${uncategorized.length} total uncategorized, processing ${toProcess.length} per run)${errors.length > 0 ? `. Errors: ${errors.join("; ")}` : ""}`,
    preview: allResults,
  });
}
