import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const { instructions } = await req.json().catch(() => ({}));

  const db = getSupabase();
  const { data: txns } = await db
    .from("transactions")
    .select("id, date, amount, direction, account, account_name, bank, counterparty, description, flag, category, reference")
    .neq("flag", "disqualified")
    .order("date", { ascending: true })
    .limit(5000);

  if (!txns || txns.length === 0) return NextResponse.json({ matches: [], message: "No transactions" });

  const outflows = txns.filter(t => (t.amount || 0) < 0 && !(t.direction || "").toLowerCase().match(/internal|transfer between/)).slice(0, 100);
  const inflows = txns.filter(t => (t.amount || 0) > 0 && !(t.direction || "").toLowerCase().match(/internal|transfer between/)).slice(0, 100);

  const client = new Anthropic({ apiKey });

  const prompt = `You are a forensic accountant tracing money flows between bank accounts.

Below are OUTFLOWS (money leaving) and INFLOWS (money arriving) across different banks. Your job is to match outflows to inflows that represent the SAME money moving between banks.

${instructions ? `## INVESTIGATION CONTEXT\n${instructions}\n` : ""}

## OUTFLOWS (money leaving)
${outflows.map(t => `[id=${t.id}] ${t.date} | ${t.bank} | ${t.account || t.account_name} | $${t.amount} | ${t.description || "-"} | ${t.counterparty || "-"} | ref:${t.reference || "-"}`).join("\n")}

## INFLOWS (money arriving)
${inflows.map(t => `[id=${t.id}] ${t.date} | ${t.bank} | ${t.account || t.account_name} | $${t.amount} | ${t.description || "-"} | ${t.counterparty || "-"} | ref:${t.reference || "-"}`).join("\n")}

## MATCHING RULES
- Match outflow to inflow where the money is the SAME transaction across banks
- Amount should be same or very close (fees may cause small differences)
- Date should be within 5 days (settlement delays)
- Look for: matching references, counterparty names that match bank names, similar descriptions
- Also identify CHAINS: A→B→C where money went through multiple accounts
- Flag split transactions: one large outflow matching multiple smaller inflows

Respond with ONLY a JSON object:
{
  "matches": [
    { "source_id": <outflow id>, "dest_id": <inflow id>, "confidence": 0.0-1.0, "reasoning": "why these match" }
  ],
  "chains": [
    { "path": [<id1>, <id2>, <id3>], "description": "Money went from X to Y to Z", "total_amount": 0 }
  ],
  "splits": [
    { "source_id": <id>, "dest_ids": [<id>, <id>], "reasoning": "One withdrawal split into multiple deposits" }
  ]
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    let text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n").replace(/```\s*$/, "");
    const result = JSON.parse(text);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message, matches: [], chains: [], splits: [] });
  }
}
