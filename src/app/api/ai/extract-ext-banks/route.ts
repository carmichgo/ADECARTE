import { NextRequest, NextResponse } from "next/server";
import { getSupabase, fetchAll } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { instructions, context } = body;
  const db = getSupabase();

  // Fetch all transactions
  const allTxns = await fetchAll("transactions", "id, description, amount, counterparty, direction, account, account_name, bank, ext_bank, flag");
  const empty = allTxns.filter(t => (!t.ext_bank || t.ext_bank === "") && t.flag !== "disqualified");

  if (empty.length === 0) {
    return NextResponse.json({ message: "All transactions already have external bank set", extracted: 0, remaining: 0, done: true });
  }

  // Examples
  const examples = allTxns.filter(t => t.ext_bank && t.ext_bank !== "").slice(0, 8);
  const exampleText = examples.length > 0
    ? `\n## EXAMPLES\n${JSON.stringify(examples.map(e => ({ desc: (e.description || "").slice(0, 80), cp: e.counterparty, dir: e.direction, ext_bank: e.ext_bank })), null, 2)}\n`
    : "";

  const client = new Anthropic({ apiKey });

  // Process in AI batches of 25, up to 100 total per API call
  const maxPerCall = 100;
  const aiBatchSize = 25;
  const toProcess = empty.slice(0, maxPerCall);
  let totalExtracted = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < toProcess.length; i += aiBatchSize) {
    const batch = toProcess.slice(i, i + aiBatchSize);
    const txnList = batch.map(t => ({
      id: t.id,
      desc: (t.description || "").slice(0, 120),
      amount: t.amount,
      cp: t.counterparty || "",
      dir: t.direction || "",
      bank: t.bank || "",
    }));

    const prompt = `Extract the EXTERNAL BANK from each transaction. Return a JSON array.
${context ? `\nCONTEXT: ${context}\n` : ""}${instructions ? `\nINSTRUCTIONS: ${instructions}\n` : ""}${exampleText}
RULES:
- WITHDRAWALS: the RECEIVING bank. "WIRE TO WELLS FARGO" → "Wells Fargo". "TRANSFERRED BY WIRE TO BANK OF AMERICA" → "Bank of America". "MXN DELD TO BANCA MIFEL" → "Banca Mifel".
- DEPOSITS: the ORIGINATING bank. "FEDWIRE CREDIT VIA: THE BANK OF NEW YORK MELLON" → "Bank of New York Mellon".
- Clean proper case names. If no bank identifiable, return "".

TRANSACTIONS:
${JSON.stringify(txnList)}

Respond ONLY with JSON array: [{"id":number,"ext_bank":"name or empty"}]`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "";
      // Extract JSON from response
      let jsonStr = raw;
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      // Find array in response
      const arrMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (!arrMatch) {
        allErrors.push(`Batch ${i}: No JSON array found in response: ${raw.slice(0, 100)}`);
        continue;
      }

      const results = JSON.parse(arrMatch[0]);
      if (!Array.isArray(results)) {
        allErrors.push(`Batch ${i}: Parsed result is not array`);
        continue;
      }

      for (const r of results) {
        if (r && r.ext_bank && r.ext_bank.trim() !== "") {
          const { error } = await db.from("transactions").update({ ext_bank: r.ext_bank.trim() }).eq("id", r.id);
          if (!error) totalExtracted++;
        }
      }
    } catch (err: any) {
      allErrors.push(`Batch ${i}: ${err.message || String(err)}`);
      continue;
    }
  }

  const remaining = empty.length - toProcess.length;

  return NextResponse.json({
    message: `Identified external banks for ${totalExtracted} of ${toProcess.length} transactions.${remaining > 0 ? ` ${remaining} remaining.` : ""}${allErrors.length > 0 ? ` Errors: ${allErrors.join("; ")}` : ""}`,
    extracted: totalExtracted,
    remaining,
    done: remaining === 0,
  });
}
