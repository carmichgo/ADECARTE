import { NextRequest, NextResponse } from "next/server";
import { getSupabase, fetchAll } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const { instructions, context } = await req.json().catch(() => ({}));
  const db = getSupabase();

  // Get transactions with empty beneficiary
  const allTxns = await fetchAll("transactions", "id, description, amount, counterparty, direction, account, account_name, symbol, security, beneficiary, reference");
  const empty = allTxns.filter(t => !t.beneficiary || t.beneficiary === "");

  if (empty.length === 0) {
    return NextResponse.json({ message: "All transactions already have beneficiaries", extracted: 0 });
  }

  // Get examples of transactions that DO have beneficiaries
  const examples = allTxns.filter(t => t.beneficiary && t.beneficiary !== "").slice(0, 20);

  const client = new Anthropic({ apiKey });
  const batchSize = 30;
  const maxPerCall = 100;
  let totalExtracted = 0;

  for (let i = 0; i < Math.min(empty.length, maxPerCall); i += batchSize) {
    const batch = empty.slice(i, i + batchSize);
    const txnList = batch.map(t => ({
      id: t.id, description: t.description, amount: t.amount,
      counterparty: t.counterparty, direction: t.direction,
      account: t.account || t.account_name, symbol: t.symbol,
      security: t.security, reference: t.reference,
    }));

    const exampleText = examples.length > 0
      ? `\n## EXAMPLES (transactions where beneficiary was identified)\n${JSON.stringify(examples.slice(0, 10).map(e => ({ description: e.description, counterparty: e.counterparty, beneficiary: e.beneficiary })), null, 2)}\n`
      : "";

    const prompt = `You are a forensic accountant identifying the ultimate beneficiary of each transaction — the person or entity whose money is being moved or who is affected.
${context ? `\n## INVESTIGATION BACKGROUND\n${context}\n` : ""}${instructions ? `\n## INSTRUCTIONS\n${instructions}\n` : ""}${exampleText}
## RULES
- The BENEFICIARY is the person/entity whose money this is, or who is ultimately affected
- This is DIFFERENT from the counterparty (the firm/bank executing the transfer)
- Look for names in: REF fields, B/O (by order of), FBO (for benefit of), memo fields
- Example: "WIRE FROM ACME LAW FIRM REF: JOHN DOE" → beneficiary = "John Doe"
- Example: "Transfer of Funds From Account 0002 To 741713181" → beneficiary could be the account holder
- For stock trades: beneficiary = the account holder
- For internal transfers: beneficiary = the account owner
- If the counterparty IS the beneficiary (direct transaction), set beneficiary = same as counterparty
- If truly cannot determine, set beneficiary = "" (empty string)
- Normalize names: proper case, consistent format

## TRANSACTIONS
${JSON.stringify(txnList, null, 2)}

Respond with ONLY a JSON array:
[{"id": number, "beneficiary": "name or empty string"}]`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      let text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
      if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n").replace(/```\s*$/, "");
      const results = JSON.parse(text);

      for (const r of results) {
        if (r.beneficiary) {
          await db.from("transactions").update({ beneficiary: r.beneficiary }).eq("id", r.id);
          totalExtracted++;
        }
      }
    } catch (err) {
      console.error("Beneficiary extraction error:", err);
      continue;
    }
  }

  return NextResponse.json({
    message: `Identified beneficiaries for ${totalExtracted} of ${Math.min(empty.length, maxPerCall)} transactions (${empty.length} total empty).`,
    extracted: totalExtracted,
    remaining: empty.length - Math.min(empty.length, maxPerCall),
    done: empty.length <= maxPerCall,
  });
}
