import { NextRequest, NextResponse } from "next/server";
import { getSupabase, fetchAll } from "@/lib/supabase";

// Manual link: set match_group on specific transaction IDs
export async function POST(req: NextRequest) {
  const { action, ids, matchGroup } = await req.json();
  const db = getSupabase();

  if (action === "link") {
    // Link specific transactions together
    if (!ids || ids.length < 2) return NextResponse.json({ error: "Need at least 2 transaction IDs" }, { status: 400 });
    const group = matchGroup || `match_${Date.now()}`;
    const { error } = await db.from("transactions").update({ match_group: group }).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-fix directions for cross-bank links
    const { data: linked } = await db.from("transactions").select("id, amount, bank, direction").in("id", ids);
    if (linked && linked.length >= 2) {
      const deposits = linked.filter((t: any) => (t.amount || 0) > 0);
      const withdrawals = linked.filter((t: any) => (t.amount || 0) < 0);
      for (const dep of deposits) {
        for (const wth of withdrawals) {
          const isCrossBank = dep.bank && wth.bank && dep.bank !== wth.bank;
          if (isCrossBank) {
            // Cross-bank: deposit = Contribution, withdrawal = Internal Transfer
            await db.from("transactions").update({ direction: "Contribution" }).eq("id", dep.id);
            await db.from("transactions").update({ direction: "Internal Transfer" }).eq("id", wth.id);
          }
        }
      }
    }

    return NextResponse.json({ message: `Linked ${ids.length} transactions`, match_group: group });
  }

  if (action === "unlink") {
    if (!ids) return NextResponse.json({ error: "Need transaction IDs" }, { status: 400 });
    const { error } = await db.from("transactions").update({ match_group: "" }).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ message: `Unlinked ${ids.length} transactions` });
  }

  if (action === "auto-match") {
    // Auto-match: find outflows from one bank and matching inflows in another
    const { dateDays = 3, amountTolerance = 1 } = await req.json().catch(() => ({}));

    const allTxns = await fetchAll("transactions", "id, date, amount, account, account_name, bank, direction, match_group, flag, description");
    const active = allTxns.filter(t => t.flag !== "disqualified" && (!t.match_group || t.match_group === ""));

    // Find outflows (negative) and inflows (positive) on different accounts
    const outflows = active.filter(t => (t.amount || 0) < 0);
    const inflows = active.filter(t => (t.amount || 0) > 0);

    const matches: Array<{ outId: number; inId: number; outAmount: number; inAmount: number; outDate: string; inDate: string; outAccount: string; inAccount: string; confidence: number }> = [];

    for (const out of outflows) {
      const outAmt = Math.abs(out.amount);
      const outDate = new Date(out.date);
      if (isNaN(outDate.getTime())) continue;

      for (const inf of inflows) {
        // Must be different accounts
        if (out.account === inf.account) continue;
        // Must be different banks — skip same-bank matches (those are internal transfers)
        const outBank = out.bank || "";
        const inBank = inf.bank || "";
        if (outBank === inBank && outBank !== "") continue;

        const inAmt = Math.abs(inf.amount);
        const inDate = new Date(inf.date);
        if (isNaN(inDate.getTime())) continue;

        // Check amount match
        if (Math.abs(outAmt - inAmt) > amountTolerance) continue;

        // Check date proximity
        const daysDiff = Math.abs(outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > dateDays) continue;

        // Calculate confidence
        let confidence = 0.5;
        if (Math.abs(outAmt - inAmt) < 0.01) confidence += 0.3; // exact amount
        else confidence += 0.1;
        if (daysDiff < 1) confidence += 0.15; // same day
        else if (daysDiff <= 1) confidence += 0.1;
        if (outBank !== inBank) confidence += 0.05; // cross-bank more likely a real transfer

        matches.push({
          outId: out.id,
          inId: inf.id,
          outAmount: out.amount,
          inAmount: inf.amount,
          outDate: out.date,
          inDate: inf.date,
          outAccount: `${out.account} (${outBank})`,
          inAccount: `${inf.account} (${inBank})`,
          confidence: Math.min(confidence, 1),
        });
      }
    }

    // Sort by confidence descending, take top 100
    matches.sort((a, b) => b.confidence - a.confidence);
    const top = matches.slice(0, 100);

    return NextResponse.json({
      message: `Found ${matches.length} potential matches (showing top ${top.length})`,
      matches: top,
    });
  }

  return NextResponse.json({ error: "Invalid action. Use: link, unlink, auto-match" }, { status: 400 });
}

// Get all transactions in a match group
export async function GET(req: NextRequest) {
  const group = req.nextUrl.searchParams.get("group");
  if (!group) return NextResponse.json([]);

  const db = getSupabase();
  const { data, error } = await db.from("transactions").select("*").eq("match_group", group).order("date");
  if (error) return NextResponse.json([]);
  return NextResponse.json(data);
}
