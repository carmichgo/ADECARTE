import { NextRequest, NextResponse } from "next/server";
import { getSupabase, fetchAll } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const { instructions, context } = await req.json().catch(() => ({}));
  const db = getSupabase();

  const allTxns = await fetchAll("transactions", "id, description, amount, counterparty, direction, account, account_name, bank, ext_bank, flag");
  const empty = allTxns.filter(t => (!t.ext_bank || t.ext_bank === "") && t.flag !== "disqualified");

  if (empty.length === 0) {
    return NextResponse.json({ message: "All transactions already have external bank set", extracted: 0 });
  }

  const examples = allTxns.filter(t => t.ext_bank && t.ext_bank !== "").slice(0, 15);

  const client = new Anthropic({ apiKey });
  const batchSize = 40;
  let totalExtracted = 0;

  for (let i = 0; i < Math.min(empty.length, 200); i += batchSize) {
    const batch = empty.slice(i, i + batchSize);
    const txnList = batch.map(t => ({
      id: t.id, desc: (t.description || "").slice(0, 100), amount: t.amount,
      cp: t.counterparty, dir: t.direction, bank: t.bank,
    }));

    const exampleText = examples.length > 0
      ? `\n## EXAMPLES\n${JSON.stringify(examples.slice(0, 8).map(e => ({ desc: (e.description || "").slice(0, 80), cp: e.counterparty, dir: e.direction, ext_bank: e.ext_bank })), null, 2)}\n`
      : "";

    const prompt = `Extract the EXTERNAL BANK from each transaction description.
${context ? `\n## CONTEXT\n${context}\n` : ""}${instructions ? `\n## INSTRUCTIONS\n${instructions}\n` : ""}${exampleText}
## RULES
- For WITHDRAWALS: identify the RECEIVING bank (where money went)
  * "WIRE TO WELLS FARGO BANK" → "Wells Fargo"
  * "MXN DELD TO BANCA MIFEL" → "Banca Mifel"
  * "TRANSFERRED BY WIRE TO BANK OF AMERICA" → "Bank of America"
  * "WIRE TO EVOLVE BANK & TRUST" → "Evolve Bank & Trust"
  * "MXN DELD TO BBVA MEXICO" → "BBVA Mexico"
  * "WIRE TO PNC BANK" → "PNC Bank"
  * "WIRE TO NORTHWEST BANK" → "Northwest Bank"
- For DEPOSITS: identify the ORIGINATING bank (where money came from)
  * "BOOK TRANSFER CREDIT B/O: [COMPANY] [CITY]" → the company's bank if identifiable
  * "FED WIRE FROM [BANK]" → that bank
- Use clean, proper case bank names
- If no bank identifiable, return ""
- The counterparty field may already contain the bank name — use it if applicable

## TRANSACTIONS
${JSON.stringify(txnList, null, 2)}

Respond with ONLY a JSON array: [{"id": number, "ext_bank": "bank name or empty"}]`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      let text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
      if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n").replace(/```\s*$/, "");
      const results = JSON.parse(text);

      for (const r of results) {
        if (r.ext_bank) {
          await db.from("transactions").update({ ext_bank: r.ext_bank }).eq("id", r.id);
          totalExtracted++;
        }
      }
    } catch (err) {
      console.error("Ext bank extraction error:", err);
      continue;
    }
  }

  return NextResponse.json({
    message: `Identified external banks for ${totalExtracted} of ${Math.min(empty.length, 200)} transactions (${empty.length} total empty). Run again for more.`,
    extracted: totalExtracted,
  });
}
