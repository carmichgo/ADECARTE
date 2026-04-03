import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const db = getSupabase();

  // Get transactions that don't have a counterparty yet
  const { data: txns, error } = await db
    .from("transactions")
    .select("id, description, amount, direction, account, account_name, symbol, security, raw_data")
    .or("counterparty.eq.,counterparty.is.null")
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!txns || txns.length === 0) {
    return NextResponse.json({ message: "All transactions already have counterparties identified", extracted: 0 });
  }

  // Also get transactions that DO have counterparties as examples
  const { data: examples } = await db
    .from("transactions")
    .select("description, counterparty, direction")
    .neq("counterparty", "")
    .limit(30);

  const client = new Anthropic({ apiKey });
  const batchSize = 40;
  let totalExtracted = 0;

  for (let i = 0; i < txns.length; i += batchSize) {
    const batch = txns.slice(i, i + batchSize);
    const txnList = batch.map(t => ({
      id: t.id,
      description: t.description,
      amount: t.amount,
      direction: t.direction,
      account: t.account_name || t.account,
      symbol: t.symbol,
      security: t.security,
    }));

    const exampleText = examples && examples.length > 0
      ? `\n## EXAMPLES (transactions where the counterparty was already identified)\n${JSON.stringify(examples.slice(0, 15), null, 2)}\n`
      : "";

    const prompt = `You are a forensic accountant analyzing financial transactions to identify the parties involved (who sent or received money).

For each transaction, extract:
1. **counterparty**: The other party in the transaction — who sent money to us, or who we sent money to. This could be a person, company, bank, exchange, or account.
2. **direction_label**: Whether this was "incoming" (money received/deposited) or "outgoing" (money sent/withdrawn)

## RULES
- Look at the description, account, symbol, security, and any available fields to identify the counterparty
- IMPORTANT: Parse structured descriptions carefully. Common patterns:
  * "BOOK TRANSFER CREDIT B/O: [COMPANY NAME] [CITY] [STATE] REF: [REFERENCE]" → counterparty = the company after "B/O:"
  * "WIRE TRANSFER FROM [NAME]" or "WIRE TRANSFER TO [NAME]" → counterparty = the name
  * "Transfer of Funds From [ACCOUNT] To [ACCOUNT]" → use account numbers to identify
  * "FED WIRE [DIRECTION] [NAME/COMPANY]" → counterparty = the name/company
  * "CHECK [NUMBER] [NAME]" → counterparty = the name
  * "ACH [CREDIT/DEBIT] [COMPANY]" → counterparty = the company
- When description has "B/O:" (by order of), the entity after it is the counterparty
- When description has "REF:" with a person's name, note it but the counterparty is usually the entity before REF
- If description is "-", empty, or generic, use the OTHER fields (symbol, security, account)
- For stock/securities trades: identify as "[Buy/Sell] [Symbol] - [Security Name]"
- Normalize names: "JOHN SMITH WIRE", "J. Smith Transfer", "SMITH JOHN" → "John Smith"
- For bank transfers, extract the bank or account holder name
- If you truly cannot determine the party, use "Unknown" but try your best
- Group similar parties under one canonical name
${exampleText}
## TRANSACTIONS TO ANALYZE
${JSON.stringify(txnList, null, 2)}

## RESPONSE FORMAT
Respond with ONLY a JSON array where each element has:
- "id": transaction id
- "counterparty": extracted party name (cleaned up, proper case)
- "direction_label": "incoming" or "outgoing"
- "confidence": 0.0-1.0

Respond with ONLY the JSON array, no other text.`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      let resultText = response.content[0].type === "text" ? response.content[0].text.trim() : "";
      if (resultText.startsWith("```")) {
        resultText = resultText.split("\n").slice(1).join("\n").replace(/```\s*$/, "");
      }

      const results = JSON.parse(resultText);

      for (const r of results) {
        const updates: Record<string, string> = {};
        if (r.counterparty) updates.counterparty = r.counterparty;
        if (r.direction_label && !batch.find(t => t.id === r.id)?.direction) {
          updates.direction = r.direction_label;
        }

        if (Object.keys(updates).length > 0) {
          await db.from("transactions").update(updates).eq("id", r.id);
          totalExtracted++;
        }
      }
    } catch (err) {
      console.error("AI party extraction error:", err);
      continue;
    }
  }

  return NextResponse.json({
    message: `Identified counterparties for ${totalExtracted} transactions`,
    extracted: totalExtracted,
  });
}
