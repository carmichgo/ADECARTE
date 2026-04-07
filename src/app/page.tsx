"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Papa from "papaparse";
import ReactMarkdown from "react-markdown";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceDot, ReferenceArea,
  ReferenceLine, Brush, PieChart, Pie
} from "recharts";

type Tab = "dashboard" | "upload" | "transactions" | "categorize" | "suspicious" | "analytics" | "settings";
type Flag = "" | "normal" | "review" | "suspicious" | "critical" | "verified_fraud" | "disqualified";

interface Transaction {
  id: number; date: string; settle_date: string; description: string; amount: number;
  unit_price: number; quantity: number; currency: string; account: string;
  account_name: string; reference: string; counterparty: string;
  symbol: string; security: string; strategy: string; direction: string;
  bank: string; category: string; subcategory: string; flag: string; notes: string;
  categorized_by: string; raw_data: any; documents: any[]; fraudulent_signature: boolean | null;
  beneficiary: string; match_group: string; ext_bank: string;
}
interface Category { id: number; name: string; description: string; is_suspicious: boolean; }
interface Stats {
  total_transactions: number; total_amount: number; total_deposits: number;
  total_withdrawals: number; deposit_count: number; withdrawal_count: number;
  categorized: number; uncategorized: number; suspicious_amount: number; suspicious_count: number;
  verified_fraud_amount: number; verified_fraud_count: number;
  suspicious_breakdown: any[]; by_category: any[]; by_flag: any[]; by_account: any[];
  loan_disbursed: number; loan_repaid: number; loan_outstanding: number; loan_interest: number; loan_count: number;
  td_placed: number; td_matured: number; td_active: number; td_count: number;
}

const fmt = (n: number | null) => {
  if (n == null) return "$0.00";
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "-$" : "$") + abs;
};

export default function Home() {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("adecarte_theme") === "dark";
    return false;
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    if (typeof window !== "undefined") localStorage.setItem("adecarte_theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const [tab, setTab] = useState<Tab>("dashboard");
  const [categories, setCategories] = useState<Category[]>([]);
  const [allBanks, setAllBanks] = useState<string[]>([]);
  const [allAccounts, setAllAccounts] = useState<string[]>([]);
  const [allCounterparties, setAllCounterparties] = useState<string[]>([]);
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState({ category: "", subcategory: "", flag: "", notes: "", direction: "", counterparty: "", bank: "", amount: "", beneficiary: "", ext_bank: "" });
  const [filters, setFilters] = useState({ search: "", category: "", flag: "", min: "", max: "", bank: "", account: "", direction: "", counterparty: "", dateFrom: "", dateTo: "", source: "", excludeFlags: [] as string[], extBank: "" });
  const [showFilterSidebar, setShowFilterSidebar] = useState(false);
  const [sort, setSort] = useState({ field: "id", desc: true });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ type: string; msg: string } | null>(null);
  const [aiPreview, setAiPreview] = useState<any[] | null>(null);
  const [aiPreviewAccepted, setAiPreviewAccepted] = useState<Set<number>>(new Set());
  const [aiUndoSnapshot, setAiUndoSnapshot] = useState<any[] | null>(null);
  const [aiInstructions, setAiInstructions] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("adecarte_ai_instructions") || "";
    return "";
  });
  const [investigationContext, setInvestigationContext] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("adecarte_investigation_context") || "";
    return "";
  });
  const [ourAccounts, setOurAccounts] = useState<Array<{ account: string; bank: string; role: string; notes: string }>>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("adecarte_our_accounts") || "[]"); } catch { return []; }
    }
    return [];
  });
  const [flaggedAccounts, setFlaggedAccounts] = useState<Array<{ account: string; name: string; reason: string }>>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("adecarte_flagged_accounts") || "[]"); } catch { return []; }
    }
    return [];
  });
  const [uploadStatus, setUploadStatus] = useState<{ type: string; msg: string } | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkFlag, setBulkFlag] = useState("");
  const [bulkDirection, setBulkDirection] = useState("");
  const [bulkBeneficiary, setBulkBeneficiary] = useState("");
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [partyLoading, setPartyLoading] = useState(false);
  const [partyStatus, setPartyStatus] = useState<{ type: string; msg: string } | null>(null);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [counterparties, setCounterparties] = useState<Array<{ name: string; count: number; total_amount: number }>>([]);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergeCanonical, setMergeCanonical] = useState("");
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeStatus, setMergeStatus] = useState<{ type: string; msg: string } | null>(null);
  const [autoMergeLoading, setAutoMergeLoading] = useState(false);
  const [autoMergePreview, setAutoMergePreview] = useState<any[] | null>(null);
  const [partySort, setPartySort] = useState<{ field: string; desc: boolean }>({ field: "deposits", desc: true });
  const [brushRange, setBrushRange] = useState<{ start: number; end: number } | null>(null);
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(new Set());
  const [drillCounterparty, setDrillCounterparty] = useState<string | null>(null);
  const [analyticsTab, setAnalyticsTab] = useState<"overview" | "counterparties" | "fraud" | "tools" | "flow">("overview");
  const [traceData, setTraceData] = useState<any>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [sankeyData, setSankeyData] = useState<any>(null);
  const [sankeyLoading, setSankeyLoading] = useState(false);
  const [flowData, setFlowData] = useState<any>(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [aiFlowLoading, setAiFlowLoading] = useState(false);
  const [aiFlowResult, setAiFlowResult] = useState<any>(null);
  const [flowChainTxn, setFlowChainTxn] = useState<number | null>(null);
  // Suspicious tab state
  const [suspFilter, setSuspFilter] = useState({ flag: "all", category: "", search: "", counterparty: "" });
  const [suspSort, setSuspSort] = useState<{ field: string; desc: boolean }>({ field: "amount", desc: false });
  const [suspSelected, setSuspSelected] = useState<Set<number>>(new Set());
  const [suspExpanded, setSuspExpanded] = useState<number | null>(null);
  // Settings & Documents
  const [refSignatures, setRefSignatures] = useState<any[]>([]);
  const [sigUploadStatus, setSigUploadStatus] = useState<string>("");
  // Document viewer in edit modal
  const [editDocs, setEditDocs] = useState<any[]>([]);
  const [docUploadStatus, setDocUploadStatus] = useState<string>("");
  const [sigCompareResult, setSigCompareResult] = useState<any>(null);
  const [sigComparing, setSigComparing] = useState(false);
  // Cluster detection config
  const [showClusters, setShowClusters] = useState(true);
  const [clusterMinWithdrawals, setClusterMinWithdrawals] = useState(3);
  const [clusterMinAmount, setClusterMinAmount] = useState(10000);
  const [clusterWindowDays, setClusterWindowDays] = useState(7);
  const [clusterFlagFilter, setClusterFlagFilter] = useState<string>("all");
  const [fraudReturnRate, setFraudReturnRate] = useState(7);
  const [fraudBeneficiaryFilter, setFraudBeneficiaryFilter] = useState("");
  const [strategyYields, setStrategyYields] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("adecarte_strategy_yields") || "{}"); } catch { return {}; }
    }
    return {};
  });
  // AI Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; text: string; annotations?: any[] }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [aiAnnotations, setAiAnnotations] = useState<any[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/categories", { cache: "no-store" });
    setCategories(await res.json());
  }, []);

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/stats", { cache: "no-store" });
    setStats(await res.json());
  }, []);

  const loadTransactions = useCallback(async () => {
    const q = new URLSearchParams();
    if (filters.search) q.set("search", filters.search);
    if (filters.category) q.set("category", filters.category);
    if (filters.flag) q.set("flag", filters.flag);
    if (filters.bank) q.set("bank", filters.bank);
    if (filters.account) q.set("account", filters.account);
    if (filters.direction) q.set("direction", filters.direction);
    if (filters.counterparty) q.set("counterparty", filters.counterparty);
    if (filters.dateFrom) q.set("date_from", filters.dateFrom);
    if (filters.dateTo) q.set("date_to", filters.dateTo);
    if (filters.source) q.set("categorized_by", filters.source);
    if (filters.extBank) q.set("ext_bank", filters.extBank);
    q.set("order", "id");
    q.set("desc", "1");
    const res = await fetch("/api/transactions?" + q.toString(), { cache: "no-store" });
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];
    // Client-side sort for all columns
    rows.sort((a: any, b: any) => {
      let va = a[sort.field] ?? "";
      let vb = b[sort.field] ?? "";
      // Handle account_name fallback
      if (sort.field === "account_name") { va = a.account_name || a.account || ""; vb = b.account_name || b.account || ""; }
      if (typeof va === "number" && typeof vb === "number") return sort.desc ? vb - va : va - vb;
      va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
      if (va < vb) return sort.desc ? 1 : -1;
      if (va > vb) return sort.desc ? -1 : 1;
      return 0;
    });
    // Client-side filters: exclude flags + absolute amount range
    let filtered = rows;
    if (filters.excludeFlags.length > 0) filtered = filtered.filter(t => !filters.excludeFlags.includes(t.flag || ""));
    if (filters.min) { const min = parseFloat(filters.min); filtered = filtered.filter(t => Math.abs(t.amount || 0) >= min); }
    if (filters.max) { const max = parseFloat(filters.max); filtered = filtered.filter(t => Math.abs(t.amount || 0) <= max); }
    setTransactions(filtered);
    setSelectedIds(new Set());
  }, [filters, sort]);

  const loadAnalytics = useCallback(async () => {
    const res = await fetch("/api/analytics", { cache: "no-store" });
    const data = await res.json();
    if (!data.error) {
      setAnalyticsData(data);
      // Select all accounts by default
      if (data.balance_by_account) {
        setSelectedAccounts(new Set(Object.keys(data.balance_by_account)));
      }
    }
  }, []);

  const runPartyExtraction = async () => {
    setPartyLoading(true);
    setPartyStatus({ type: "info", msg: "AI is identifying counterparties (processes ~30 at a time, run again for more)..." });
    try {
      const res = await fetch("/api/ai/extract-parties", { method: "POST" });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { error: `Server error (${res.status}): ${text.slice(0, 200)}` }; }
      if (data.error) setPartyStatus({ type: "error", msg: data.error });
      else {
        setPartyStatus({ type: "success", msg: `${data.message}. Run again if more transactions need processing.` });
        loadAnalytics();
      }
    } catch (err: any) { setPartyStatus({ type: "error", msg: "Request failed: " + err.message }); }
    setPartyLoading(false);
  };

  useEffect(() => {
    loadCategories(); loadStats();
    fetch("/api/banks", { cache: "no-store" }).then(r => r.json()).then(d => { if (Array.isArray(d)) setAllBanks(d); }).catch(() => {});
    fetch("/api/accounts", { cache: "no-store" }).then(r => r.json()).then(d => { if (Array.isArray(d)) setAllAccounts(d); }).catch(() => {});
    fetch("/api/counterparties", { cache: "no-store" }).then(r => r.json()).then(d => { if (Array.isArray(d)) setAllCounterparties(d.map((c: any) => c.name)); }).catch(() => {});
  }, [loadCategories, loadStats]);
  useEffect(() => { if (tab === "transactions" || tab === "suspicious") loadTransactions(); }, [tab, loadTransactions]);
  useEffect(() => { if (tab === "dashboard") loadStats(); }, [tab, loadStats]);
  useEffect(() => { if (tab === "analytics") { loadAnalytics(); loadCounterparties(); } }, [tab, loadAnalytics]);

  const loadCounterparties = async () => {
    const res = await fetch("/api/counterparties", { cache: "no-store" });
    const data = await res.json();
    if (Array.isArray(data)) setCounterparties(data);
  };

  const mergeCounterparties = async () => {
    if (mergeSelected.size < 2 || !mergeCanonical) {
      setMergeStatus({ type: "error", msg: "Select at least 2 counterparties and enter the canonical name." });
      return;
    }
    setMergeStatus({ type: "info", msg: "Merging..." });
    try {
      const res = await fetch("/api/transactions/merge-counterparties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: [...mergeSelected], canonical: mergeCanonical }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
      if (data.error) setMergeStatus({ type: "error", msg: data.error });
      else {
        setMergeStatus({ type: "success", msg: data.message });
        setMergeSelected(new Set());
        setMergeCanonical("");
        loadCounterparties();
        loadAnalytics();
      }
    } catch (err: any) { setMergeStatus({ type: "error", msg: err.message }); }
  };

  const toggleMergeSelect = (name: string) => {
    const next = new Set(mergeSelected);
    next.has(name) ? next.delete(name) : next.add(name);
    setMergeSelected(next);
    // Auto-set canonical to the first selected if not set
    if (!mergeCanonical && next.size > 0) setMergeCanonical([...next][0]);
  };

  const runAutoMerge = async (dryRun: boolean) => {
    setAutoMergeLoading(true);
    setMergeStatus({ type: "info", msg: dryRun ? "AI is analyzing counterparties for duplicates..." : "Applying merges..." });
    try {
      const res = await fetch("/api/ai/auto-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
      if (data.error) {
        setMergeStatus({ type: "error", msg: data.error });
      } else if (dryRun) {
        setAutoMergePreview(data.merges || []);
        setMergeStatus({ type: "success", msg: `Found ${data.merges?.length || 0} merge groups. Review below and click "Apply All" to merge.` });
      } else {
        setAutoMergePreview(null);
        setMergeStatus({ type: "success", msg: data.message });
        loadCounterparties();
        loadAnalytics();
      }
    } catch (err: any) { setMergeStatus({ type: "error", msg: err.message }); }
    setAutoMergeLoading(false);
  };

  // ── Cluster detection (computed client-side) ───
  // Helper: should this transaction be excluded from flow calculations?
  // Build account context for AI prompts
  const accountContextForAI = (() => {
    if (ourAccounts.length === 0) return "";
    const lines = ourAccounts.map(a =>
      `- Account "${a.account}" at ${a.bank} — Role: ${a.role}${a.notes ? ` — ${a.notes}` : ""}`
    ).join("\n");
    const flaggedLines = flaggedAccounts.length > 0
      ? `\n## KNOWN FRAUDULENT EXTERNAL ACCOUNTS\n${flaggedAccounts.map(a => `- Account "${a.account}"${a.name ? ` (${a.name})` : ""} — ${a.reason}`).join("\n")}\n\nIMPORTANT: Any transaction sending money TO these accounts should be flagged as "verified_fraud" or "critical" and categorized as "SUSPICIOUS - Unauthorized Transfer" or "FRAUD - Unauthorized Transfer". These are confirmed fraudulent destinations.\n`
      : "";
    const locAccounts = ourAccounts.filter(a => a.role === "LOC").map(a => a.account);
    const locList = locAccounts.length > 0 ? locAccounts.map(a => `"${a}"`).join(", ") : "(none defined)";
    return `\n## OUR ACCOUNTS (owned by us)\n${lines}\n\nLOC-RELATED ACCOUNTS: ${locList}\n\nIMPORTANT RULES FOR CATEGORIZATION:\n\n1. INTERNAL TRANSFERS:\n   A transfer between our own accounts (BOTH source AND destination in the list above) = "Internal Transfer" on BOTH sides, direction "Internal Transfer".\n   This includes transfers between DIFFERENT BANKS (e.g. BNY Pershing → JP Morgan). If both accounts are ours, BOTH the sending side and receiving side must be "Internal Transfer".\n   Example: "Funds Transferred From Q22-008033 To 626433333" — both are our accounts → Internal Transfer on BOTH transactions.\n   BOTH sides are excluded from deposits/withdrawals (net zero — money just moved).\n\n2. LINE OF CREDIT RULES:\n   THE ENTIRE LINE OF CREDIT IS FRAUDULENT. ALL LOC-related transactions must be flagged "suspicious" or "critical" — NEVER "normal".\n   ALL transactions involving Aira Kresch, Nankin, or La Saga LLC (at Evolve Bank) must be flagged "verified_fraud".\n\n   "Line of Credit" category = ONLY for transactions on "Loan Adela" account. NEVER for M61750002.\n\n3. ACCOUNT M61750002 SPECIAL RULES (JPM Brokerage/Custody):\n   This account is a PASS-THROUGH. Money enters and exits. Same amount appears positive then negative within 1-2 days.\n\n   CREDIT MEMORANDUM (positive) → flag "disqualified". Funding side only.\n   FX SPOT CURRENCY (negative) → "LOC External Transfer", direction "Withdraw", flag "critical".\n   FOREIGN CASH / MXN DELD / EUR DELD (positive) → flag "disqualified". FX delivery record.\n   PAYMENTS "WIRE TO" (negative) → "LOC External Transfer" if external, "Internal Transfer" if to our accounts.\n   PAYMENTS "FUNDS TRANSFERRED" → "Internal Transfer" if both accounts are ours.\n   SECURITY PENDING / TIME DEPOSITS → "Time Deposit".\n   DEBIT MEMORANDUM → "LOC Interest Payment".\n   DEPOSIT SWEEP INTEREST → "Revenue / Income", flag "normal". Legitimate interest earned on cash.\n   INTEREST ON CASH → "Revenue / Income", flag "normal".\n\n4. "LOC Funded Deposit" = ONLY when on our INVESTMENT accounts (NOT M61750002) and description mentions loan/advance.\n\n5. When you see "Transfer of Funds From X To Y" or "Funds Transferred From X To Y", check BOTH X and Y against our accounts list. If both are ours → Internal Transfer on BOTH sides.\n\n6. If counterparty/beneficiary is Aira Kresch, Nankin, La Saga LLC (at Evolve Bank), or a KNOWN FRAUDULENT ACCOUNT → flag as "verified_fraud".\n\n7. ONLY use "disqualified" for M61750002 CREDIT MEMORANDUM and FOREIGN CASH/MXN DELD/EUR DELD entries. NEVER use "disqualified" for any other transaction.\n${flaggedLines}`;
  })();

  const saveOurAccounts = (accts: typeof ourAccounts) => {
    setOurAccounts(accts);
    if (typeof window !== "undefined") localStorage.setItem("adecarte_our_accounts", JSON.stringify(accts));
  };

  const saveFlaggedAccounts = (accts: typeof flaggedAccounts) => {
    setFlaggedAccounts(accts);
    if (typeof window !== "undefined") localStorage.setItem("adecarte_flagged_accounts", JSON.stringify(accts));
  };

  const isExcludedFromFlow = (t: any) => {
    const dir = (t.direction || "").toLowerCase();
    const cat = (t.category || "").toLowerCase();
    return dir.match(/internal|transfer between/) || cat.match(/transfer.*between|internal.*transfer/) || cat.match(/line of credit|loc principal|loc interest/) || cat.match(/time deposit/);
  };

  // Reset brush when categories change
  useEffect(() => { setBrushRange(null); }, [excludedCategories]);

  // Recompute balance data when categories are excluded
  const filteredBalanceData = (() => {
    if (!analyticsData?.raw_transactions) return analyticsData?.balance_over_time || [];
    // Always filter out disqualified, plus any excluded categories
    const hasDisqualified = analyticsData.raw_transactions.some((t: any) => t.flag === "disqualified");
    if (!hasDisqualified && excludedCategories.size === 0) {
      return analyticsData?.balance_over_time || [];
    }
    const txns = analyticsData.raw_transactions.filter((t: any) => t.flag !== "disqualified" && !excludedCategories.has(t.category || ""));
    const byDate: Record<string, { date: string; raw_date: string; inflow: number; outflow: number; net: number; count: number; withdraw_count: number; withdraw_total: number }> = {};
    for (const t of txns) {
      const d = t.date || "Unknown";
      if (!byDate[d]) byDate[d] = { date: d, raw_date: d, inflow: 0, outflow: 0, net: 0, count: 0, withdraw_count: 0, withdraw_total: 0 };
      const amount = t.amount || 0;
      if (isExcludedFromFlow(t)) { byDate[d].count++; continue; }
      if (amount > 0) byDate[d].inflow += amount;
      else if (amount < 0) { byDate[d].outflow += Math.abs(amount); byDate[d].withdraw_count++; byDate[d].withdraw_total += Math.abs(amount); }
      byDate[d].net += amount;
      byDate[d].count++;
    }
    const sorted = Object.values(byDate).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let cum = 0;
    return sorted.map(d => {
      cum += d.net;
      const parsed = new Date(d.date);
      const label = isNaN(parsed.getTime()) ? d.date : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
      return { ...d, date: label, balance: cum };
    });
  })();

  // Filtered counterparty data
  const filteredTransactionCounts = (() => {
    if (!analyticsData?.raw_transactions) return analyticsData?.transaction_counts || [];
    const hasDisqualified = analyticsData.raw_transactions.some((t: any) => t.flag === "disqualified");
    if (!hasDisqualified && excludedCategories.size === 0) {
      return analyticsData?.transaction_counts || [];
    }
    const txns = analyticsData.raw_transactions.filter((t: any) => t.flag !== "disqualified" && !excludedCategories.has(t.category || ""));
    const partyCounts: Record<string, any> = {};
    for (const t of txns) {
      const party = t.counterparty || "Unknown";
      if (!partyCounts[party]) partyCounts[party] = { party, deposits: 0, deposit_amount: 0, withdrawals: 0, withdrawal_amount: 0, internal: 0, internal_amount: 0 };
      const amount = t.amount || 0;
      const dir = (t.direction || "").toLowerCase();
      if (isExcludedFromFlow(t)) { partyCounts[party].internal++; partyCounts[party].internal_amount += Math.abs(amount); }
      else if (amount > 0) { partyCounts[party].deposits++; partyCounts[party].deposit_amount += Math.abs(amount); }
      else if (amount < 0) { partyCounts[party].withdrawals++; partyCounts[party].withdrawal_amount += Math.abs(amount); }
    }
    return Object.values(partyCounts).sort((a: any, b: any) => (b.deposits + b.withdrawals) - (a.deposits + a.withdrawals)).slice(0, 50);
  })();

  // Get all unique categories from raw transactions
  const allCategories = (() => {
    if (!analyticsData?.raw_transactions) return [];
    const cats = new Set<string>();
    for (const t of analyticsData.raw_transactions) { if (t.category) cats.add(t.category); }
    return [...cats].sort();
  })();

  const withdrawalClusters = (() => {
    if (!filteredBalanceData || filteredBalanceData.length === 0) return [];
    const data = filteredBalanceData;

    // If flag filter is active, recompute withdraw counts from raw transactions
    let dateWithdrawals: Record<string, { count: number; total: number }> = {};
    if (clusterFlagFilter !== "all" && analyticsData.raw_transactions) {
      for (const t of analyticsData.raw_transactions) {
        if ((t.amount || 0) >= 0) continue;
        const dir = (t.direction || "").toLowerCase();
        if (isExcludedFromFlow(t)) continue;
        if (clusterFlagFilter === "suspicious+critical") {
          if (t.flag !== "suspicious" && t.flag !== "critical") continue;
        } else if (t.flag !== clusterFlagFilter) continue;
        const d = t.date || "Unknown";
        if (!dateWithdrawals[d]) dateWithdrawals[d] = { count: 0, total: 0 };
        dateWithdrawals[d].count++;
        dateWithdrawals[d].total += Math.abs(t.amount);
      }
    }

    const clusters: Array<{ startIdx: number; endIdx: number; count: number; total: number; label: string }> = [];
    for (let i = 0; i < data.length; i++) {
      let windowCount = 0;
      let windowTotal = 0;
      let endIdx = i;

      for (let j = i; j < data.length; j++) {
        const dayDiff = j - i;
        if (dayDiff > clusterWindowDays) break;
        if (clusterFlagFilter !== "all" && dateWithdrawals[data[j].raw_date]) {
          windowCount += dateWithdrawals[data[j].raw_date].count;
          windowTotal += dateWithdrawals[data[j].raw_date].total;
        } else if (clusterFlagFilter === "all") {
          windowCount += data[j].withdraw_count || 0;
          windowTotal += data[j].withdraw_total || 0;
        }
        endIdx = j;
      }

      if (windowCount >= clusterMinWithdrawals && windowTotal >= clusterMinAmount) {
        if (clusters.length === 0 || i > clusters[clusters.length - 1].endIdx) {
          clusters.push({
            startIdx: i, endIdx, count: windowCount, total: windowTotal,
            label: `${windowCount} withdrawals, $${windowTotal.toLocaleString()}`,
          });
        }
      }
    }
    return clusters;
  })();

  // ── AI Chat ───
  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setChatLoading(true);

    try {
      const res = await fetch("/api/ai/analyze-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          balanceData: analyticsData?.balance_over_time || [],
          transactionCounts: analyticsData?.transaction_counts || [],
          rawTransactions: analyticsData?.raw_transactions || [],
          instructions: aiInstructions,
          context: investigationContext + accountContextForAI,
        }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { text: "Error parsing response", annotations: [] }; }

      const actions: string[] = [];
      if (data.categorized?.length) actions.push(`Categorized ${data.categorized.length} transaction(s)`);
      if (data.flagged?.length) {
        const totalFlagged = data.flagged.reduce((s: number, f: any) => s + (f.ids?.length || 0), 0);
        actions.push(`Flagged ${totalFlagged} transaction(s)`);
      }

      setChatMessages(prev => [...prev, {
        role: "ai",
        text: data.text || "No response",
        annotations: data.annotations,
        actions: actions.length > 0 ? actions : undefined,
      } as any]);
      if (data.annotations && data.annotations.length > 0) {
        setAiAnnotations(prev => [...prev, ...data.annotations]);
      }
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: "ai", text: "Error: " + err.message }]);
    }
    setChatLoading(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  // ── Upload ───
  const handleFile = (file: File) => {
    if (!file.name.endsWith(".csv")) { alert("Please upload a CSV file"); return; }
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = Papa.parse(e.target!.result as string, { header: true, preview: 5 });
      setCsvHeaders(parsed.meta.fields || []);
      setCsvPreview(parsed.data);
      const map: Record<string, string> = {};
      const patterns: Record<string, string[]> = {
        date: ["date", "fecha", "transaction date", "posting date", "value date", "trade date"],
        settle_date: ["settle date", "settlement date"],
        description: ["description", "descripcion", "memo", "detail", "narrative", "concepto"],
        amount: ["amount", "monto", "importe", "value"],
        unit_price: ["unit price", "price", "precio"],
        quantity: ["quantity", "qty", "shares"],
        currency: ["currency", "moneda"],
        account: ["account", "cuenta"],
        account_name: ["account name"],
        reference: ["reference", "referencia", "ref"],
        counterparty: ["counterparty", "beneficiary", "beneficiario", "payee", "recipient"],
        symbol: ["symbol", "ticker"],
        security: ["security", "instrument", "security name"],
        strategy: ["strategy"],
        direction: ["direction", "side", "buy/sell"],
      };
      const lower: Record<string, string> = {};
      (parsed.meta.fields || []).forEach(h => { lower[h.toLowerCase().trim()] = h; });
      for (const [f, cands] of Object.entries(patterns)) {
        for (const c of cands) { if (lower[c]) { map[f] = lower[c]; break; } }
      }
      setFieldMap(map);
    };
    reader.readAsText(file);
  };

  const confirmUpload = async () => {
    if (!csvFile) return;
    setUploadStatus({ type: "info", msg: "Uploading..." });
    const form = new FormData();
    form.append("file", csvFile);
    form.append("field_map", JSON.stringify(fieldMap));
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) setUploadStatus({ type: "error", msg: `Upload failed: ${data.error}` });
      else {
        setUploadStatus({ type: "success", msg: `${data.message} (Batch: ${data.batch_id}). Switching to Transactions...` });
        loadStats();
        setCsvFile(null); setCsvHeaders([]); setCsvPreview([]);
        setTimeout(() => setTab("transactions"), 1500);
      }
    } catch (err: any) { setUploadStatus({ type: "error", msg: err.message }); }
  };

  // ── Edit ───
  const openEdit = async (t: Transaction) => {
    setEditTxn(t);
    setEditForm({ category: t.category || "", subcategory: t.subcategory || "", flag: t.flag || "", notes: t.notes || "", direction: t.direction || "", counterparty: t.counterparty || "", bank: t.bank || "", amount: String(t.amount ?? ""), beneficiary: t.beneficiary || "", ext_bank: t.ext_bank || "" });
    setEditDocs([]);
    setDocUploadStatus("");
    setSigCompareResult(null);
    // Load documents for this transaction
    try {
      const res = await fetch(`/api/documents?transaction_id=${t.id}`, { cache: "no-store" });
      const docs = await res.json();
      if (Array.isArray(docs)) setEditDocs(docs);
    } catch {}
  };

  const loadRefSignatures = async () => {
    try {
      const res = await fetch("/api/settings/signature", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data)) setRefSignatures(data);
    } catch {}
  };

  const loadFlowData = async () => {
    setFlowLoading(true);
    try {
      const res = await fetch("/api/money-flow", { cache: "no-store" });
      const data = await res.json();
      if (!data.error) setFlowData(data);
    } catch {}
    setFlowLoading(false);
  };

  const runAiFlowMatch = async () => {
    setAiFlowLoading(true);
    try {
      const res = await fetch("/api/ai/match-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: investigationContext }),
      });
      const data = await res.json();
      setAiFlowResult(data);
    } catch {}
    setAiFlowLoading(false);
  };

  const uploadDocForTxn = async (file: File) => {
    if (!editTxn) return;
    setDocUploadStatus("Uploading...");
    const form = new FormData();
    form.append("file", file);
    form.append("transaction_id", String(editTxn.id));
    const res = await fetch("/api/documents", { method: "POST", body: form });
    const data = await res.json();
    if (data.error) { setDocUploadStatus("Error: " + data.error); return; }
    setDocUploadStatus("Uploaded!");
    // Reload docs
    const docsRes = await fetch(`/api/documents?transaction_id=${editTxn.id}`, { cache: "no-store" });
    const docs = await docsRes.json();
    if (Array.isArray(docs)) setEditDocs(docs);
  };

  const compareSignature = async (docPath: string) => {
    if (!editTxn || refSignatures.length === 0) return;
    setSigComparing(true);
    setSigCompareResult(null);
    try {
      const res = await fetch("/api/ai/compare-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: editTxn.id,
          documentPath: docPath,
          referenceSignaturePath: refSignatures[0].name,
        }),
      });
      const data = await res.json();
      setSigCompareResult(data);
    } catch (err: any) { setSigCompareResult({ error: err.message }); }
    setSigComparing(false);
  };

  const saveEdit = async () => {
    if (!editTxn) return;
    try {
      const payload: any = { ...editForm };
      // Convert amount to number, remove if unchanged
      if (payload.amount !== "" && payload.amount != null) {
        payload.amount = parseFloat(payload.amount);
        if (isNaN(payload.amount)) delete payload.amount;
      } else {
        delete payload.amount;
      }
      const res = await fetch(`/api/transactions/${editTxn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let result;
      try { result = JSON.parse(text); } catch { result = { error: `Server error (${res.status}): ${text.slice(0, 200)}` }; }
      if (result.error) {
        alert("Save failed: " + result.error);
        return;
      }
      setEditTxn(null);
      loadTransactions();
      loadStats();
    } catch (err: any) {
      alert("Save failed: " + err.message);
    }
  };

  // ── Bulk ───
  const applyBulk = async () => {
    const updates: any = {};
    if (bulkCategory) updates.category = bulkCategory;
    if (bulkFlag) updates.flag = bulkFlag;
    if (bulkDirection) updates.direction = bulkDirection;
    if (bulkBeneficiary) updates.beneficiary = bulkBeneficiary;
    if (Object.keys(updates).length === 0) return;
    await fetch("/api/transactions/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], updates }),
    });
    loadTransactions();
    loadStats();
    setBulkCategory(""); setBulkFlag(""); setBulkDirection(""); setBulkBeneficiary("");
  };

  const [bulkAiLoading, setBulkAiLoading] = useState(false);
  const [beneficiaryLoading, setBeneficiaryLoading] = useState(false);
  const [beneficiaryStatus, setBeneficiaryStatus] = useState("");
  const [extBankLoading, setExtBankLoading] = useState(false);
  const [extBankStatus, setExtBankStatus] = useState("");
  const [matchGroupView, setMatchGroupView] = useState<string | null>(null);
  const [matchGroupTxns, setMatchGroupTxns] = useState<any[]>([]);
  const [autoMatchLoading, setAutoMatchLoading] = useState(false);
  const [autoMatchResults, setAutoMatchResults] = useState<any[] | null>(null);
  const [autoMatchStatus, setAutoMatchStatus] = useState("");

  const bulkAiCategorize = async () => {
    if (selectedIds.size === 0) return;
    setBulkAiLoading(true);
    const ids = [...selectedIds];
    let done = 0;
    for (const id of ids) {
      try {
        await fetch("/api/ai/categorize-single", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, instructions: aiInstructions, context: investigationContext + accountContextForAI }),
        });
        done++;
      } catch {}
    }
    setBulkAiLoading(false);
    loadTransactions();
    loadStats();
  };

  const exportTransactions = (txnsToExport: Transaction[]) => {
    const headers = ["id", "date", "settle_date", "description", "amount", "unit_price", "quantity", "currency", "account", "account_name", "bank", "ext_bank", "reference", "counterparty", "beneficiary", "symbol", "security", "strategy", "direction", "category", "subcategory", "flag", "notes", "categorized_by", "match_group"];
    const rows = txnsToExport.map(t => headers.map(h => {
      const val = String((t as any)[h] ?? "");
      return val.includes(",") || val.includes('"') || val.includes("\n") ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `transactions_export_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const fillExtBanks = async () => {
    setExtBankLoading(true);
    let totalExtracted = 0;
    let round = 0;
    let remaining = -1;
    while (true) {
      round++;
      setExtBankStatus(`Batch ${round}: AI is identifying external banks... (${totalExtracted} done so far${remaining > 0 ? `, ~${remaining} remaining` : ""})`);
      try {
        const res = await fetch("/api/ai/extract-ext-banks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instructions: aiInstructions, context: investigationContext + accountContextForAI }),
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
        if (data.error) { setExtBankStatus("Error: " + data.error); break; }
        totalExtracted += data.extracted || 0;
        remaining = data.remaining || 0;
        if (data.done || data.remaining === 0) {
          setExtBankStatus(`Done! Identified external banks for ${totalExtracted} transactions across ${round} batches.`);
          loadTransactions();
          break;
        }
      } catch (err: any) { setExtBankStatus("Error: " + err.message); break; }
    }
    setExtBankLoading(false);
  };

  const fillBeneficiaries = async () => {
    setBeneficiaryLoading(true);
    let totalExtracted = 0;
    let round = 0;
    let remaining = -1;
    while (true) {
      round++;
      setBeneficiaryStatus(`Batch ${round}: AI is identifying beneficiaries... (${totalExtracted} done so far${remaining > 0 ? `, ~${remaining} remaining` : ""})`);
      try {
        const res = await fetch("/api/ai/extract-beneficiaries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instructions: aiInstructions, context: investigationContext + accountContextForAI }),
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
        if (data.error) { setBeneficiaryStatus("Error: " + data.error); break; }
        totalExtracted += data.extracted || 0;
        remaining = data.remaining || 0;
        if (data.done || data.remaining === 0) {
          setBeneficiaryStatus(`Done! Identified beneficiaries for ${totalExtracted} transactions across ${round} batches.`);
          loadTransactions();
          break;
        }
      } catch (err: any) { setBeneficiaryStatus("Error: " + err.message); break; }
    }
    setBeneficiaryLoading(false);
  };

  const runAutoMatch = async () => {
    setAutoMatchLoading(true);
    setAutoMatchStatus("Scanning for matching transactions...");
    setAutoMatchResults(null);
    try {
      const res = await fetch("/api/transactions/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto-match", dateDays: 3, amountTolerance: 1 }),
      });
      const data = await res.json();
      if (data.error) { setAutoMatchStatus("Error: " + data.error); }
      else {
        setAutoMatchResults(data.matches || []);
        setAutoMatchStatus(data.message);
      }
    } catch (err: any) { setAutoMatchStatus("Error: " + err.message); }
    setAutoMatchLoading(false);
  };

  const applyAutoMatch = async (outId: number, inId: number) => {
    await fetch("/api/transactions/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", ids: [outId, inId] }),
    });
    // Remove from results
    setAutoMatchResults(prev => prev ? prev.filter(m => m.outId !== outId || m.inId !== inId) : null);
    loadTransactions();
  };

  const applyAllAutoMatches = async () => {
    if (!autoMatchResults) return;
    setAutoMatchLoading(true);
    setAutoMatchStatus("Applying all matches...");
    // Group by outId to avoid linking one transaction to multiple
    const used = new Set<number>();
    for (const m of autoMatchResults) {
      if (used.has(m.outId) || used.has(m.inId)) continue;
      await fetch("/api/transactions/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", ids: [m.outId, m.inId] }),
      });
      used.add(m.outId);
      used.add(m.inId);
    }
    setAutoMatchResults(null);
    setAutoMatchStatus(`Applied ${used.size / 2} matches`);
    setAutoMatchLoading(false);
    loadTransactions();
  };

  const traceFlow = async (txnId: number) => {
    setTraceLoading(true);
    setTraceData(null);
    try {
      const res = await fetch("/api/ai/trace-flow", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: txnId, mode: "trace", context: investigationContext }),
      });
      setTraceData(await res.json());
    } catch {}
    setTraceLoading(false);
  };

  const loadSankey = async () => {
    setSankeyLoading(true);
    try {
      const res = await fetch("/api/ai/trace-flow", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "sankey" }),
      });
      setSankeyData(await res.json());
    } catch {}
    setSankeyLoading(false);
  };

  const linkSelected = async () => {
    if (selectedIds.size < 2) return;
    await fetch("/api/transactions/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", ids: [...selectedIds] }),
    });
    loadTransactions();
    setSelectedIds(new Set());
  };

  const viewMatchGroup = async (group: string) => {
    setMatchGroupView(group);
    const res = await fetch(`/api/transactions/match?group=${encodeURIComponent(group)}`, { cache: "no-store" });
    const data = await res.json();
    if (Array.isArray(data)) setMatchGroupTxns(data);
  };

  const unlinkMatchGroup = async (group: string) => {
    const res = await fetch("/api/transactions/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlink", ids: matchGroupTxns.map(t => t.id) }),
    });
    setMatchGroupView(null);
    setMatchGroupTxns([]);
    loadTransactions();
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} transactions? This cannot be undone.`)) return;
    await fetch("/api/transactions/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds] }),
    });
    loadTransactions();
    loadStats();
  };

  // ── AI ───
  const runAiPreview = async () => {
    setAiLoading(true);
    setAiPreview(null);
    setAiStatus({ type: "info", msg: "AI is analyzing transactions. This may take a moment..." });
    try {
      const res = await fetch("/api/ai/categorize-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: aiInstructions, context: investigationContext + accountContextForAI }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
      if (data.error) { setAiStatus({ type: "error", msg: data.error }); }
      else if (data.preview && data.preview.length > 0) {
        setAiPreview(data.preview);
        setAiPreviewAccepted(new Set(data.preview.map((p: any) => p.id)));
        const flagged = data.preview.filter((r: any) => r.flag === "suspicious" || r.flag === "critical").length;
        setAiStatus({ type: "success", msg: `${data.preview.length} proposals ready (max 100 per run). ${flagged} flagged suspicious/critical. Review below and apply. Run again for more.` });
      } else {
        setAiStatus({ type: "success", msg: data.message || "No transactions to categorize." });
      }
    } catch (err: any) { setAiStatus({ type: "error", msg: err.message }); }
    setAiLoading(false);
  };

  const applyAiPreview = async () => {
    if (!aiPreview) return;
    const accepted = aiPreview.filter(p => aiPreviewAccepted.has(p.id));
    if (accepted.length === 0) { setAiStatus({ type: "error", msg: "No proposals selected to apply." }); return; }
    setAiLoading(true);
    setAiStatus({ type: "info", msg: `Applying ${accepted.length} categorizations...` });
    try {
      const res = await fetch("/api/ai/categorize-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposals: accepted, action: "apply" }),
      });
      const data = await res.json();
      if (data.error) { setAiStatus({ type: "error", msg: data.error }); }
      else {
        setAiUndoSnapshot(data.snapshot);
        setAiPreview(null);
        setAiStatus({ type: "success", msg: `${data.applied} categorizations applied. Click "Undo" to revert.` });
        loadStats();
      }
    } catch (err: any) { setAiStatus({ type: "error", msg: err.message }); }
    setAiLoading(false);
  };

  const undoAiCategorize = async () => {
    if (!aiUndoSnapshot) return;
    setAiLoading(true);
    setAiStatus({ type: "info", msg: "Reverting..." });
    try {
      const res = await fetch("/api/ai/categorize-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposals: aiUndoSnapshot, action: "undo" }),
      });
      const data = await res.json();
      setAiUndoSnapshot(null);
      setAiStatus({ type: "success", msg: data.message });
      loadStats();
    } catch (err: any) { setAiStatus({ type: "error", msg: err.message }); }
    setAiLoading(false);
  };

  // ── Expanded rows ───
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [aiCategorizingIds, setAiCategorizingIds] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => {
    const next = new Set(expandedRows);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedRows(next);
  };

  const aiCategorizeSingle = async (id: number) => {
    setAiCategorizingIds(prev => { const n = new Set(prev); n.add(id); return n; });
    try {
      const res = await fetch("/api/ai/categorize-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, instructions: aiInstructions, context: investigationContext + accountContextForAI }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
      if (!data.error) {
        // Update the transaction in-place
        setTransactions(prev => prev.map(t => t.id === id ? {
          ...t, category: data.category, subcategory: data.subcategory,
          flag: data.flag, notes: `[AI: ${data.confidence}] ${data.reasoning}`,
          categorized_by: "ai",
          ...(data.direction ? { direction: data.direction } : {}),
        } : t));
      }
    } catch {}
    setAiCategorizingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  // ── Derived ───
  const suspiciousTxns = transactions.filter(t =>
    t.flag !== "disqualified" && (t.flag === "suspicious" || t.flag === "critical" || t.flag === "verified_fraud" || (t.category && t.category.startsWith("SUSPICIOUS")))
  );

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };
  const toggleAll = () => {
    if (selectedIds.size === transactions.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(transactions.map(t => t.id)));
  };

  const handleSort = (field: string) => {
    setSort(prev => prev.field === field ? { field, desc: !prev.desc } : { field, desc: false });
  };

  // ── Components ───
  const FlagBadge = ({ flag }: { flag: string }) => {
    if (!flag) return null;
    const colors: Record<string, string> = {
      normal: "bg-emerald-50 text-emerald-700 border border-emerald-200",
      review: "bg-amber-50 text-amber-700 border border-amber-200",
      suspicious: "bg-orange-50 text-orange-700 border border-orange-200",
      critical: "bg-red-50 text-red-700 border border-red-200",
      verified_fraud: "bg-red-600 text-white border border-red-600",
      disqualified: "bg-gray-100 text-gray-400 border border-gray-200 line-through",
    };
    const label = flag === "verified_fraud" ? "FRAUD" : flag === "disqualified" ? "DISQUALIFIED" : flag;
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${colors[flag] || ""}`}>{label}</span>;
  };

  const SourceBadge = ({ src }: { src: string }) => {
    if (!src) return null;
    const c = src === "manual" ? "bg-indigo-50 text-indigo-600" : "bg-amber-50 text-amber-600";
    return <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c}`}>{src}</span>;
  };

  const StatusMsg = ({ status }: { status: { type: string; msg: string } | null }) => {
    if (!status) return null;
    const styles: Record<string, string> = {
      success: "border-emerald-200 bg-emerald-50 text-emerald-800",
      error: "border-red-200 bg-red-50 text-red-800",
      info: "border-blue-200 bg-blue-50 text-blue-800",
    };
    return <div className={`mt-3 px-4 py-3 rounded-xl border text-sm ${styles[status.type] || ""}`}>{status.msg}</div>;
  };

  const CollapsibleSection = ({ title, subtitle, defaultOpen = false, children }: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
      <div className="border border-[var(--border)] rounded-2xl overflow-hidden">
        <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--bg-muted)] transition-colors text-left">
          <div>
            <div className="text-sm font-semibold text-[var(--text)]">{title}</div>
            {subtitle && <div className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</div>}
          </div>
          <svg className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && <div className="px-5 pb-5 border-t border-[var(--border-subtle)]">{children}</div>}
      </div>
    );
  };

  const navIcons: Record<string, string> = {
    dashboard: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    upload: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
    transactions: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    categorize: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
    analytics: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    suspicious: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
    settings: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z",
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <nav className="w-[var(--sidebar-w)] bg-white border-r border-[var(--border)] flex flex-col fixed top-0 bottom-0 z-20">
        <div className="px-5 pt-6 pb-5">
          <h1 className="text-base font-bold text-[var(--text)] tracking-tight">ADECARTE</h1>
        </div>

        <div className="px-3 flex-1 overflow-y-auto">
          <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider px-2 mb-2">Investigation</div>
          <div className="space-y-0.5">
            {([["dashboard", "Dashboard"], ["upload", "Upload CSV"], ["transactions", "Transactions"], ["categorize", "Categorize"], ["analytics", "Analytics"], ["suspicious", "Suspicious"], ["settings", "Settings"]] as [Tab, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  tab === key
                    ? "bg-[var(--bg-active)] text-[var(--text)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-muted)]"
                }`}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={navIcons[key] || navIcons.dashboard} />
                </svg>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-[var(--border)] space-y-2">
          <a href="/api/export"
            className="flex items-center justify-center gap-2 w-full text-[13px] font-medium px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-muted)] transition-all">
            Export CSV
          </a>
          <button onClick={() => setDarkMode(!darkMode)}
            className="flex items-center justify-center gap-2 w-full text-[13px] font-medium px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-muted)] transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              {darkMode ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              )}
            </svg>
            {darkMode ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </nav>

      {/* Main */}
      <main className="ml-[var(--sidebar-w)] flex-1 min-w-0 bg-[var(--bg-page)]">

        {/* ═══ Dashboard ═══ */}
        {tab === "dashboard" && stats && (
          <div className="p-6 lg:p-8 max-w-[1600px]">
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-[var(--text)]">Dashboard</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Investigation overview and key metrics</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 mb-4">
              {([
                ["Total Txns", stats.total_transactions, "", ""],
                ["Net Amount", fmt(stats.total_amount), "", ""],
                ["Deposits", fmt(stats.total_deposits), `${stats.deposit_count} txns`, "green"],
                ["Withdrawals", fmt(stats.total_withdrawals), `${stats.withdrawal_count} txns`, "red"],
                ["Suspicious", fmt(stats.suspicious_amount), `${stats.suspicious_count || 0} txns`, "alert"],
              ] as [string, any, string, string][]).map(([label, value, sub, color], i) => (
                <div key={i} className={`rounded-xl p-4 transition-all ${
                  color === "alert" ? "bg-orange-500/5 ring-1 ring-orange-500/20" :
                  color === "green" ? "bg-emerald-500/5 ring-1 ring-emerald-500/15" :
                  color === "red" ? "bg-red-50 ring-1 ring-red-500/15" :
                  "bg-[var(--bg-card)] ring-1 ring-[var(--border)]"
                }`}>
                  <div className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">{label}</div>
                  <div className={`text-lg font-bold mt-1.5 tracking-tight ${
                    color === "green" ? "text-emerald-600" :
                    color === "red" || color === "alert" ? "text-red-600" : "text-[var(--text)]"
                  }`}>{String(value)}</div>
                  {sub && <div className="text-[10px] text-[var(--text-muted)] mt-1">{sub}</div>}
                </div>
              ))}
            </div>

            {/* Second row: Fraud + Loan */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 mb-8">
              <div className="rounded-xl p-4 bg-red-50 ring-1 ring-red-200">
                <div className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">Verified Fraud</div>
                <div className="text-lg font-bold mt-1.5 text-red-600">{fmt(stats.verified_fraud_amount)}</div>
                <div className="text-[10px] text-[var(--text-muted)] mt-1">{stats.verified_fraud_count} txns</div>
              </div>
              <div className="rounded-xl p-4 bg-purple-50 ring-1 ring-purple-200">
                <div className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">LOC Drawn</div>
                <div className="text-lg font-bold mt-1.5 text-purple-600">{fmt(stats.loan_disbursed)}</div>
              </div>
              <div className="rounded-xl p-4 bg-purple-50 ring-1 ring-purple-200">
                <div className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">LOC Repaid</div>
                <div className="text-lg font-bold mt-1.5 text-purple-600">{fmt(stats.loan_repaid)}</div>
                <div className="text-[10px] text-[var(--text-muted)] mt-1">principal only</div>
              </div>
              <div className="rounded-xl p-4 bg-purple-50 ring-1 ring-purple-200">
                <div className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">LOC Outstanding</div>
                <div className="text-lg font-bold mt-1.5 text-purple-700">{fmt(stats.loan_outstanding)}</div>
              </div>
              <div className="rounded-xl p-4 bg-purple-50 ring-1 ring-purple-200">
                <div className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">LOC Interest Cost</div>
                <div className="text-lg font-bold mt-1.5 text-purple-600">{fmt(stats.loan_interest || 0)}</div>
              </div>
              <div className="rounded-xl p-4 bg-[var(--bg-card)] ring-1 ring-[var(--border)]">
                <div className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">Categorized</div>
                <div className="text-lg font-bold mt-1.5">{stats.categorized} / {stats.total_transactions}</div>
                <div className="text-[10px] text-[var(--text-muted)] mt-1">{stats.uncategorized} remaining</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
                <h3 className="text-sm font-semibold text-[var(--text)] mb-3">By Category</h3>
                <div className="max-h-72 overflow-y-auto space-y-1">
                  {stats.by_category.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No data yet</p> :
                    stats.by_category.map((c, i) => (
                      <div key={i} className="flex justify-between text-sm py-1 border-b border-[var(--border-subtle)]">
                        <span className="flex-1 truncate">{c.category}</span>
                        <span className="text-[var(--text-muted)] mx-3">{c.count}</span>
                        <span className="font-semibold tabular-nums">{fmt(c.total_amount)}</span>
                      </div>
                    ))}
                </div>
              </div>
              <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
                <h3 className="font-semibold mb-3">By Flag</h3>
                <div className="space-y-1">
                  {stats.by_flag.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No data yet</p> :
                    stats.by_flag.map((f, i) => (
                      <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-[var(--border-subtle)]">
                        <FlagBadge flag={f.flag} />
                        <span className="text-[var(--text-muted)] mx-3">{f.count}</span>
                        <span className="font-semibold tabular-nums">{fmt(f.total_amount)}</span>
                      </div>
                    ))}
                </div>
              </div>
              <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
                <h3 className="font-semibold mb-3">Suspicious Breakdown</h3>
                <div className="space-y-1">
                  {stats.suspicious_breakdown.length === 0 ? <p className="text-sm text-[var(--text-muted)]">None detected</p> :
                    stats.suspicious_breakdown.map((s, i) => (
                      <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-[var(--border-subtle)]">
                        <span className="flex-1 truncate">{s.category}</span>
                        <FlagBadge flag={s.flag} />
                        <span className="text-[var(--text-muted)] mx-2">{s.count}</span>
                        <span className="font-semibold text-red-600 tabular-nums">{fmt(s.total_amount)}</span>
                      </div>
                    ))}
                </div>
              </div>
              <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
                <h3 className="font-semibold mb-3">By Account</h3>
                <div className="max-h-72 overflow-y-auto">
                  {!stats.by_account || stats.by_account.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No data yet</p> :
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[var(--text-muted)] uppercase text-[10px]">
                          <th className="text-left py-1 pr-2">Account</th>
                          <th className="text-right py-1 px-1">Deposits</th>
                          <th className="text-right py-1 px-1">Withdrawals</th>
                          <th className="text-right py-1 pl-2">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.by_account.map((a: any, i: number) => (
                          <tr key={i} className="border-t border-[var(--border)]">
                            <td className="py-1.5 pr-2 font-medium truncate max-w-[100px]">{a.account}</td>
                            <td className="py-1.5 px-1 text-right text-emerald-600 tabular-nums">
                              <div>{fmt(a.deposit_amount)}</div>
                              <div className="text-[9px] text-[var(--text-muted)]">{a.deposits} txns</div>
                            </td>
                            <td className="py-1.5 px-1 text-right text-red-600 tabular-nums">
                              <div>{fmt(a.withdrawal_amount)}</div>
                              <div className="text-[9px] text-[var(--text-muted)]">{a.withdrawals} txns</div>
                            </td>
                            <td className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${a.total_amount < 0 ? "text-red-600" : "text-emerald-600"}`}>
                              {fmt(a.total_amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Upload ═══ */}
        {tab === "upload" && (
          <div className="p-6 lg:p-8 max-w-[1600px]">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-[var(--text)]">Upload Transactions</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Import CSV files with transaction data</p>
            </div>
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
              {!csvFile ? (
                <div
                  className="border-2 border-dashed border-[var(--border)] rounded-lg p-12 text-center cursor-pointer hover:border-indigo-400 transition-colors"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("border-indigo-400"); }}
                  onDragLeave={e => e.currentTarget.classList.remove("border-indigo-400")}
                  onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("border-indigo-400"); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); }}
                >
                  <p className="text-[var(--text-muted)] mb-4">Drag & drop a CSV file here, or click to browse</p>
                  <button className="px-4 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-md text-sm hover:bg-[var(--bg-muted)]">Choose File</button>
                  <input ref={fileRef} type="file" accept=".csv" hidden onChange={e => { if (e.target.files?.length) handleFile(e.target.files[0]); }} />
                </div>
              ) : (
                <>
                  <h3 className="font-semibold mb-3">Column Mapping</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {["date", "settle_date", "description", "amount", "unit_price", "quantity", "currency", "account", "account_name", "bank", "reference", "counterparty", "symbol", "security", "strategy", "direction"].map(f => (
                      <div key={f} className="flex flex-col gap-1">
                        <label className="text-xs text-[var(--text-muted)] capitalize">{f}</label>
                        <select
                          className="bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded px-2 py-1.5 text-sm"
                          value={fieldMap[f] || ""}
                          onChange={e => setFieldMap(prev => ({ ...prev, [f]: e.target.value }))}
                        >
                          <option value="">-- skip --</option>
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  {csvPreview.length > 0 && (
                    <div className="overflow-x-auto mb-4">
                      <table className="w-full text-xs border border-[var(--border)] rounded">
                        <thead><tr>{csvHeaders.map(h => <th key={h} className="bg-[var(--bg-muted)] text-[var(--text-muted)] px-2 py-1 text-left">{h}</th>)}</tr></thead>
                        <tbody>{csvPreview.map((row, i) => <tr key={i}>{csvHeaders.map(h => <td key={h} className="px-2 py-1 border-b border-[var(--border-subtle)]">{row[h]}</td>)}</tr>)}</tbody>
                      </table>
                      <p className="text-xs text-[var(--text-muted)] mt-1">Showing first {csvPreview.length} rows</p>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button onClick={confirmUpload} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 transition-colors rounded-md text-sm font-medium">Upload & Import</button>
                    <button onClick={() => { setCsvFile(null); setCsvHeaders([]); setCsvPreview([]); setUploadStatus(null); }} className="px-4 py-2 border border-[var(--border)] rounded-md text-sm hover:bg-[var(--bg-muted)]">Cancel</button>
                  </div>
                </>
              )}
              <StatusMsg status={uploadStatus} />
            </div>
          </div>
        )}

        {/* ═══ All Transactions ═══ */}
        {tab === "transactions" && (
          <div className="p-6 lg:p-8">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-[var(--text)]">Transactions</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {transactions.length} transactions shown
                {transactions.length >= 10000 && <span className="text-amber-600 ml-2">(limit reached — some transactions may not be shown)</span>}
                {(filters.search || filters.category || filters.flag || filters.min || filters.max || filters.bank || filters.account || filters.direction || filters.counterparty || filters.dateFrom || filters.dateTo || filters.source || filters.excludeFlags.length > 0 || filters.extBank) && <span className="ml-2">(filtered — KPIs reflect filtered results only)</span>}
              </p>
            </div>

            {/* KPIs — computed from visible transactions */}
            {(() => {
              const hasFilters = filters.search || filters.category || filters.flag || filters.min || filters.max || filters.bank || filters.account || filters.direction || filters.counterparty || filters.dateFrom || filters.dateTo || filters.source || filters.excludeFlags.length > 0 || filters.extBank;
              const active = transactions.filter(t => t.flag !== "disqualified");
              const flowTxns = active.filter(t => !isExcludedFromFlow(t));
              const deps = flowTxns.filter(t => t.amount > 0);
              const withs = flowTxns.filter(t => t.amount < 0);
              const totalDep = deps.reduce((s, t) => s + t.amount, 0);
              const totalWith = withs.reduce((s, t) => s + Math.abs(t.amount), 0);
              const net = totalDep - totalWith;
              const susp = active.filter(t => t.flag === "suspicious" || t.flag === "critical" || t.flag === "verified_fraud");
              const uncat = active.filter(t => !t.category);
              return (
                <div className="mb-5">
                  {hasFilters && <p className="text-[10px] text-amber-600 mb-2 font-medium">Showing KPIs for filtered results only</p>}
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                    {([
                      ["Deposits", fmt(totalDep), `${deps.length} txns`, "text-emerald-600"],
                      ["Withdrawals", fmt(totalWith), `${withs.length} txns`, "text-red-600"],
                      ["Net", fmt(net), "", net >= 0 ? "text-emerald-600" : "text-red-600"],
                      ["Suspicious", `${susp.length}`, "", "text-orange-600"],
                      ["Verified Fraud", `${active.filter(t => t.flag === "verified_fraud").length}`, "", "text-red-600"],
                      ["Uncategorized", `${uncat.length}`, "", "text-[var(--text-muted)]"],
                    ] as [string, string, string, string][]).map(([label, value, sub, color], i) => (
                      <div key={i} className="bg-white border border-[var(--border)] rounded-xl px-4 py-3">
                        <div className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">{label}</div>
                        <div className={`text-lg font-bold mt-0.5 ${color}`}>{value}</div>
                        {sub && <div className="text-[10px] text-[var(--text-muted)]">{sub}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* AI Tools Bar */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button onClick={fillBeneficiaries} disabled={beneficiaryLoading}
                className="px-4 py-2 bg-purple-50 border border-purple-200 text-purple-600 hover:bg-purple-100 disabled:opacity-50 rounded-xl text-sm font-medium">
                {beneficiaryLoading ? <><span className="spinner mr-2"></span>Running...</> : "AI Fill Beneficiaries"}
              </button>
              <button onClick={fillExtBanks} disabled={extBankLoading}
                className="px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 rounded-xl text-sm font-medium">
                {extBankLoading ? <><span className="spinner mr-2"></span>Running...</> : "AI Fill Ext Banks"}
              </button>
              <button onClick={runAutoMatch} disabled={autoMatchLoading}
                className="px-4 py-2 bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 disabled:opacity-50 rounded-xl text-sm font-medium">
                {autoMatchLoading ? <><span className="spinner mr-2"></span>Scanning...</> : "Auto-Match Transfers"}
              </button>
              {beneficiaryStatus && <span className="text-xs text-[var(--text-muted)]">{beneficiaryStatus}</span>}
              {extBankStatus && <span className="text-xs text-[var(--text-muted)]">{extBankStatus}</span>}
              {autoMatchStatus && <span className="text-xs text-[var(--text-muted)]">{autoMatchStatus}</span>}
              <div className="ml-auto flex gap-2">
                <button onClick={() => exportTransactions(transactions)}
                  className="px-3 py-2 border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] rounded-xl text-xs font-medium">
                  Export All ({transactions.length})
                </button>
                {selectedIds.size > 0 && (
                  <button onClick={() => exportTransactions(transactions.filter(t => selectedIds.has(t.id)))}
                    className="px-3 py-2 border border-indigo-300 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl text-xs font-medium">
                    Export Selected ({selectedIds.size})
                  </button>
                )}
              </div>
            </div>

            {/* Auto-Match Results */}
            {autoMatchResults && autoMatchResults.length > 0 && (
              <div className="bg-white border border-blue-200 rounded-2xl shadow-sm p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-blue-600">Potential Matches Found</h3>
                    <p className="text-xs text-[var(--text-muted)]">{autoMatchResults.length} pairs — review and apply</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={applyAllAutoMatches} disabled={autoMatchLoading}
                      className="px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 rounded-lg text-xs font-medium">
                      Apply All ({autoMatchResults.length})
                    </button>
                    <button onClick={() => setAutoMatchResults(null)}
                      className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--bg-muted)]">Dismiss</button>
                  </div>
                </div>
                <div className="max-h-[350px] overflow-y-auto space-y-2">
                  {autoMatchResults.map((m: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-3 border border-[var(--border)] rounded-xl text-xs">
                      {/* Outflow side */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--text-muted)]">{m.outAccount}</div>
                        <div className="text-red-600 font-semibold tabular-nums">{fmt(m.outAmount)}</div>
                        <div className="text-[var(--text-muted)]">{m.outDate}</div>
                      </div>
                      <div className="flex-shrink-0">
                        <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </div>
                      {/* Inflow side */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--text-muted)]">{m.inAccount}</div>
                        <div className="text-emerald-600 font-semibold tabular-nums">{fmt(m.inAmount)}</div>
                        <div className="text-[var(--text-muted)]">{m.inDate}</div>
                      </div>
                      {/* Confidence + action */}
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.confidence >= 0.8 ? "bg-emerald-50 text-emerald-600" : m.confidence >= 0.6 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}>
                        {(m.confidence * 100).toFixed(0)}%
                      </span>
                      <button onClick={() => applyAutoMatch(m.outId, m.inId)}
                        className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 rounded text-[10px] font-medium flex-shrink-0">
                        Link
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search + Filter Button */}
            <div className="flex gap-2 mb-4 items-center">
              <input placeholder="Search descriptions, receiving entities, beneficiaries..." className="bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2.5 flex-1"
                value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") loadTransactions(); }} />
              <button onClick={() => setShowFilterSidebar(true)}
                className={`px-4 py-2.5 border rounded-lg text-sm font-medium flex items-center gap-2 ${
                  (filters.search || filters.category || filters.flag || filters.min || filters.max || filters.bank || filters.account || filters.direction || filters.counterparty || filters.dateFrom || filters.dateTo || filters.source || filters.excludeFlags.length > 0 || filters.extBank)
                    ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
                }`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Filters
                {(() => { const count = [filters.category, filters.flag, filters.direction, filters.bank, filters.account, filters.counterparty, filters.source, filters.dateFrom, filters.dateTo, filters.min, filters.max, filters.extBank].filter(Boolean).length + filters.excludeFlags.length; return count > 0 ? <span className="bg-indigo-600 text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center">{count}</span> : null; })()}
              </button>
              <button onClick={loadTransactions} className="px-4 py-2.5 bg-[var(--text)] text-[var(--bg)] rounded-lg text-sm font-medium hover:opacity-80">Apply</button>
              {(filters.search || filters.category || filters.flag || filters.min || filters.max || filters.bank || filters.account || filters.direction || filters.counterparty || filters.dateFrom || filters.dateTo || filters.source || filters.excludeFlags.length > 0 || filters.extBank) && (
                <button onClick={() => { setFilters({ search: "", category: "", flag: "", min: "", max: "", bank: "", account: "", direction: "", counterparty: "", dateFrom: "", dateTo: "", source: "", excludeFlags: [], extBank: "" }); }}
                  className="text-xs text-red-600 hover:underline">Clear</button>
              )}
            </div>

            {/* Filter Sidebar */}
            {showFilterSidebar && (
              <div className="fixed inset-0 z-50 flex">
                <div className="absolute inset-0 bg-black/20" onClick={() => setShowFilterSidebar(false)} />
                <div className="absolute right-0 top-0 h-full w-[380px] bg-white border-l border-[var(--border)] shadow-xl flex flex-col">
                  <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Filters</h3>
                    <div className="flex gap-2">
                      <button onClick={() => { setFilters({ search: "", category: "", flag: "", min: "", max: "", bank: "", account: "", direction: "", counterparty: "", dateFrom: "", dateTo: "", source: "", excludeFlags: [], extBank: "" }); }}
                        className="text-xs text-red-600 hover:underline">Reset All</button>
                      <button onClick={() => setShowFilterSidebar(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg">&times;</button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5 space-y-5">

                    {/* Exclude Flags (checkboxes) */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Hide Flags</label>
                      <div className="space-y-1.5">
                        {["normal", "review", "suspicious", "critical", "verified_fraud", "disqualified"].map(f => (
                          <label key={f} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[var(--bg-muted)] px-2 py-1 rounded">
                            <input type="checkbox" checked={filters.excludeFlags.includes(f)}
                              onChange={e => setFilters(p => ({ ...p, excludeFlags: e.target.checked ? [...p.excludeFlags, f] : p.excludeFlags.filter(x => x !== f) }))} />
                            <FlagBadge flag={f} />
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Show Only Flag */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Show Only Flag</label>
                      <select className="w-full bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                        value={filters.flag} onChange={e => setFilters(p => ({ ...p, flag: e.target.value }))}>
                        <option value="">All</option>
                        {["normal", "review", "suspicious", "critical", "verified_fraud", "disqualified"].map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>

                    {/* Direction */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Direction</label>
                      <div className="space-y-1.5">
                        {[["", "All"], ["Contribution", "Contribution"], ["Withdraw", "Withdraw"], ["Internal Transfer", "Internal Transfer"]].map(([val, label]) => (
                          <label key={val} className={`flex items-center gap-2 text-sm cursor-pointer px-2 py-1 rounded ${filters.direction === val ? "bg-indigo-50 text-indigo-600" : "hover:bg-[var(--bg-muted)]"}`}>
                            <input type="radio" name="dir" checked={filters.direction === val} onChange={() => setFilters(p => ({ ...p, direction: val }))} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Category */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Category</label>
                      <select className="w-full bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                        value={filters.category} onChange={e => setFilters(p => ({ ...p, category: e.target.value }))}>
                        <option value="">All Categories</option>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.is_suspicious ? "⚠ " : ""}{c.name}</option>)}
                      </select>
                    </div>

                    {/* Bank */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Bank</label>
                      <select className="w-full bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                        value={filters.bank} onChange={e => setFilters(p => ({ ...p, bank: e.target.value }))}>
                        <option value="">All Banks</option>
                        {allBanks.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>

                    {/* Account */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Account</label>
                      <select className="w-full bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                        value={filters.account} onChange={e => setFilters(p => ({ ...p, account: e.target.value }))}>
                        <option value="">All Accounts</option>
                        {allAccounts.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>

                    {/* Receiving Entity */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Receiving Entity</label>
                      <select className="w-full bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                        value={filters.counterparty} onChange={e => setFilters(p => ({ ...p, counterparty: e.target.value }))}>
                        <option value="">All</option>
                        {allCounterparties.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    {/* External Bank */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">External Bank</label>
                      <input className="w-full bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                        placeholder="e.g. Wells Fargo, Banca Mifel..."
                        value={filters.extBank} onChange={e => setFilters(p => ({ ...p, extBank: e.target.value }))} />
                    </div>

                    {/* Source */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Categorized By</label>
                      <select className="w-full bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                        value={filters.source} onChange={e => setFilters(p => ({ ...p, source: e.target.value }))}>
                        <option value="">All</option>
                        <option value="manual">Manual</option>
                        <option value="ai">AI</option>
                      </select>
                    </div>

                    {/* Date Range */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Date Range</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-[var(--text-muted)]">From</label>
                          <input type="date" className="w-full bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-2 py-2"
                            value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-[10px] text-[var(--text-muted)]">To</label>
                          <input type="date" className="w-full bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-2 py-2"
                            value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} />
                        </div>
                      </div>
                    </div>

                    {/* Amount Range */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text)] mb-2">Amount Range</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="number" placeholder="Min $" className="bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                          value={filters.min} onChange={e => setFilters(p => ({ ...p, min: e.target.value }))} />
                        <input type="number" placeholder="Max $" className="bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                          value={filters.max} onChange={e => setFilters(p => ({ ...p, max: e.target.value }))} />
                      </div>
                    </div>
                  </div>

                  {/* Apply button */}
                  <div className="p-4 border-t border-[var(--border)]">
                    <button onClick={() => { loadTransactions(); setShowFilterSidebar(false); }}
                      className="w-full px-4 py-2.5 bg-[var(--text)] text-[var(--bg)] rounded-lg text-sm font-semibold hover:opacity-80">
                      Apply Filters
                    </button>
                  </div>
                </div>
              </div>
            )}
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-3 p-3 bg-[var(--bg-card)] border border-indigo-500 rounded-lg sticky top-0 z-10">
                <span className="text-sm font-semibold">{selectedIds.size} selected</span>
                <div className="h-4 w-px bg-[var(--border)]" />
                <select className="bg-[var(--bg)] ring-1 ring-[var(--border)] text-sm rounded-lg px-2.5 py-1.5 text-[var(--text)]" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}>
                  <option value="">Set Category...</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <select className="bg-[var(--bg)] ring-1 ring-[var(--border)] text-sm rounded-lg px-2.5 py-1.5 text-[var(--text)]" value={bulkFlag} onChange={e => setBulkFlag(e.target.value)}>
                  <option value="">Set Flag...</option>
                  {["normal", "review", "suspicious", "critical", "verified_fraud", "disqualified"].map(f => <option key={f} value={f}>{f === "verified_fraud" ? "VERIFIED FRAUD" : f === "disqualified" ? "DISQUALIFIED" : f}</option>)}
                </select>
                <select className="bg-[var(--bg)] ring-1 ring-[var(--border)] text-sm rounded-lg px-2.5 py-1.5 text-[var(--text)]" value={bulkDirection} onChange={e => setBulkDirection(e.target.value)}>
                  <option value="">Set Direction...</option>
                  <option value="Contribution">Contribution</option>
                  <option value="Withdraw">Withdraw</option>
                  <option value="Internal Transfer">Internal Transfer</option>
                </select>
                <input className="bg-[var(--bg)] ring-1 ring-[var(--border)] text-sm rounded-lg px-2.5 py-1.5 text-[var(--text)] w-36"
                  placeholder="Set Beneficiary..." value={bulkBeneficiary} onChange={e => setBulkBeneficiary(e.target.value)} />
                <button onClick={applyBulk} className="px-3 py-1 bg-indigo-500 hover:bg-indigo-400 transition-colors rounded text-sm">Apply</button>
                <div className="h-4 w-px bg-[var(--border)]" />
                <button onClick={bulkAiCategorize} disabled={bulkAiLoading}
                  className="px-3 py-1 bg-amber-50 border border-amber-200 text-amber-600 hover:bg-amber-100 disabled:opacity-50 rounded text-sm font-medium">
                  {bulkAiLoading ? <><span className="spinner" style={{width:12,height:12,borderWidth:1.5}}></span> AI...</> : `AI Categorize (${selectedIds.size})`}
                </button>
                {selectedIds.size >= 2 && (<>
                  <div className="h-4 w-px bg-[var(--border)]" />
                  <button onClick={linkSelected}
                    className="px-3 py-1 bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 rounded text-sm font-medium">
                    Link Match ({selectedIds.size})
                  </button>
                </>)}
                <div className="h-4 w-px bg-[var(--border)]" />
                <button onClick={bulkDelete}
                  className="px-3 py-1 bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 rounded text-sm font-medium">
                  Delete ({selectedIds.size})
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-[var(--border)] rounded-2xl">
                <thead>
                  <tr>
                    <th className="bg-[var(--bg-muted)] px-3 py-2"><input type="checkbox" onChange={toggleAll} checked={selectedIds.size === transactions.length && transactions.length > 0} /></th>
                    {([
                      ["date", "Trade Date"], ["description", "Description"], ["amount", "Amount"],
                      ["settle_date", "Settle Date"], ["symbol", "Symbol"], ["security", "Security"],
                      ["direction", "Direction"], ["quantity", "Qty"], ["unit_price", "Unit Price"],
                      ["account_name", "Account"], ["bank", "Bank"], ["strategy", "Strategy"], ["counterparty", "Receiving Entity"], ["beneficiary", "Beneficiary"], ["ext_bank", "Ext Bank"],
                      ["category", "Category"], ["flag", "Flag"], ["match_group", "Match"], ["fraudulent_signature", "Sig"], ["categorized_by", "Source"],
                    ] as [string, string][]).map(([f, l]) => (
                      <th key={f} className="bg-[var(--bg-muted)] text-[var(--text-muted)] text-xs uppercase tracking-wide px-3 py-2 text-left cursor-pointer hover:text-white select-none"
                        onClick={() => handleSort(f)}>
                        {l} {sort.field === f ? (sort.desc ? "↓" : "↑") : ""}
                      </th>
                    ))}
                    <th className="bg-[var(--bg-muted)] text-[var(--text-muted)] text-xs uppercase px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr><td colSpan={17} className="text-center text-[var(--text-muted)] py-8">No transactions found. Upload a CSV to get started.</td></tr>
                  ) : transactions.map(t => {
                    const dirLower = (t.direction || "").toLowerCase();
                    const dirColor = dirLower.match(/internal|transfer between/)
                      ? "text-amber-600 font-semibold"
                      : dirLower.match(/^(buy|in|incoming|deposit|credit|contribut|receive)/)
                        ? "text-emerald-600 font-semibold"
                        : dirLower ? "text-red-600 font-semibold" : "";
                    const expanded = expandedRows.has(t.id);
                    return (
                    <tr key={t.id} className={`hover:bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] align-top ${t.flag === "disqualified" ? "opacity-40" : ""}`}>
                      <td className="px-3 py-2"><input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{t.date || "-"}</td>
                      <td className="px-3 py-2 min-w-[200px]">
                        <div className={expanded ? "" : "max-w-[250px] truncate"} title={t.description}>
                          {t.description || "-"}
                        </div>
                        {t.description && t.description.length > 30 && (
                          <button onClick={() => toggleExpand(t.id)} className="text-[10px] text-indigo-600 hover:underline mt-0.5">
                            {expanded ? "collapse" : "expand"}
                          </button>
                        )}
                      </td>
                      <td className={`px-3 py-2 tabular-nums font-medium ${t.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(t.amount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{t.settle_date || "-"}</td>
                      <td className="px-3 py-2 font-mono">{t.symbol || "-"}</td>
                      <td className="px-3 py-2 min-w-[120px]">
                        <div className={expanded ? "" : "max-w-[150px] truncate"} title={t.security}>{t.security || "-"}</div>
                      </td>
                      <td className="px-3 py-2">{t.direction ? <span className={dirColor}>{t.direction}</span> : "-"}</td>
                      <td className="px-3 py-2 tabular-nums">{t.quantity || "-"}</td>
                      <td className="px-3 py-2 tabular-nums">{t.unit_price ? fmt(t.unit_price) : "-"}</td>
                      <td className="px-3 py-2">{t.account || t.account_name || "-"}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{t.bank || "-"}</td>
                      <td className="px-3 py-2">{t.strategy || "-"}</td>
                      <td className="px-3 py-2">{t.counterparty || "-"}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{t.beneficiary || "-"}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)] text-xs">{t.ext_bank || "-"}</td>
                      <td className="px-3 py-2 text-sm">{t.category || <span className="text-[var(--text-muted)]">—</span>}</td>
                      <td className="px-3 py-2"><FlagBadge flag={t.flag} /></td>
                      <td className="px-3 py-2 text-center">
                        {t.match_group ? (
                          <button onClick={() => viewMatchGroup(t.match_group)}
                            className="px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-600 rounded-full text-[10px] font-semibold hover:bg-blue-100" title="View linked transactions">
                            linked
                          </button>
                        ) : <span className="text-[var(--text-muted)] text-xs">-</span>}
                      </td>
                      <td className="px-3 py-2 text-center">{t.fraudulent_signature === true ? <span className="text-red-600 text-xs font-bold" title="Fraudulent signature detected">FRAUD</span> : t.fraudulent_signature === false ? <span className="text-emerald-600 text-xs" title="Signature verified">OK</span> : <span className="text-[var(--text-muted)] text-xs">-</span>}</td>
                      <td className="px-3 py-2"><SourceBadge src={t.categorized_by} /></td>
                      <td className="px-3 py-2 text-center flex gap-1 justify-center">
                        <button onClick={() => openEdit(t)} className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--bg-muted)]">Edit</button>
                        <button onClick={() => aiCategorizeSingle(t.id)} disabled={aiCategorizingIds.has(t.id)}
                          className="px-2 py-1 text-xs border border-amber-200 text-amber-600 rounded hover:bg-amber-50 disabled:opacity-50"
                          title="AI categorize">
                          {aiCategorizingIds.has(t.id) ? <span className="spinner" style={{width:12,height:12,borderWidth:1.5}}></span> : "AI"}
                        </button>
                        <button onClick={() => traceFlow(t.id)}
                          className="px-2 py-1 text-xs border border-blue-200 text-blue-600 rounded hover:bg-blue-50"
                          title="Trace money flow">
                          Trace
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ Categorize ═══ */}
        {tab === "categorize" && (
          <div className="p-6 lg:p-8 max-w-[1400px]">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-[var(--text)]">AI Categorization</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Configure AI context and run bulk categorization</p>
            </div>

            {/* Progress bar */}
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Progress</h3>
                <span className="text-xs text-[var(--text-muted)]">{stats?.categorized || 0} / {(stats?.categorized || 0) + (stats?.uncategorized || 0)} categorized</span>
              </div>
              <div className="w-full h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${stats ? (stats.categorized / Math.max(stats.categorized + stats.uncategorized, 1)) * 100 : 0}%` }} />
              </div>
              <div className="flex gap-6 mt-3 text-xs text-[var(--text-muted)]">
                <span>{stats?.uncategorized || 0} remaining</span>
                <span>{stats?.categorized || 0} done</span>
              </div>
            </div>

            {/* Two column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              {/* Left: Config */}
              <div className="space-y-4">
                <CollapsibleSection title="Investigation Context" subtitle="Background for all AI features" defaultOpen={!!investigationContext}>
                  <textarea
                    className="w-full bg-[var(--bg-page)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm min-h-[100px] mt-3"
                    placeholder="Describe the situation: who is suspected, which accounts, when it may have started..."
                    value={investigationContext}
                    onChange={e => { setInvestigationContext(e.target.value); if (typeof window !== "undefined") localStorage.setItem("adecarte_investigation_context", e.target.value); }}
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">Auto-saved in browser</p>
                </CollapsibleSection>

                <CollapsibleSection title="AI Instructions" subtitle="Custom rules for categorization" defaultOpen={!!aiInstructions}>
                  <textarea
                    className="w-full bg-[var(--bg-page)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm min-h-[80px] mt-3"
                    placeholder="e.g. 'Payments to John Doe are authorized. Amounts over $50k to unknown parties = critical...'"
                    value={aiInstructions}
                    onChange={e => { setAiInstructions(e.target.value); if (typeof window !== "undefined") localStorage.setItem("adecarte_ai_instructions", e.target.value); }}
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">Auto-saved in browser</p>
                </CollapsibleSection>
              </div>

              {/* Right: Action */}
              <div className="lg:col-span-2">
                <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-6">
                  <h3 className="text-sm font-semibold mb-1">Run AI Categorization</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-4">AI analyzes uncategorized transactions and proposes categories, directions, and flags. Review before applying.</p>

                  <div className="flex flex-wrap gap-2 items-center mb-4">
                    <button onClick={runAiPreview} disabled={aiLoading || (stats?.uncategorized || 0) === 0}
                      className="px-5 py-2.5 bg-[var(--text)] text-[var(--bg)] hover:opacity-80 transition-opacity disabled:opacity-30 rounded-xl text-sm font-semibold">
                      {aiLoading && !aiPreview ? <><span className="spinner mr-2"></span>Analyzing...</> : "Generate Proposals"}
                    </button>
                    {aiPreview && aiPreview.length > 0 && (
                      <>
                        <button onClick={applyAiPreview} disabled={aiLoading || aiPreviewAccepted.size === 0}
                          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 rounded-xl text-sm font-semibold text-white">
                          {aiLoading ? <><span className="spinner mr-2"></span>Applying...</> : `Apply ${aiPreviewAccepted.size} of ${aiPreview.length}`}
                        </button>
                        <button onClick={() => { setAiPreview(null); setAiStatus(null); }}
                          className="px-4 py-2.5 border border-[var(--border)] rounded-xl text-sm hover:bg-[var(--bg-muted)]">
                          Discard
                        </button>
                      </>
                    )}
                    {aiUndoSnapshot && (
                      <button onClick={undoAiCategorize} disabled={aiLoading}
                        className="px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-600 hover:bg-amber-100 disabled:opacity-50 rounded-xl text-sm font-medium">
                        Undo ({aiUndoSnapshot.length})
                      </button>
                    )}
                  </div>
                  <StatusMsg status={aiStatus} />

                  {/* Preview Table */}
                  {aiPreview && aiPreview.length > 0 && (
                    <div className="mt-4 border border-[var(--border)] rounded-xl overflow-hidden">
                      <div className="bg-[var(--bg-muted)] px-4 py-2.5 flex items-center justify-between">
                        <span className="text-xs font-semibold">{aiPreviewAccepted.size} of {aiPreview.length} selected</span>
                        <div className="flex gap-3">
                          <button onClick={() => setAiPreviewAccepted(new Set(aiPreview.map((p: any) => p.id)))}
                            className="text-xs text-indigo-600 hover:underline">All</button>
                          <button onClick={() => setAiPreviewAccepted(new Set())}
                            className="text-xs text-[var(--text-muted)] hover:underline">None</button>
                        </div>
                      </div>
                      <div className="max-h-[500px] overflow-auto">
                        <table className="w-full text-[11px]">
                          <thead><tr className="bg-[var(--bg-page)] sticky top-0 z-10 text-[var(--text-muted)]">
                            <th className="px-2 py-2 text-left w-6"></th>
                            <th className="px-2 py-2 text-left">Date</th>
                            <th className="px-2 py-2 text-left">Account</th>
                            <th className="px-2 py-2 text-left max-w-[200px]">Description</th>
                            <th className="px-2 py-2 text-right">Amount</th>
                            <th className="px-2 py-2 text-left">Category ✎</th>
                            <th className="px-2 py-2 text-left">Flag ✎</th>
                            <th className="px-2 py-2 text-left">Direction ✎</th>
                            <th className="px-2 py-2 text-left">Recv Entity ✎</th>
                            <th className="px-2 py-2 text-left">Beneficiary ✎</th>
                            <th className="px-2 py-2 text-center">Conf</th>
                            <th className="px-2 py-2 text-left max-w-[180px]">Reasoning</th>
                          </tr></thead>
                          <tbody>
                            {aiPreview.map((p: any, idx: number) => {
                              const accepted = aiPreviewAccepted.has(p.id);
                              const up = (f: string, v: string) => { const n = [...aiPreview!]; n[idx] = { ...n[idx], [f]: v }; setAiPreview(n); };
                              return (
                                <tr key={p.id} className={`border-t border-[var(--border-subtle)] ${accepted ? "hover:bg-[var(--bg-muted)]" : "opacity-30"}`}>
                                  <td className="px-2 py-1.5"><input type="checkbox" checked={accepted} onChange={() => { const n = new Set(aiPreviewAccepted); accepted ? n.delete(p.id) : n.add(p.id); setAiPreviewAccepted(n); }} /></td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">{p.original?.date || "-"}</td>
                                  <td className="px-2 py-1.5 font-mono text-[10px]">{p.original?.account || "-"}</td>
                                  <td className="px-2 py-1.5 max-w-[200px] truncate" title={p.original?.description}>{p.original?.description || "-"}</td>
                                  <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${(p.original?.amount || 0) < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(p.original?.amount)}</td>
                                  <td className="px-2 py-1"><select className="bg-transparent border border-[var(--border)] rounded px-1 py-0.5 text-[11px] w-full max-w-[140px]" value={p.category} onChange={e => up("category", e.target.value)}>
                                    <option value="">-</option>{categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                  </select></td>
                                  <td className="px-2 py-1"><select className="bg-transparent border border-[var(--border)] rounded px-1 py-0.5 text-[11px]" value={p.flag} onChange={e => up("flag", e.target.value)}>
                                    {["normal","review","suspicious","critical","verified_fraud","disqualified"].map(f => <option key={f} value={f}>{f}</option>)}
                                  </select></td>
                                  <td className="px-2 py-1"><select className="bg-transparent border border-[var(--border)] rounded px-1 py-0.5 text-[11px]" value={p.direction || ""} onChange={e => up("direction", e.target.value)}>
                                    <option value="">Keep</option><option value="Contribution">Contribution</option><option value="Withdraw">Withdraw</option><option value="Internal Transfer">Internal</option>
                                  </select></td>
                                  <td className="px-2 py-1"><input className="bg-transparent border border-[var(--border)] rounded px-1 py-0.5 text-[11px] w-full max-w-[120px]" value={p.counterparty || ""} onChange={e => up("counterparty", e.target.value)} placeholder={p.original?.counterparty || "-"} /></td>
                                  <td className="px-2 py-1"><input className="bg-transparent border border-[var(--border)] rounded px-1 py-0.5 text-[11px] w-full max-w-[120px]" value={p.beneficiary || ""} onChange={e => up("beneficiary", e.target.value)} placeholder={p.original?.beneficiary || "-"} /></td>
                                  <td className="px-2 py-1.5 text-center"><span className={`text-[10px] font-bold ${(p.confidence || 0) >= 0.8 ? "text-emerald-600" : (p.confidence || 0) >= 0.5 ? "text-amber-600" : "text-red-600"}`}>{((p.confidence || 0) * 100).toFixed(0)}%</span></td>
                                  <td className="px-2 py-1.5 max-w-[180px] truncate text-[var(--text-muted)]" title={p.reasoning}>{p.reasoning}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Suspicious ═══ */}
        {tab === "suspicious" && (() => {
          // Filter suspicious transactions
          let filtered = suspiciousTxns;
          if (suspFilter.flag !== "all") filtered = filtered.filter(t => t.flag === suspFilter.flag);
          if (suspFilter.category) filtered = filtered.filter(t => t.category === suspFilter.category);
          if (suspFilter.counterparty) filtered = filtered.filter(t => (t.counterparty || "").toLowerCase().includes(suspFilter.counterparty.toLowerCase()));
          if (suspFilter.search) {
            const s = suspFilter.search.toLowerCase();
            filtered = filtered.filter(t => (t.description || "").toLowerCase().includes(s) || (t.notes || "").toLowerCase().includes(s) || (t.counterparty || "").toLowerCase().includes(s) || (t.reference || "").toLowerCase().includes(s));
          }
          // Sort
          filtered = [...filtered].sort((a: any, b: any) => {
            let va = a[suspSort.field] ?? ""; let vb = b[suspSort.field] ?? "";
            if (typeof va === "number" && typeof vb === "number") return suspSort.desc ? vb - va : va - vb;
            return suspSort.desc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
          });

          // Computed stats
          const active = filtered.filter(t => t.flag !== "disqualified");
          const totalAmount = active.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
          const verifiedCount = filtered.filter(t => t.flag === "verified_fraud").length;
          const verifiedAmount = filtered.filter(t => t.flag === "verified_fraud").reduce((s, t) => s + Math.abs(t.amount || 0), 0);
          const criticalCount = filtered.filter(t => t.flag === "critical").length;
          const suspiciousCount = filtered.filter(t => t.flag === "suspicious").length;
          const uniqueCounterparties = new Set(filtered.map(t => t.counterparty).filter(Boolean)).size;
          const uniqueAccounts = new Set(filtered.map(t => t.account || t.account_name).filter(Boolean)).size;

          // Categories and counterparties for filters
          const suspCategories = [...new Set(suspiciousTxns.map(t => t.category).filter(Boolean))].sort();
          const suspCounterparties = [...new Set(suspiciousTxns.map(t => t.counterparty).filter(Boolean))].sort();

          // Summary by category
          const byCategory: Record<string, { count: number; total: number }> = {};
          active.forEach(t => { const cat = t.category || "Unknown"; if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0 }; byCategory[cat].count++; byCategory[cat].total += Math.abs(t.amount || 0); });

          // Summary by counterparty
          const byCounterparty: Record<string, { count: number; total: number }> = {};
          active.forEach(t => { const cp = t.counterparty || "Unknown"; if (!byCounterparty[cp]) byCounterparty[cp] = { count: 0, total: 0 }; byCounterparty[cp].count++; byCounterparty[cp].total += Math.abs(t.amount || 0); });

          // Export filtered suspicious
          const exportSuspicious = () => {
            const headers = ["Date", "Description", "Amount", "Direction", "Receiving Entity", "Account", "Bank", "Category", "Flag", "Notes"];
            const rows = filtered.map(t => [t.date, t.description, t.amount, t.direction, t.counterparty, t.account || t.account_name, t.bank, t.category, t.flag, t.notes].map(v => {
              const s = String(v ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
            }).join(","));
            const csv = [headers.join(","), ...rows].join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = "suspicious_transactions.csv"; a.click();
            URL.revokeObjectURL(url);
          };

          return (
          <div className="p-6 lg:p-8 max-w-[1600px]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-[var(--text)]">Suspicious Activity</h2>
                <p className="text-sm text-[var(--text-muted)] mt-1">{suspiciousTxns.length} flagged transactions from all data</p>
              </div>
              <button onClick={exportSuspicious} className="px-4 py-2 border border-[var(--border)] rounded-xl text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] transition-colors">
                Export Suspicious CSV
              </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
              {([
                ["Total Flagged", `${filtered.length}`, "", ""],
                ["Total Amount", fmt(totalAmount), "", "text-red-600"],
                ["Verified Fraud", `${verifiedCount}`, fmt(verifiedAmount), "text-red-600"],
                ["Critical", `${criticalCount}`, "", "text-orange-600"],
                ["Suspicious", `${suspiciousCount}`, "", "text-amber-600"],
                ["Counterparties", `${uniqueCounterparties}`, "", ""],
                ["Accounts", `${uniqueAccounts}`, "", ""],
              ] as [string, string, string, string][]).map(([label, value, sub, color], i) => (
                <div key={i} className="bg-white border border-[var(--border)] rounded-xl px-4 py-3 shadow-sm">
                  <div className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">{label}</div>
                  <div className={`text-lg font-bold mt-0.5 ${color}`}>{value}</div>
                  {sub && <div className="text-[10px] text-[var(--text-muted)]">{sub}</div>}
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-4 mb-4">
              <div className="flex flex-wrap gap-3 items-center">
                <input placeholder="Search descriptions, receiving entities, beneficiaries..."
                  className="bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2 w-72"
                  value={suspFilter.search} onChange={e => setSuspFilter(p => ({ ...p, search: e.target.value }))} />
                <select className="bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                  value={suspFilter.flag} onChange={e => setSuspFilter(p => ({ ...p, flag: e.target.value }))}>
                  <option value="all">All Flags</option>
                  <option value="verified_fraud">Verified Fraud</option>
                  <option value="critical">Critical</option>
                  <option value="suspicious">Suspicious</option>
                </select>
                <select className="bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                  value={suspFilter.category} onChange={e => setSuspFilter(p => ({ ...p, category: e.target.value }))}>
                  <option value="">All Categories</option>
                  {suspCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-3 py-2"
                  value={suspFilter.counterparty} onChange={e => setSuspFilter(p => ({ ...p, counterparty: e.target.value }))}>
                  <option value="">All Receiving Entities</option>
                  {suspCounterparties.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {(suspFilter.search || suspFilter.flag !== "all" || suspFilter.category || suspFilter.counterparty) && (
                  <button onClick={() => setSuspFilter({ flag: "all", category: "", search: "", counterparty: "" })}
                    className="text-xs text-indigo-600 hover:underline">Clear filters</button>
                )}
                <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} results</span>
              </div>
            </div>

            {/* Bulk actions */}
            {suspSelected.size > 0 && (
              <div className="flex items-center gap-3 mb-4 p-3 bg-white border border-indigo-300 rounded-xl shadow-sm">
                <span className="text-sm font-semibold">{suspSelected.size} selected</span>
                <select className="bg-[var(--bg-page)] border border-[var(--border)] text-sm rounded-lg px-2.5 py-1.5"
                  onChange={e => {
                    if (!e.target.value) return;
                    const flag = e.target.value;
                    fetch("/api/transactions/bulk-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...suspSelected], updates: { flag } }) })
                      .then(() => { loadTransactions(); loadStats(); setSuspSelected(new Set()); });
                    e.target.value = "";
                  }}>
                  <option value="">Change flag...</option>
                  {["normal", "review", "suspicious", "critical", "verified_fraud", "disqualified"].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            )}

            {/* Table */}
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden mb-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="bg-[var(--bg-muted)] px-3 py-2.5 w-8"><input type="checkbox"
                        checked={suspSelected.size === filtered.length && filtered.length > 0}
                        onChange={() => suspSelected.size === filtered.length ? setSuspSelected(new Set()) : setSuspSelected(new Set(filtered.map(t => t.id)))} /></th>
                      {([["date","Date"],["description","Description"],["amount","Amount"],["counterparty","Receiving Entity"],["account","Account"],["bank","Bank"],["direction","Dir"],["category","Category"],["flag","Flag"]] as [string,string][]).map(([key, label]) => (
                        <th key={key} className="bg-[var(--bg-muted)] text-[var(--text-muted)] text-xs uppercase px-3 py-2.5 text-left cursor-pointer hover:text-[var(--text)] select-none"
                          onClick={() => setSuspSort(prev => prev.field === key ? { field: key, desc: !prev.desc } : { field: key, desc: true })}>
                          {label} {suspSort.field === key ? (suspSort.desc ? "↓" : "↑") : ""}
                        </th>
                      ))}
                      <th className="bg-[var(--bg-muted)] text-[var(--text-muted)] text-xs uppercase px-3 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={11} className="text-center text-[var(--text-muted)] py-12">No suspicious transactions match your filters</td></tr>
                    ) : filtered.map(t => (
                      <React.Fragment key={t.id}>
                        <tr className={`border-t border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] ${suspSelected.has(t.id) ? "bg-indigo-50/50" : ""}`}>
                          <td className="px-3 py-2.5"><input type="checkbox" checked={suspSelected.has(t.id)}
                            onChange={() => { const n = new Set(suspSelected); n.has(t.id) ? n.delete(t.id) : n.add(t.id); setSuspSelected(n); }} /></td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{t.date || "-"}</td>
                          <td className="px-3 py-2.5 max-w-[200px]">
                            <div className="truncate" title={t.description}>{t.description || "-"}</div>
                          </td>
                          <td className={`px-3 py-2.5 tabular-nums font-semibold ${t.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(t.amount)}</td>
                          <td className="px-3 py-2.5">{t.counterparty || "-"}</td>
                          <td className="px-3 py-2.5">{t.account || t.account_name || "-"}</td>
                          <td className="px-3 py-2.5 text-[var(--text-muted)]">{t.bank || "-"}</td>
                          <td className="px-3 py-2.5">{t.direction || "-"}</td>
                          <td className="px-3 py-2.5">{t.category || "-"}</td>
                          <td className="px-3 py-2.5"><FlagBadge flag={t.flag} /></td>
                          <td className="px-3 py-2.5">
                            <div className="flex gap-1">
                              <button onClick={() => setSuspExpanded(suspExpanded === t.id ? null : t.id)}
                                className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--bg-muted)]">{suspExpanded === t.id ? "Hide" : "View"}</button>
                              <button onClick={() => openEdit(t)} className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--bg-muted)]">Edit</button>
                            </div>
                          </td>
                        </tr>
                        {suspExpanded === t.id && (
                          <tr className="bg-[var(--bg-page)]">
                            <td colSpan={11} className="px-6 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                                <div><span className="text-[var(--text-muted)] font-medium">Description:</span><p className="mt-1 text-[var(--text)]">{t.description || "-"}</p></div>
                                <div><span className="text-[var(--text-muted)] font-medium">Security:</span><p className="mt-1">{t.security || "-"} {t.symbol ? `(${t.symbol})` : ""}</p></div>
                                <div><span className="text-[var(--text-muted)] font-medium">Reference:</span><p className="mt-1">{t.reference || "-"}</p></div>
                                <div><span className="text-[var(--text-muted)] font-medium">Unit Price:</span><p className="mt-1">{t.unit_price ? fmt(t.unit_price) : "-"}</p></div>
                                <div><span className="text-[var(--text-muted)] font-medium">Quantity:</span><p className="mt-1">{t.quantity || "-"}</p></div>
                                <div><span className="text-[var(--text-muted)] font-medium">Settle Date:</span><p className="mt-1">{t.settle_date || "-"}</p></div>
                                <div className="col-span-2 md:col-span-3"><span className="text-[var(--text-muted)] font-medium">AI Notes:</span><p className="mt-1 text-[var(--text-secondary)]">{t.notes || "-"}</p></div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary Cards */}
            {filtered.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* By Category */}
                <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
                  <h3 className="text-sm font-semibold mb-3">By Category</h3>
                  <table className="w-full text-sm">
                    <thead><tr className="text-[var(--text-muted)] text-xs uppercase">
                      <th className="text-left py-1.5">Category</th><th className="text-right py-1.5">Count</th><th className="text-right py-1.5">Amount</th>
                    </tr></thead>
                    <tbody>
                      {Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total).map(([cat, d]) => (
                        <tr key={cat} className="border-t border-[var(--border-subtle)]">
                          <td className="py-1.5">{cat}</td>
                          <td className="py-1.5 text-right tabular-nums">{d.count}</td>
                          <td className="py-1.5 text-right tabular-nums text-red-600 font-medium">{fmt(d.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* By Receiving Entity */}
                <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
                  <h3 className="text-sm font-semibold mb-3">By Receiving Entity</h3>
                  <div className="max-h-[250px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-[var(--text-muted)] text-xs uppercase sticky top-0 bg-white">
                        <th className="text-left py-1.5">Receiving Entity</th><th className="text-right py-1.5">Count</th><th className="text-right py-1.5">Amount</th>
                      </tr></thead>
                      <tbody>
                        {Object.entries(byCounterparty).sort((a, b) => b[1].total - a[1].total).map(([cp, d]) => (
                          <tr key={cp} className="border-t border-[var(--border-subtle)]">
                            <td className="py-1.5">{cp}</td>
                            <td className="py-1.5 text-right tabular-nums">{d.count}</td>
                            <td className="py-1.5 text-right tabular-nums text-red-600 font-medium">{fmt(d.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

            )}

              {/* By Beneficiary — Victim Impact */}
              {(() => {
                const byBeneficiary: Record<string, { name: string; deposits: number; deposit_amount: number; withdrawals: number; withdrawal_amount: number }> = {};
                active.forEach(t => {
                  const ben = t.beneficiary || "";
                  if (!ben) return;
                  if (!byBeneficiary[ben]) byBeneficiary[ben] = { name: ben, deposits: 0, deposit_amount: 0, withdrawals: 0, withdrawal_amount: 0 };
                  if ((t.amount || 0) > 0) { byBeneficiary[ben].deposits++; byBeneficiary[ben].deposit_amount += Math.abs(t.amount); }
                  else if ((t.amount || 0) < 0) { byBeneficiary[ben].withdrawals++; byBeneficiary[ben].withdrawal_amount += Math.abs(t.amount); }
                });
                const beneficiaryList = Object.values(byBeneficiary).sort((a, b) => b.withdrawal_amount - a.withdrawal_amount);
                if (beneficiaryList.length === 0) return null;
                return (
                  <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mt-4">
                    <h3 className="text-sm font-semibold mb-1">Victim Impact by Beneficiary</h3>
                    <p className="text-xs text-[var(--text-muted)] mb-3">Shows how much was deposited for each beneficiary vs how much was diverted</p>
                    <div className="max-h-[350px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-[var(--text-muted)] text-xs uppercase sticky top-0 bg-white">
                          <th className="text-left py-2 pr-2">Beneficiary</th>
                          <th className="text-right py-2 px-2">Deposits In</th>
                          <th className="text-right py-2 px-2"># In</th>
                          <th className="text-right py-2 px-2">Diverted Out</th>
                          <th className="text-right py-2 px-2"># Out</th>
                          <th className="text-right py-2 pl-2">Net Impact</th>
                        </tr></thead>
                        <tbody>
                          {beneficiaryList.map(b => {
                            const net = b.deposit_amount - b.withdrawal_amount;
                            return (
                              <tr key={b.name} className="border-t border-[var(--border-subtle)]">
                                <td className="py-2 pr-2 font-medium">{b.name}</td>
                                <td className="py-2 px-2 text-right text-emerald-600 tabular-nums">{fmt(b.deposit_amount)}</td>
                                <td className="py-2 px-2 text-right text-[var(--text-muted)] tabular-nums">{b.deposits}</td>
                                <td className="py-2 px-2 text-right text-red-600 tabular-nums">{fmt(b.withdrawal_amount)}</td>
                                <td className="py-2 px-2 text-right text-[var(--text-muted)] tabular-nums">{b.withdrawals}</td>
                                <td className={`py-2 pl-2 text-right font-semibold tabular-nums ${net >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmt(net)}</td>
                              </tr>
                            );
                          })}
                          <tr className="border-t-2 border-[var(--border)] font-bold">
                            <td className="py-2">TOTAL</td>
                            <td className="py-2 px-2 text-right text-emerald-600 tabular-nums">{fmt(beneficiaryList.reduce((s, b) => s + b.deposit_amount, 0))}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{beneficiaryList.reduce((s, b) => s + b.deposits, 0)}</td>
                            <td className="py-2 px-2 text-right text-red-600 tabular-nums">{fmt(beneficiaryList.reduce((s, b) => s + b.withdrawal_amount, 0))}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{beneficiaryList.reduce((s, b) => s + b.withdrawals, 0)}</td>
                            <td className={`py-2 pl-2 text-right font-bold tabular-nums ${beneficiaryList.reduce((s, b) => s + b.deposit_amount - b.withdrawal_amount, 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {fmt(beneficiaryList.reduce((s, b) => s + b.deposit_amount - b.withdrawal_amount, 0))}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
          </div>
          );
        })()}

        {/* ═══ Analytics ═══ */}
        {tab === "analytics" && (
          <div className="p-6 lg:p-8 max-w-[1600px]">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-[var(--text)]">Analytics</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Investigate fund flows, detect patterns, and assess fraud impact</p>
            </div>

            {/* Analytics sub-tabs */}
            <div className="flex items-center gap-1 border-b border-[var(--border)] mb-6">
              {([
                ["overview", "Overview"],
                ["counterparties", "Receiving Entities"],
                ["flow", "Money Flow"],
                ["fraud", "Fraud Impact"],
                ["flow", "Money Flow"],
                ["tools", "AI Tools"],
              ] as [typeof analyticsTab, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setAnalyticsTab(key)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    analyticsTab === key
                      ? "border-[var(--text)] text-[var(--text)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {/* === Overview Tab === */}
            {analyticsTab === "overview" && (<>

            {/* Category Filter */}
            {allCategories.length > 0 && (
              <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[var(--text)]">Filter by Category</h3>
                  {excludedCategories.size > 0 && (
                    <button onClick={() => setExcludedCategories(new Set())}
                      className="text-xs text-indigo-600 hover:underline">Reset ({excludedCategories.size} excluded)</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allCategories.map(cat => {
                    const excluded = excludedCategories.has(cat);
                    return (
                      <button key={cat} onClick={() => {
                        const next = new Set(excludedCategories);
                        excluded ? next.delete(cat) : next.add(cat);
                        setExcludedCategories(next);
                      }}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                          excluded
                            ? "bg-[var(--bg-muted)] border-[var(--border)] text-[var(--text-muted)] line-through"
                            : "bg-white border-[var(--border)] text-[var(--text-secondary)] hover:border-indigo-300"
                        }`}>
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            </>)}

            {/* === Tools Tab === */}
            {/* === Money Flow Tab === */}
            {analyticsTab === "flow" && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold">Money Flow Map</h3>
                    <p className="text-xs text-[var(--text-muted)]">Visualize how money moved between accounts and to external destinations</p>
                  </div>
                  <button onClick={loadSankey} disabled={sankeyLoading}
                    className="px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded-xl text-sm font-medium hover:opacity-80 disabled:opacity-50">
                    {sankeyLoading ? <><span className="spinner mr-2"></span>Loading...</> : "Generate Flow Map"}
                  </button>
                </div>

                {sankeyData && sankeyData.flows && (
                  <div className="space-y-4">
                    {/* Flow summary cards */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-white border border-[var(--border)] rounded-xl p-4">
                        <div className="text-[10px] text-[var(--text-muted)] uppercase font-medium">Total Flows</div>
                        <div className="text-xl font-bold">{sankeyData.total_flows}</div>
                      </div>
                      <div className="bg-white border border-[var(--border)] rounded-xl p-4">
                        <div className="text-[10px] text-[var(--text-muted)] uppercase font-medium">Unique Entities</div>
                        <div className="text-xl font-bold">{sankeyData.nodes?.length || 0}</div>
                      </div>
                      <div className="bg-white border border-[var(--border)] rounded-xl p-4">
                        <div className="text-[10px] text-[var(--text-muted)] uppercase font-medium">Total Amount</div>
                        <div className="text-xl font-bold text-red-600">{fmt(sankeyData.flows.reduce((s: number, f: any) => s + f.amount, 0))}</div>
                      </div>
                    </div>

                    {/* Sankey-style flow visualization */}
                    <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
                      <h4 className="text-sm font-semibold mb-4">Top Money Flows</h4>
                      <div className="space-y-2 max-h-[500px] overflow-y-auto">
                        {sankeyData.flows.map((f: any, i: number) => {
                          const maxAmount = sankeyData.flows[0]?.amount || 1;
                          const widthPct = Math.max(5, (f.amount / maxAmount) * 100);
                          return (
                            <div key={i} className="flex items-center gap-3 text-xs">
                              <div className="w-[180px] text-right truncate font-medium" title={f.from}>{f.from}</div>
                              <div className="flex-1 relative h-7 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                                <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-red-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold px-2"
                                  style={{ width: `${widthPct}%`, minWidth: "80px" }}>
                                  {fmt(f.amount)} ({f.count})
                                </div>
                              </div>
                              <div className="w-[180px] truncate" title={f.to}>{f.to}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Flow detail table */}
                    <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
                      <table className="w-full text-xs">
                        <thead><tr className="bg-[var(--bg-muted)]">
                          <th className="px-3 py-2 text-left text-[var(--text-muted)]">From</th>
                          <th className="px-3 py-2 text-left text-[var(--text-muted)]">To</th>
                          <th className="px-3 py-2 text-right text-[var(--text-muted)]">Amount</th>
                          <th className="px-3 py-2 text-right text-[var(--text-muted)]"># Txns</th>
                        </tr></thead>
                        <tbody>
                          {sankeyData.flows.map((f: any, i: number) => (
                            <tr key={i} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-muted)]">
                              <td className="px-3 py-2 font-medium">{f.from}</td>
                              <td className="px-3 py-2">{f.to}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-red-600 font-semibold">{fmt(f.amount)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{f.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {!sankeyData && !sankeyLoading && (
                  <div className="text-center py-12 text-[var(--text-muted)]">
                    Click "Generate Flow Map" to visualize money flows between accounts and external destinations.
                  </div>
                )}
              </div>
            )}

            {analyticsTab === "tools" && (<>
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">AI Receiving Entity Identification</h3>
                  <p className="text-sm text-[var(--text-muted)] mt-1">Use AI to read transaction descriptions and identify who sent or received money.</p>
                </div>
                <button onClick={runPartyExtraction} disabled={partyLoading}
                  className="px-5 py-2 bg-indigo-500 hover:bg-indigo-400 transition-colors disabled:opacity-50 rounded-md text-sm font-medium whitespace-nowrap">
                  {partyLoading ? <><span className="spinner mr-2"></span>Running...</> : "Extract Parties"}
                </button>
              </div>
              {partyStatus && <StatusMsg status={partyStatus} />}
            </div>

            {/* Merge Receiving Entities */}
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold">Merge Receiving Entities</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">AI auto-merge or manually select duplicates.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => runAutoMerge(true)} disabled={autoMergeLoading}
                    className="px-4 py-1.5 bg-amber-50 border border-amber-200 text-amber-600 hover:bg-amber-100 disabled:opacity-50 rounded-md text-xs font-medium">
                    {autoMergeLoading ? <><span className="spinner mr-1"></span>Analyzing...</> : "AI Preview Merges"}
                  </button>
                  {autoMergePreview && autoMergePreview.length > 0 && (
                    <button onClick={() => runAutoMerge(false)} disabled={autoMergeLoading}
                      className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 transition-colors disabled:opacity-50 rounded-md text-xs font-medium text-white">
                      Apply All ({autoMergePreview.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Auto-merge preview */}
              {autoMergePreview && autoMergePreview.length > 0 && (
                <div className="mb-4 border border-amber-200 rounded-lg overflow-hidden">
                  <div className="bg-amber-50 px-3 py-2 text-xs text-amber-600 font-medium">
                    AI found {autoMergePreview.length} merge groups — review before applying
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {autoMergePreview.map((g: any, i: number) => (
                      <div key={i} className="px-3 py-2 border-t border-[var(--border)] text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{g.canonical}</span>
                          <span className="text-[var(--text-muted)]">←</span>
                          <span className="text-[var(--text-muted)]">{g.names.filter((n: string) => n !== g.canonical).join(", ")}</span>
                        </div>
                        <div className="text-[var(--text-muted)] text-[10px] mt-0.5">{g.reason}</div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-[var(--bg)] px-3 py-2 flex justify-end gap-2 border-t border-[var(--border)]">
                    <button onClick={() => setAutoMergePreview(null)} className="text-xs text-[var(--text-muted)] hover:text-white px-2 py-1 border border-[var(--border)] rounded">Dismiss</button>
                    <button onClick={() => runAutoMerge(false)} disabled={autoMergeLoading}
                      className="text-xs px-3 py-1 bg-indigo-500 hover:bg-indigo-400 transition-colors disabled:opacity-50 rounded font-medium">
                      Apply All Merges
                    </button>
                  </div>
                </div>
              )}

              {/* Manual merge */}
              <div className="flex gap-2 mb-3 items-center">
                <input placeholder="Search receiving entities..." className="bg-[var(--bg)] ring-1 ring-[var(--border)] text-sm rounded-lg px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-muted)] w-64"
                  value={mergeSearch} onChange={e => setMergeSearch(e.target.value)} />
                <span className="text-xs text-[var(--text-muted)]">{mergeSelected.size} selected</span>
                {mergeSelected.size > 0 && (
                  <button onClick={() => { setMergeSelected(new Set()); setMergeCanonical(""); }} className="text-xs text-indigo-600 hover:underline">Clear</button>
                )}
              </div>
              <div className="max-h-[250px] overflow-y-auto border border-[var(--border)] rounded-2xl mb-3">
                {counterparties.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] p-4 text-center">No counterparties found. Run AI Receiving Entity Identification first.</p>
                ) : counterparties
                    .filter(c => !mergeSearch || c.name.toLowerCase().includes(mergeSearch.toLowerCase()))
                    .map(c => (
                  <label key={c.name}
                    className={`flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-muted)] cursor-pointer border-b border-[var(--border-subtle)] last:border-0 text-sm ${mergeSelected.has(c.name) ? "bg-indigo-500/10" : ""}`}>
                    <input type="checkbox" checked={mergeSelected.has(c.name)} onChange={() => toggleMergeSelect(c.name)} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-[var(--text-muted)] text-xs">{c.count} txns</span>
                    <span className={`text-xs tabular-nums font-medium ${c.total_amount < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(c.total_amount)}</span>
                  </label>
                ))}
              </div>
              {mergeSelected.size >= 2 && (
                <div className="flex gap-2 items-center">
                  <label className="text-sm text-[var(--text-muted)] whitespace-nowrap">Merge into:</label>
                  <select className="bg-[var(--bg)] ring-1 ring-[var(--border)] text-sm rounded-lg px-3 py-2 text-[var(--text)] flex-1"
                    value={mergeCanonical} onChange={e => setMergeCanonical(e.target.value)}>
                    {[...mergeSelected].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <span className="text-[var(--text-muted)]">or</span>
                  <input placeholder="Custom name..." className="bg-[var(--bg)] ring-1 ring-[var(--border)] text-sm rounded-lg px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-muted)] flex-1"
                    value={[...mergeSelected].includes(mergeCanonical) ? "" : mergeCanonical}
                    onChange={e => setMergeCanonical(e.target.value)} />
                  <button onClick={mergeCounterparties} className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 transition-colors rounded text-sm font-medium whitespace-nowrap">
                    Merge ({mergeSelected.size})
                  </button>
                </div>
              )}
              {mergeStatus && <StatusMsg status={mergeStatus} />}
            </div>
            </>)}

            {!analyticsData ? (
              <div className="text-center text-[var(--text-muted)] py-12">Loading analytics...</div>
            ) : (
              <>
                {/* Pie Chart: Transactions by Flag */}
                {analyticsTab === "overview" && analyticsData.raw_transactions && (() => {
                  const flagCounts: Record<string, { count: number; amount: number }> = {};
                  const active = analyticsData.raw_transactions.filter((t: any) => t.flag !== "disqualified" && !excludedCategories.has(t.category || ""));
                  active.forEach((t: any) => {
                    const f = t.flag || "unflagged";
                    if (!flagCounts[f]) flagCounts[f] = { count: 0, amount: 0 };
                    flagCounts[f].count++;
                    flagCounts[f].amount += Math.abs(t.amount || 0);
                  });
                  const flagColors: Record<string, string> = { normal: "#22c55e", review: "#eab308", suspicious: "#f97316", critical: "#ef4444", verified_fraud: "#dc2626", unflagged: "#a3a3a3" };
                  const pieData = Object.entries(flagCounts).map(([flag, d]) => ({ name: flag, value: d.count, amount: d.amount, fill: flagColors[flag] || "#6366f1" }));
                  if (pieData.length === 0) return null;
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
                        <h3 className="text-sm font-semibold mb-3">Transactions by Flag (Count)</h3>
                        <ResponsiveContainer width="100%" height={250}>
                          <PieChart>
                            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                              {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)", borderRadius: 10, fontSize: 12, color: "var(--tooltip-text)" }} formatter={(v: any, n: any) => [`${v} txns`, n]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5">
                        <h3 className="text-sm font-semibold mb-3">Amount by Flag</h3>
                        <ResponsiveContainer width="100%" height={250}>
                          <PieChart>
                            <Pie data={pieData} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                              {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)", borderRadius: 10, fontSize: 12, color: "var(--tooltip-text)" }} formatter={(v: any, n: any) => [fmt(Number(v)), n]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })()}

                {/* Cluster Detection — shown in Overview */}
                {analyticsTab === "overview" && (
                <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-4 mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm">Withdrawal Cluster Detection</h3>
                    <button onClick={() => setShowClusters(!showClusters)}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${showClusters ? "bg-red-500/20 border-red-500/50 text-red-600" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
                      {showClusters ? "Visible" : "Hidden"}
                    </button>
                  </div>
                  <div className={`flex flex-wrap gap-4 items-center text-sm ${!showClusters ? "opacity-40 pointer-events-none" : ""}`}>
                    <div className="flex items-center gap-2">
                      <label className="text-[var(--text-muted)] text-xs">Min withdrawals:</label>
                      <input type="number" min={1} value={clusterMinWithdrawals} onChange={e => setClusterMinWithdrawals(Number(e.target.value) || 1)}
                        className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 w-16 text-sm" />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[var(--text-muted)] text-xs">Min amount ($):</label>
                      <input type="number" min={0} value={clusterMinAmount} onChange={e => setClusterMinAmount(Number(e.target.value) || 0)}
                        className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 w-24 text-sm" />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[var(--text-muted)] text-xs">Window (days):</label>
                      <input type="number" min={1} value={clusterWindowDays} onChange={e => setClusterWindowDays(Number(e.target.value) || 1)}
                        className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 w-16 text-sm" />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[var(--text-muted)] text-xs">Flag:</label>
                      {([["all", "All"], ["verified_fraud", "Verified Fraud"], ["suspicious+critical", "Suspicious+Critical"], ["suspicious", "Suspicious"], ["critical", "Critical"], ["review", "Review"], ["normal", "Normal"]] as [string, string][]).map(([val, label]) => (
                        <button key={val} onClick={() => setClusterFlagFilter(val)}
                          className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${clusterFlagFilter === val
                            ? "bg-indigo-500 border-indigo-500 text-white"
                            : "border-[var(--border)] text-[var(--text-muted)] hover:text-white"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-amber-600 font-medium">
                      {withdrawalClusters.length} cluster{withdrawalClusters.length !== 1 ? "s" : ""} detected
                    </span>
                  </div>
                </div>
                )}

                {/* Chart 1: Overall Balance Over Time */}
                {analyticsTab === "overview" && (<>
                {/* Chart 1: Overall Balance Over Time + Clusters + AI Annotations */}
                <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
                  <h3 className="font-semibold mb-1">Overall Balance Over Time</h3>
                  {filteredBalanceData.length === 0 ? (
                    <p className="text-[var(--text-muted)] text-sm py-8 text-center">No data available</p>
                  ) : (() => {
                    const raw = filteredBalanceData;
                    const start = brushRange?.start ?? 0;
                    const end = brushRange?.end ?? raw.length - 1;
                    const visibleCount = end - start + 1;

                    let granularity = "day";
                    if (visibleCount > 730) granularity = "year";
                    else if (visibleCount > 180) granularity = "month";
                    else if (visibleCount > 60) granularity = "week";

                    // Only change X-axis tick labels, data stays as daily
                    const formatTick = (dateLabel: string) => {
                      const point = raw.find((d: any) => d.date === dateLabel);
                      const rd = point?.raw_date || dateLabel;
                      const d = new Date(rd);
                      if (isNaN(d.getTime())) return dateLabel;
                      if (granularity === "year") return d.getFullYear().toString();
                      if (granularity === "month") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
                      if (granularity === "week") return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                      return dateLabel;
                    };

                    // Thin out ticks so they don't overlap
                    const tickInterval = granularity === "year" ? 365 : granularity === "month" ? 30 : granularity === "week" ? 7 : 0;

                    return (
                      <>
                        <p className="text-xs text-[var(--text-muted)] mb-4">
                          Viewing <span className="text-[var(--text)] font-medium">{granularity}</span> labels
                          &middot; {visibleCount} days visible &middot; Drag brush handles to zoom, hover for daily detail
                        </p>
                        <ResponsiveContainer width="100%" height={480}>
                          <LineChart data={raw}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis dataKey="date"
                              tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                              angle={-45} textAnchor="end" height={70}
                              tickFormatter={formatTick}
                              interval={tickInterval || "preserveStartEnd"}
                              minTickGap={40}
                            />
                            <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                            <Tooltip
                              contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.1)", color: "var(--tooltip-text)" }}
                              formatter={(value: any, name: any) => [fmt(Number(value)), String(name)]}
                            />
                            <Legend />
                            {/* AI highlight annotations */}
                            {aiAnnotations.filter(a => a.chart === "balance" && a.type === "highlight").map((a, i) => (
                              <ReferenceArea key={`ai-area-${i}`}
                                x1={raw[a.dateIndex]?.date}
                                x2={raw[a.dateIndexEnd ?? a.dateIndex]?.date}
                                fill={a.color || "#f97316"} fillOpacity={0.15}
                                label={{ value: a.label, fill: a.color || "#f97316", fontSize: 10, position: "insideTop" }}
                              />
                            ))}
                            {/* Cluster highlight zones */}
                            {showClusters && withdrawalClusters.map((c, i) => (
                              <ReferenceArea key={`cluster-${i}`}
                                x1={raw[c.startIdx]?.date}
                                x2={raw[c.endIdx]?.date}
                                fill="#ef4444" fillOpacity={0.1}
                                label={{ value: c.label, fill: "#ef4444", fontSize: 9, position: "insideTop" }}
                              />
                            ))}
                            <Line type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2} dot={false} name="Balance" />
                            <Line type="monotone" dataKey="inflow" stroke="#22c55e" strokeWidth={1} dot={false} name="Daily Inflow" />
                            <Line type="monotone" dataKey="outflow" stroke="#ef4444" strokeWidth={1} dot={false} name="Daily Outflow" />
                            <Brush dataKey="date" height={30} stroke="#6366f1" fill="var(--brush-bg)" travellerWidth={10}
                              onChange={(range: any) => {
                                if (range && typeof range.startIndex === "number") {
                                  setBrushRange({ start: range.startIndex, end: range.endIndex });
                                }
                              }}
                            />
                            {/* Cluster dots on balance line */}
                            {showClusters && withdrawalClusters.map((c, i) => {
                              const midIdx = Math.floor((c.startIdx + c.endIdx) / 2);
                              const point = raw[midIdx];
                              if (!point) return null;
                              return <ReferenceDot key={`cdot-${i}`} x={point.date} y={point.balance} r={8} fill="#ef4444" stroke="#fff" strokeWidth={2} />;
                            })}
                            {/* AI dot/circle annotations */}
                            {aiAnnotations.filter(a => a.chart === "balance" && (a.type === "dot" || a.type === "circle" || a.type === "arrow")).map((a, i) => {
                              const point = raw[a.dateIndex];
                              if (!point) return null;
                              return <ReferenceDot key={`ai-dot-${i}`} x={point.date} y={point.balance}
                                r={a.type === "circle" ? 12 : 6}
                                fill={a.type === "circle" ? "transparent" : (a.color || "#f59e0b")}
                                stroke={a.color || "#f59e0b"} strokeWidth={2}
                                label={{ value: a.label, fill: a.color || "#f59e0b", fontSize: 9, position: "top" }}
                              />;
                            })}
                          </LineChart>
                        </ResponsiveContainer>
                      </>
                    );
                  })()}
                </div>

                {/* Chart 2: Balance Over Time by Account */}
                <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
                  <h3 className="font-semibold mb-1">Balance by Account</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-3">Track individual accounts — identify which account was drained.</p>
                  {Object.keys(analyticsData.balance_by_account).length === 0 ? (
                    <p className="text-[var(--text-muted)] text-sm py-8 text-center">No data available</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {Object.keys(analyticsData.balance_by_account).map((acct: string, i: number) => {
                          const colors = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#64748b"];
                          const color = colors[i % colors.length];
                          const active = selectedAccounts.has(acct);
                          return (
                            <button key={acct}
                              onClick={() => { const next = new Set(selectedAccounts); active ? next.delete(acct) : next.add(acct); setSelectedAccounts(next); }}
                              className={`px-3 py-1 text-xs rounded-full border transition-colors ${active ? "border-transparent text-white" : "border-[var(--border)] text-[var(--text-muted)] opacity-40"}`}
                              style={active ? { background: color } : {}}>
                              {acct}
                            </button>
                          );
                        })}
                      </div>
                      {(() => {
                        // Merge all account data into unified dataset
                        const allDates = new Set<string>();
                        const accountData = analyticsData.balance_by_account as Record<string, Array<{date: string; balance: number}>>;
                        for (const [acct, points] of Object.entries(accountData)) {
                          if (!selectedAccounts.has(acct)) continue;
                          for (const p of points) allDates.add(p.date);
                        }
                        const sortedDates = [...allDates].sort((a, b) => {
                          const da = new Date(a).getTime(), db = new Date(b).getTime();
                          if (!isNaN(da) && !isNaN(db)) return da - db;
                          return a.localeCompare(b);
                        });

                        // Build merged rows, forward-filling last known balance
                        const merged = sortedDates.map(date => {
                          const row: any = { date };
                          for (const [acct, points] of Object.entries(accountData)) {
                            if (!selectedAccounts.has(acct)) continue;
                            const match = points.find(p => p.date === date);
                            if (match) {
                              row[acct] = match.balance;
                            }
                          }
                          return row;
                        });
                        // Forward-fill missing values
                        const lastKnown: Record<string, number> = {};
                        for (const row of merged) {
                          for (const acct of Object.keys(accountData)) {
                            if (!selectedAccounts.has(acct)) continue;
                            if (row[acct] !== undefined) {
                              lastKnown[acct] = row[acct];
                            } else if (lastKnown[acct] !== undefined) {
                              row[acct] = lastKnown[acct];
                            }
                          }
                        }

                        const colors = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#64748b"];
                        const acctKeys = Object.keys(accountData);

                        return (
                          <ResponsiveContainer width="100%" height={350}>
                            <LineChart data={merged}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                              <XAxis dataKey="date" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} angle={-45} textAnchor="end" height={70} />
                              <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                              <Tooltip contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)", borderRadius: 10, fontSize: 12, color: "var(--tooltip-text)" }} formatter={(value: any, name: any) => [fmt(Number(value)), String(name)]} />
                              <Legend />
                              {acctKeys.map((acct, i) => {
                                if (!selectedAccounts.has(acct)) return null;
                                return <Line key={acct} type="monotone" dataKey={acct} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} connectNulls />;
                              })}
                            </LineChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </>
                  )}
                </div>

                </>)}

                {/* === Counterparties Tab === */}
                {analyticsTab === "counterparties" && (<>
                {/* Chart 3: Receiving Entity Breakdown */}
                <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
                  <h3 className="font-semibold mb-1">Deposits vs Withdrawals by Receiving Entity</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-4">Number of incoming vs outgoing transactions per party.</p>
                  {filteredTransactionCounts.length === 0 ? (
                    <p className="text-[var(--text-muted)] text-sm py-8 text-center">No data available</p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={Math.max(300, filteredTransactionCounts.length * 32)}>
                        <BarChart data={filteredTransactionCounts} layout="vertical" margin={{ left: 150 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                          <XAxis type="number" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} />
                          <YAxis dataKey="party" type="category" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} width={140} />
                          <Tooltip contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)", borderRadius: 10, fontSize: 12, color: "var(--tooltip-text)" }} />
                          <Legend />
                          <Bar dataKey="deposits" fill="#22c55e" name="Deposits (In)" />
                          <Bar dataKey="withdrawals" fill="#ef4444" name="Withdrawals (Out)" />
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="mt-4 overflow-x-auto">
                        {(() => {
                          const cols: [string, string][] = [["party", "Party"], ["deposits", "Deposits"], ["deposit_amount", "Deposit Amount"], ["withdrawals", "Withdrawals"], ["withdrawal_amount", "Withdrawal Amount"], ["net", "Net"]];
                          const sorted = [...analyticsData.transaction_counts]
                            .map((p: any) => ({ ...p, net: p.deposit_amount - p.withdrawal_amount }))
                            .sort((a: any, b: any) => {
                              const va = a[partySort.field] ?? "";
                              const vb = b[partySort.field] ?? "";
                              if (typeof va === "number" && typeof vb === "number") return partySort.desc ? vb - va : va - vb;
                              return partySort.desc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
                            });
                          return (
                            <table className="w-full text-sm border border-[var(--border)] rounded-2xl">
                              <thead><tr>
                                {cols.map(([key, label]) => (
                                  <th key={key}
                                    className="bg-[var(--bg-muted)] text-[var(--text-muted)] text-xs uppercase px-3 py-2 text-left cursor-pointer hover:text-white select-none"
                                    onClick={() => setPartySort(prev => prev.field === key ? { field: key, desc: !prev.desc } : { field: key, desc: true })}>
                                    {label} {partySort.field === key ? (partySort.desc ? "↓" : "↑") : ""}
                                  </th>
                                ))}
                              </tr></thead>
                              <tbody>
                                {sorted.map((p: any) => (
                                  <tr key={p.party} className="hover:bg-[var(--bg-muted)] border-b border-[var(--border-subtle)]">
                                    <td className="px-3 py-2 font-medium">
                                      <button onClick={() => setDrillCounterparty(p.party)} className="text-indigo-600 hover:underline text-left">{p.party}</button>
                                    </td>
                                    <td className="px-3 py-2 text-emerald-600">{p.deposits}</td>
                                    <td className="px-3 py-2 text-emerald-600 tabular-nums">{fmt(p.deposit_amount)}</td>
                                    <td className="px-3 py-2 text-red-600">{p.withdrawals}</td>
                                    <td className="px-3 py-2 text-red-600 tabular-nums">{fmt(p.withdrawal_amount)}</td>
                                    <td className={`px-3 py-2 font-semibold tabular-nums ${p.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmt(p.net)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          );
                        })()}
                      </div>
                    </>
                  )}
                </div>

                </>)}

                {/* === Money Flow Tab === */}
                {analyticsTab === "flow" && (<>
                  <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold">Cross-Bank Money Flow Tracing</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">Trace where money went between banks and accounts</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={loadFlowData} disabled={flowLoading}
                          className="px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded-xl text-sm font-semibold hover:opacity-80 disabled:opacity-50">
                          {flowLoading ? <><span className="spinner mr-2"></span>Analyzing...</> : "Run Auto-Match"}
                        </button>
                        <button onClick={runAiFlowMatch} disabled={aiFlowLoading}
                          className="px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-100 disabled:opacity-50">
                          {aiFlowLoading ? <><span className="spinner mr-1"></span>AI...</> : "AI Deep Match"}
                        </button>
                      </div>
                    </div>

                    {/* Stats */}
                    {flowData?.stats && (
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-5">
                        {([
                          ["Matched", flowData.stats.total_matched, "text-emerald-600"],
                          ["Matched Amount", fmt(flowData.stats.total_matched_amount), "text-emerald-600"],
                          ["High Confidence", flowData.stats.high_confidence, "text-emerald-600"],
                          ["Medium", flowData.stats.medium_confidence, "text-amber-600"],
                          ["Low", flowData.stats.low_confidence, "text-orange-600"],
                          ["Unmatched", flowData.stats.total_unmatched, "text-red-600"],
                        ] as [string, any, string][]).map(([label, value, color], i) => (
                          <div key={i} className="bg-[var(--bg-page)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-center">
                            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{label}</div>
                            <div className={`text-lg font-bold mt-0.5 ${color}`}>{String(value)}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Flow Diagram (simplified as bar chart) */}
                    {flowData?.flows && flowData.flows.length > 0 && (
                      <div className="mb-5">
                        <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase mb-2">Money Flows Between Banks</h4>
                        <div className="space-y-2">
                          {flowData.flows.slice(0, 20).map((f: any, i: number) => {
                            const maxAmount = Math.max(...flowData.flows.map((fl: any) => fl.amount));
                            const pct = (f.amount / maxAmount) * 100;
                            return (
                              <div key={i} className="flex items-center gap-3">
                                <span className="text-xs font-medium w-32 text-right truncate">{f.from}</span>
                                <div className="flex-1 h-6 bg-[var(--bg-muted)] rounded-full overflow-hidden relative">
                                  <div className="h-full bg-indigo-500 rounded-full transition-all flex items-center justify-end pr-2"
                                    style={{ width: `${Math.max(pct, 5)}%` }}>
                                    <span className="text-[10px] text-white font-semibold">{fmt(f.amount)}</span>
                                  </div>
                                </div>
                                <span className="text-xs font-medium w-32 truncate">{f.to}</span>
                                <span className="text-[10px] text-[var(--text-muted)]">{f.count} txns</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Matched Transactions Table */}
                  {flowData?.matches && flowData.matches.length > 0 && (
                    <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
                      <h3 className="text-sm font-semibold mb-3">Matched Transaction Pairs</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="text-[var(--text-muted)] uppercase border-b border-[var(--border)]">
                            <th className="px-2 py-2 text-left">Confidence</th>
                            <th className="px-2 py-2 text-left">Source Date</th>
                            <th className="px-2 py-2 text-left">From Bank</th>
                            <th className="px-2 py-2 text-left">From Account</th>
                            <th className="px-2 py-2 text-right">Amount Out</th>
                            <th className="px-2 py-2 text-center">→</th>
                            <th className="px-2 py-2 text-left">Dest Date</th>
                            <th className="px-2 py-2 text-left">To Bank</th>
                            <th className="px-2 py-2 text-left">To Account</th>
                            <th className="px-2 py-2 text-right">Amount In</th>
                            <th className="px-2 py-2 text-right">Day Gap</th>
                          </tr></thead>
                          <tbody>
                            {flowData.matches.map((m: any, i: number) => (
                              <React.Fragment key={i}>
                                <tr className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] cursor-pointer"
                                  onClick={() => setFlowChainTxn(flowChainTxn === m.source.id ? null : m.source.id)}>
                                  <td className="px-2 py-2">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                      m.match_type === "high" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                                      m.match_type === "medium" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                                      "bg-orange-50 text-orange-700 border border-orange-200"
                                    }`}>{(m.confidence * 100).toFixed(0)}%</span>
                                  </td>
                                  <td className="px-2 py-2 whitespace-nowrap">{m.source.date}</td>
                                  <td className="px-2 py-2 font-medium">{m.source.bank}</td>
                                  <td className="px-2 py-2">{m.source.account}</td>
                                  <td className="px-2 py-2 text-right text-red-600 font-medium tabular-nums">{fmt(m.source.amount)}</td>
                                  <td className="px-2 py-2 text-center text-[var(--text-muted)]">→</td>
                                  <td className="px-2 py-2 whitespace-nowrap">{m.dest.date}</td>
                                  <td className="px-2 py-2 font-medium">{m.dest.bank}</td>
                                  <td className="px-2 py-2">{m.dest.account}</td>
                                  <td className="px-2 py-2 text-right text-emerald-600 font-medium tabular-nums">{fmt(m.dest.amount)}</td>
                                  <td className="px-2 py-2 text-right tabular-nums">{m.day_diff}d</td>
                                </tr>
                                {flowChainTxn === m.source.id && (
                                  <tr className="bg-[var(--bg-page)]">
                                    <td colSpan={11} className="px-4 py-3">
                                      <div className="grid grid-cols-2 gap-4 text-xs">
                                        <div>
                                          <span className="font-semibold text-[var(--text-muted)]">Source:</span>
                                          <p className="mt-1">{m.source.description || "-"}</p>
                                          <p className="text-[var(--text-muted)]">Receiving Entity: {m.source.counterparty || "-"}</p>
                                          <p className="text-[var(--text-muted)]">Flag: {m.source.flag || "-"}</p>
                                        </div>
                                        <div>
                                          <span className="font-semibold text-[var(--text-muted)]">Destination:</span>
                                          <p className="mt-1">{m.dest.description || "-"}</p>
                                          <p className="text-[var(--text-muted)]">Receiving Entity: {m.dest.counterparty || "-"}</p>
                                          <p className="text-[var(--text-muted)]">Flag: {m.dest.flag || "-"}</p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* AI Flow Results */}
                  {aiFlowResult && (
                    <div className="bg-white border border-amber-200 rounded-2xl shadow-sm p-5 mb-6">
                      <h3 className="text-sm font-semibold mb-3 text-amber-700">AI Deep Match Results</h3>
                      {aiFlowResult.chains && aiFlowResult.chains.length > 0 && (
                        <div className="mb-4">
                          <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase mb-2">Money Chains Detected</h4>
                          {aiFlowResult.chains.map((c: any, i: number) => (
                            <div key={i} className="p-3 bg-[var(--bg-page)] rounded-xl mb-2 text-xs">
                              <div className="font-medium">{c.description}</div>
                              <div className="text-[var(--text-muted)] mt-1">Path: {c.path?.join(" → ")} | Amount: {fmt(c.total_amount)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {aiFlowResult.matches && aiFlowResult.matches.length > 0 && (
                        <div className="mb-4">
                          <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase mb-2">AI Matched Pairs ({aiFlowResult.matches.length})</h4>
                          <div className="space-y-1 max-h-[300px] overflow-y-auto">
                            {aiFlowResult.matches.map((m: any, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-xs p-2 bg-[var(--bg-muted)] rounded-lg">
                                <span className="font-mono">#{m.source_id}</span>
                                <span className="text-[var(--text-muted)]">→</span>
                                <span className="font-mono">#{m.dest_id}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${m.confidence > 0.7 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{(m.confidence * 100).toFixed(0)}%</span>
                                <span className="text-[var(--text-muted)] flex-1 truncate">{m.reasoning}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {aiFlowResult.splits && aiFlowResult.splits.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase mb-2">Split Transactions</h4>
                          {aiFlowResult.splits.map((s: any, i: number) => (
                            <div key={i} className="p-2 bg-red-50 rounded-lg text-xs mb-1">
                              <span className="font-mono">#{s.source_id}</span> split into {s.dest_ids?.map((d: any) => `#${d}`).join(", ")} — {s.reasoning}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Unmatched Transactions */}
                  {flowData?.unmatched && flowData.unmatched.length > 0 && (
                    <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-5 mb-6">
                      <h3 className="text-sm font-semibold mb-1">Unmatched Outflows</h3>
                      <p className="text-xs text-[var(--text-muted)] mb-3">These withdrawals couldn't be auto-matched to deposits in another bank. Try "AI Deep Match" for better results.</p>
                      <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="text-[var(--text-muted)] uppercase border-b border-[var(--border)] sticky top-0 bg-white">
                            <th className="px-2 py-2 text-left">Date</th>
                            <th className="px-2 py-2 text-left">Bank</th>
                            <th className="px-2 py-2 text-left">Account</th>
                            <th className="px-2 py-2 text-right">Amount</th>
                            <th className="px-2 py-2 text-left">Description</th>
                            <th className="px-2 py-2 text-left">Receiving Entity</th>
                            <th className="px-2 py-2 text-left">Flag</th>
                          </tr></thead>
                          <tbody>
                            {flowData.unmatched.map((t: any) => (
                              <tr key={t.id} className="border-t border-[var(--border-subtle)]">
                                <td className="px-2 py-1.5 whitespace-nowrap">{t.date}</td>
                                <td className="px-2 py-1.5">{t.bank}</td>
                                <td className="px-2 py-1.5">{t.account}</td>
                                <td className="px-2 py-1.5 text-right text-red-600 tabular-nums font-medium">{fmt(t.amount)}</td>
                                <td className="px-2 py-1.5 max-w-[200px] truncate">{t.description || "-"}</td>
                                <td className="px-2 py-1.5">{t.counterparty || "-"}</td>
                                <td className="px-2 py-1.5"><FlagBadge flag={t.flag} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {!flowData && !flowLoading && (
                    <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-12 text-center">
                      <p className="text-[var(--text-muted)]">Click "Run Auto-Match" to trace money flows between banks</p>
                    </div>
                  )}
                </>)}

                {/* === Fraud Tab === */}
                {analyticsTab === "fraud" && (<>
                {/* Chart 4: Fraud Impact Analysis */}
                <div className="bg-[var(--bg-card)] border border-red-200 rounded-lg p-5 mb-6">
                  <h3 className="font-semibold mb-1 text-red-600">Fraud Impact — Present Value Analysis</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-3">
                    If the verified fraudulent money had stayed invested, what would it be worth today?
                    Only transactions flagged as <span className="text-red-600 font-semibold">VERIFIED FRAUD</span> are included.
                  </p>
                  {(() => {
                    const fraudTxns = analyticsData.fraud_transactions || [];
                    if (fraudTxns.length === 0) {
                      return <p className="text-[var(--text-muted)] text-sm py-8 text-center">No verified fraud transactions found. Mark transactions as "Verified Fraud" in the flag field to see impact analysis.</p>;
                    }

                    // Get unique strategies
                    const strategies: string[] = [...new Set(fraudTxns.map((t: any) => t.strategy || "Default") as string[])].sort();

                    const saveYields = (yields: Record<string, number>) => {
                      setStrategyYields(yields);
                      if (typeof window !== "undefined") localStorage.setItem("adecarte_strategy_yields", JSON.stringify(yields));
                    };

                    const getRate = (strategy: string) => {
                      const key = strategy || "Default";
                      return (strategyYields[key] ?? fraudReturnRate) / 100;
                    };

                    return (<>
                    {/* Yield config */}
                    <div className="mb-4">
                      <div className="flex items-center gap-3 mb-3">
                        <label className="text-xs text-[var(--text-muted)]">Default annual return (%):</label>
                        <input type="number" min={0} max={100} step={0.5} value={fraudReturnRate}
                          onChange={e => setFraudReturnRate(Number(e.target.value) || 0)}
                          className="bg-[var(--bg-page)] border border-[var(--border)] rounded-lg px-2 py-1 w-20 text-sm" />
                      </div>
                      {strategies.length > 1 && (
                        <div className="border border-[var(--border)] rounded-xl p-3">
                          <p className="text-xs text-[var(--text-muted)] mb-2">Per-strategy yield (overrides default):</p>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {strategies.map(s => (
                              <div key={s} className="flex items-center gap-2">
                                <span className="text-xs text-[var(--text-secondary)] truncate flex-1">{s}</span>
                                <input type="number" min={0} max={100} step={0.5}
                                  value={strategyYields[s] ?? fraudReturnRate}
                                  onChange={e => saveYields({ ...strategyYields, [s]: Number(e.target.value) || 0 })}
                                  className="bg-[var(--bg-page)] border border-[var(--border)] rounded px-2 py-1 w-16 text-xs" />
                                <span className="text-[10px] text-[var(--text-muted)]">%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {(() => {

                    const today = new Date();

                    // Calculate present value for each fraud txn using per-strategy rate
                    const fraudWithPV = fraudTxns.map((t: any) => {
                      const txnDate = new Date(t.date);
                      const days = Math.max(0, (today.getTime() - txnDate.getTime()) / (1000 * 60 * 60 * 24));
                      const rate = getRate(t.strategy || "Default");
                      const presentValue = t.amount * Math.pow(1 + rate, days / 365);
                      const growth = presentValue - t.amount;
                      return { ...t, days: Math.round(days), presentValue, growth, usedRate: rate * 100 };
                    });

                    const totalStolen = fraudWithPV.reduce((s: number, t: any) => s + t.amount, 0);
                    const totalPV = fraudWithPV.reduce((s: number, t: any) => s + t.presentValue, 0);
                    const totalGrowth = totalPV - totalStolen;

                    // Build counterfactual balance chart
                    const balData = filteredBalanceData;
                    let cumFraudPV = 0;
                    let fraudIdx = 0;
                    const counterfactualData = balData.map((d: any, i: number) => {
                      // Add any fraud txns on or before this date
                      while (fraudIdx < fraudWithPV.length) {
                        const fDate = new Date(fraudWithPV[fraudIdx].date);
                        const dDate = new Date(d.raw_date);
                        if (fDate <= dDate) {
                          // Compound this fraud amount from its date to current chart date
                          const daysSinceFraud = Math.max(0, (dDate.getTime() - fDate.getTime()) / (1000 * 60 * 60 * 24));
                          cumFraudPV += fraudWithPV[fraudIdx].amount * Math.pow(1 + getRate(fraudWithPV[fraudIdx].strategy || "Default"), daysSinceFraud / 365);
                          fraudIdx++;
                        } else break;
                      }
                      // Recompute cumFraudPV: all fraud txns up to this date, compounded to this date
                      let recomputed = 0;
                      for (let fi = 0; fi < fraudWithPV.length; fi++) {
                        const fDate = new Date(fraudWithPV[fi].date);
                        const dDate = new Date(d.raw_date);
                        if (fDate <= dDate) {
                          const daysSince = Math.max(0, (dDate.getTime() - fDate.getTime()) / (1000 * 60 * 60 * 24));
                          const fiRate = getRate(fraudWithPV[fi].strategy || "Default");
                          recomputed += fraudWithPV[fi].amount * Math.pow(1 + fiRate, daysSince / 365);
                        }
                      }
                      return {
                        date: d.date,
                        actual: d.balance,
                        counterfactual: d.balance + recomputed,
                        fraud_impact: recomputed,
                      };
                    });

                    return (
                      <>
                        {/* Summary cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl p-3 text-center">
                            <div className="text-[10px] text-[var(--text-muted)] uppercase">Total Stolen</div>
                            <div className="text-lg font-bold text-red-600">{fmt(totalStolen)}</div>
                            <div className="text-[10px] text-[var(--text-muted)]">{fraudWithPV.length} transactions</div>
                          </div>
                          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl p-3 text-center">
                            <div className="text-[10px] text-[var(--text-muted)] uppercase">Present Value</div>
                            <div className="text-lg font-bold text-red-600">{fmt(totalPV)}</div>
                            <div className="text-[10px] text-[var(--text-muted)]">at {fraudReturnRate}% annual</div>
                          </div>
                          <div className="bg-[var(--bg)] border border-red-200 rounded-lg p-3 text-center">
                            <div className="text-[10px] text-[var(--text-muted)] uppercase">Lost Growth</div>
                            <div className="text-lg font-bold text-red-600">{fmt(totalGrowth)}</div>
                            <div className="text-[10px] text-[var(--text-muted)]">opportunity cost</div>
                          </div>
                          <div className="bg-[var(--bg)] border border-red-200 rounded-lg p-3 text-center">
                            <div className="text-[10px] text-[var(--text-muted)] uppercase">Total Impact</div>
                            <div className="text-lg font-bold text-red-500">{fmt(totalPV)}</div>
                            <div className="text-[10px] text-[var(--text-muted)]">{((totalGrowth / totalStolen) * 100).toFixed(1)}% above stolen amount</div>
                          </div>
                        </div>

                        {/* Counterfactual chart */}
                        <ResponsiveContainer width="100%" height={350}>
                          <LineChart data={counterfactualData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis dataKey="date" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} angle={-45} textAnchor="end" height={70} />
                            <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                            <Tooltip contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)", borderRadius: 10, fontSize: 12, color: "var(--tooltip-text)" }}
                              formatter={(value: any, name: any) => [fmt(Number(value)), String(name)]} />
                            <Legend />
                            <Line type="monotone" dataKey="actual" stroke="#6366f1" strokeWidth={2} dot={false} name="Actual Balance" />
                            <Line type="monotone" dataKey="counterfactual" stroke="#22c55e" strokeWidth={2} strokeDasharray="6 3" dot={false} name="If No Fraud (Counterfactual)" />
                            <Line type="monotone" dataKey="fraud_impact" stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" dot={false} name="Cumulative Fraud Impact" />
                          </LineChart>
                        </ResponsiveContainer>

                        {/* Detail table */}
                        <div className="mt-4 overflow-x-auto">
                          <table className="w-full text-xs border border-[var(--border)] rounded-2xl">
                            <thead><tr>
                              {["Date", "Description", "Receiving Entity", "Beneficiary", "Account", "Strategy", "Rate", "Amount Stolen", "Days Ago", "Present Value", "Lost Growth"].map(h => (
                                <th key={h} className="bg-[var(--bg-muted)] text-[var(--text-muted)] text-[10px] uppercase px-2 py-1.5 text-left">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {fraudWithPV.map((t: any) => (
                                <tr key={t.id} className="border-t border-[var(--border)]">
                                  <td className="px-2 py-1.5 whitespace-nowrap">{t.date}</td>
                                  <td className="px-2 py-1.5 max-w-[150px] truncate">{t.description || "-"}</td>
                                  <td className="px-2 py-1.5">{t.counterparty || "-"}</td>
                                  <td className="px-2 py-1.5">{t.beneficiary || "-"}</td>
                                  <td className="px-2 py-1.5">{t.account || "-"}</td>
                                  <td className="px-2 py-1.5">{t.strategy || "-"}</td>
                                  <td className="px-2 py-1.5 tabular-nums">{t.usedRate?.toFixed(1)}%</td>
                                  <td className="px-2 py-1.5 text-red-600 font-medium tabular-nums">{fmt(t.amount)}</td>
                                  <td className="px-2 py-1.5 tabular-nums">{t.days}d</td>
                                  <td className="px-2 py-1.5 text-red-600 font-semibold tabular-nums">{fmt(t.presentValue)}</td>
                                  <td className="px-2 py-1.5 text-red-500 tabular-nums">{fmt(t.growth)} ({((t.growth / t.amount) * 100).toFixed(1)}%)</td>
                                </tr>
                              ))}
                              <tr className="border-t-2 border-red-200 font-bold">
                                <td className="px-2 py-2" colSpan={7}>TOTAL FRAUD IMPACT</td>
                                <td className="px-2 py-2 text-red-600 tabular-nums">{fmt(totalStolen)}</td>
                                <td className="px-2 py-2"></td>
                                <td className="px-2 py-2 text-red-600 tabular-nums">{fmt(totalPV)}</td>
                                <td className="px-2 py-2 text-red-500 tabular-nums">{fmt(totalGrowth)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()}
                  </>)
                  })()}
                </div>
                </>)}

              </>
            )}
          </div>
        )}

        {/* ═══ Settings ═══ */}
        {tab === "settings" && (() => {
          if (refSignatures.length === 0) loadRefSignatures();
          return (
          <div className="p-6 lg:p-8 max-w-[900px]">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-[var(--text)]">Settings</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Account registry, signatures, and configuration</p>
            </div>

            {/* Our Accounts Registry */}
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-6 mb-6">
              <h3 className="text-sm font-semibold mb-1">Our Accounts</h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">Define all accounts you own. The AI uses this to determine if transfers are internal (between your accounts) or external. Mark special accounts like LOC-linked ones.</p>

              {ourAccounts.length > 0 && (
                <div className="border border-[var(--border)] rounded-xl overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-[var(--bg-muted)]">
                      <th className="px-3 py-2 text-left text-xs text-[var(--text-muted)] font-medium">Account #</th>
                      <th className="px-3 py-2 text-left text-xs text-[var(--text-muted)] font-medium">Bank</th>
                      <th className="px-3 py-2 text-left text-xs text-[var(--text-muted)] font-medium">Role</th>
                      <th className="px-3 py-2 text-left text-xs text-[var(--text-muted)] font-medium">Notes</th>
                      <th className="px-3 py-2 w-16"></th>
                    </tr></thead>
                    <tbody>
                      {ourAccounts.map((a, i) => (
                        <tr key={i} className="border-t border-[var(--border-subtle)]">
                          <td className="px-3 py-2 font-mono font-medium">{a.account}</td>
                          <td className="px-3 py-2">{a.bank}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              a.role === "LOC" ? "bg-purple-50 text-purple-600 border border-purple-200" :
                              a.role === "Investment" ? "bg-blue-50 text-blue-600 border border-blue-200" :
                              a.role === "Operating" ? "bg-emerald-50 text-emerald-600 border border-emerald-200" :
                              "bg-[var(--bg-muted)] text-[var(--text-muted)] border border-[var(--border)]"
                            }`}>{a.role}</span>
                          </td>
                          <td className="px-3 py-2 text-[var(--text-muted)] text-xs">{a.notes || "-"}</td>
                          <td className="px-3 py-2">
                            <button onClick={() => saveOurAccounts(ourAccounts.filter((_, j) => j !== i))}
                              className="text-xs text-red-600 hover:underline">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Account # / ID</label>
                  <input id="new-acct-num" className="bg-[var(--bg-page)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm w-40" placeholder="e.g. M61750002" />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Bank</label>
                  <input id="new-acct-bank" className="bg-[var(--bg-page)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm w-40" placeholder="e.g. JP Morgan" />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Role</label>
                  <select id="new-acct-role" className="bg-[var(--bg-page)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm">
                    <option value="Investment">Investment</option>
                    <option value="Operating">Operating</option>
                    <option value="LOC">Line of Credit</option>
                    <option value="Custody">Custody</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Notes</label>
                  <input id="new-acct-notes" className="bg-[var(--bg-page)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm w-48" placeholder="e.g. Linked to LOC, main trading..." />
                </div>
                <button onClick={() => {
                  const num = (document.getElementById("new-acct-num") as HTMLInputElement)?.value.trim();
                  const bank = (document.getElementById("new-acct-bank") as HTMLInputElement)?.value.trim();
                  const role = (document.getElementById("new-acct-role") as HTMLSelectElement)?.value;
                  const notes = (document.getElementById("new-acct-notes") as HTMLInputElement)?.value.trim();
                  if (!num || !bank) return;
                  saveOurAccounts([...ourAccounts, { account: num, bank, role, notes }]);
                  (document.getElementById("new-acct-num") as HTMLInputElement).value = "";
                  (document.getElementById("new-acct-bank") as HTMLInputElement).value = "";
                  (document.getElementById("new-acct-notes") as HTMLInputElement).value = "";
                }}
                  className="px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded-xl text-sm font-semibold hover:opacity-80">
                  Add Account
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-3">Saved in browser. All AI features use this to determine internal vs external transfers.</p>
            </div>

            {/* Flagged External Accounts */}
            <div className="bg-white border border-red-200 rounded-2xl shadow-sm p-6 mb-6">
              <h3 className="text-sm font-semibold mb-1 text-red-600">Flagged External Accounts</h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">Identified fraudulent or suspicious external accounts where money was sent. AI will automatically flag any transaction going to these accounts.</p>

              {flaggedAccounts.length > 0 && (
                <div className="border border-red-200 rounded-xl overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-red-50">
                      <th className="px-3 py-2 text-left text-xs text-red-600 font-medium">Account / Identifier</th>
                      <th className="px-3 py-2 text-left text-xs text-red-600 font-medium">Name / Entity</th>
                      <th className="px-3 py-2 text-left text-xs text-red-600 font-medium">Reason</th>
                      <th className="px-3 py-2 w-16"></th>
                    </tr></thead>
                    <tbody>
                      {flaggedAccounts.map((a, i) => (
                        <tr key={i} className="border-t border-red-100">
                          <td className="px-3 py-2 font-mono font-medium text-red-600">{a.account}</td>
                          <td className="px-3 py-2">{a.name || "-"}</td>
                          <td className="px-3 py-2 text-[var(--text-muted)] text-xs">{a.reason}</td>
                          <td className="px-3 py-2">
                            <button onClick={() => saveFlaggedAccounts(flaggedAccounts.filter((_, j) => j !== i))}
                              className="text-xs text-red-600 hover:underline">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Account # / Identifier</label>
                  <input id="new-flag-acct" className="bg-[var(--bg-page)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm w-40" placeholder="e.g. 123456789" />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Name / Entity</label>
                  <input id="new-flag-name" className="bg-[var(--bg-page)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm w-48" placeholder="e.g. John Doe, Unknown LLC" />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Reason</label>
                  <input id="new-flag-reason" className="bg-[var(--bg-page)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm w-64" placeholder="e.g. Unauthorized wire recipient, suspected front company" />
                </div>
                <button onClick={() => {
                  const account = (document.getElementById("new-flag-acct") as HTMLInputElement)?.value.trim();
                  const name = (document.getElementById("new-flag-name") as HTMLInputElement)?.value.trim();
                  const reason = (document.getElementById("new-flag-reason") as HTMLInputElement)?.value.trim();
                  if (!account) return;
                  saveFlaggedAccounts([...flaggedAccounts, { account, name, reason: reason || "Flagged as suspicious" }]);
                  (document.getElementById("new-flag-acct") as HTMLInputElement).value = "";
                  (document.getElementById("new-flag-name") as HTMLInputElement).value = "";
                  (document.getElementById("new-flag-reason") as HTMLInputElement).value = "";
                }}
                  className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-500">
                  Flag Account
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-3">Saved in browser. AI will auto-flag transactions to these accounts as fraudulent.</p>
            </div>

            {/* Reference Signatures */}
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-6 mb-6">
              <h3 className="text-sm font-semibold mb-1">Reference Signatures</h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">Upload authentic signature images. These are compared against signatures found in transaction documents to detect forgery.</p>

              <div className="mb-4">
                <input type="file" accept="image/*" id="sig-upload" hidden
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setSigUploadStatus("Uploading...");
                    const form = new FormData();
                    form.append("file", file);
                    form.append("label", "reference");
                    const res = await fetch("/api/settings/signature", { method: "POST", body: form });
                    const data = await res.json();
                    if (data.error) setSigUploadStatus("Error: " + data.error);
                    else { setSigUploadStatus("Uploaded!"); loadRefSignatures(); }
                    e.target.value = "";
                  }} />
                <button onClick={() => document.getElementById("sig-upload")?.click()}
                  className="px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded-xl text-sm font-semibold hover:opacity-80">
                  Upload Signature Image
                </button>
                {sigUploadStatus && <span className="ml-3 text-xs text-[var(--text-muted)]">{sigUploadStatus}</span>}
              </div>

              {refSignatures.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-4">No reference signatures uploaded yet.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {refSignatures.map((sig, i) => (
                    <div key={i} className="border border-[var(--border)] rounded-xl p-3">
                      <img src={sig.url} alt={sig.name} className="w-full h-24 object-contain bg-[var(--bg-muted)] rounded-lg mb-2" />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-muted)] truncate">{sig.name}</span>
                        <button onClick={async () => {
                          await fetch("/api/settings/signature", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: sig.name }) });
                          loadRefSignatures();
                        }} className="text-xs text-red-600 hover:underline">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Data Tools */}
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-sm p-6 mb-6">
              <h3 className="text-sm font-semibold mb-1">Data Tools</h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">Fix data issues across all transactions</p>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <button
                    id="fix-directions-btn"
                    onClick={async () => {
                      const btn = document.getElementById("fix-directions-btn") as HTMLButtonElement;
                      const out = document.getElementById("fix-directions-output") as HTMLElement;
                      btn.disabled = true;
                      btn.textContent = "Scanning...";
                      out.textContent = "Finding cross-bank matched transfers with wrong directions...";
                      try {
                        // First dry run
                        const dryRes = await fetch("/api/transactions/fix-directions", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ dryRun: true }),
                        });
                        const dryData = await dryRes.json();
                        if (!dryData.fixes || dryData.fixes.length === 0) {
                          out.textContent = "No direction fixes needed — all cross-bank transfers have correct directions.";
                          btn.disabled = false;
                          btn.textContent = "Fix Cross-Bank Directions";
                          return;
                        }
                        out.innerHTML = `<strong>Found ${dryData.fixes.length} fixes needed:</strong><br/>` +
                          dryData.fixes.map((f: any) => `ID ${f.id}: ${f.oldDirection} → ${f.newDirection} (${f.reason})`).join("<br/>");
                        // Apply
                        btn.textContent = "Applying...";
                        const applyRes = await fetch("/api/transactions/fix-directions", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ dryRun: false }),
                        });
                        const applyData = await applyRes.json();
                        out.innerHTML += `<br/><br/><strong>${applyData.message}</strong>`;
                        btn.disabled = false;
                        btn.textContent = "Fix Cross-Bank Directions";
                      } catch (err: any) {
                        out.textContent = "Error: " + err.message;
                        btn.disabled = false;
                        btn.textContent = "Fix Cross-Bank Directions";
                      }
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-500 whitespace-nowrap"
                  >
                    Fix Cross-Bank Directions
                  </button>
                  <span className="text-xs text-[var(--text-muted)]">
                    Fixes matched transfers between own accounts: both sides → Internal Transfer
                  </span>
                </div>
                <div id="fix-directions-output" className="text-xs text-[var(--text-secondary)] bg-[var(--bg-muted)] rounded-lg p-3 min-h-[2rem] whitespace-pre-wrap"></div>
              </div>
            </div>

            {/* Info */}
            <div className="bg-[var(--bg-muted)] border border-[var(--border)] rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-2">How Signature Verification Works</h3>
              <ol className="text-xs text-[var(--text-secondary)] space-y-1.5 list-decimal list-inside">
                <li>Upload one or more reference (authentic) signatures above</li>
                <li>Attach transaction documents (PDFs, images) to each transaction via the Edit modal</li>
                <li>Click "Compare Signature" on any document to run AI analysis</li>
                <li>AI compares the document signature against your reference and reports: match/mismatch, confidence, and specific differences</li>
                <li>Transactions are automatically marked with fraudulent_signature = true/false</li>
              </ol>
            </div>
          </div>
          );
        })()}
      </main>

      {/* AI Chat Toggle Button (fixed) */}
      <button onClick={() => setChatOpen(!chatOpen)}
        className={`fixed bottom-6 z-40 px-5 py-3 rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 ${
          chatOpen ? "right-[432px] bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)] shadow-sm" : "right-6 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg"
        }`}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={chatOpen ? "M6 18L18 6M6 6l12 12" : "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"} />
        </svg>
        {chatOpen ? "Close" : "AI Analyst"}
        {aiAnnotations.length > 0 && !chatOpen && (
          <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] bg-amber-400 text-black rounded-full font-bold">{aiAnnotations.length}</span>
        )}
      </button>

      {/* AI Chat Sidebar */}
      <div className={`fixed top-0 right-0 h-full w-[420px] bg-white border-l border-[var(--border)] z-30 flex flex-col transition-transform duration-300 shadow-xl ${chatOpen ? "translate-x-0" : "translate-x-full"}`}>
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">AI Forensic Analyst</h3>
            <p className="text-[10px] text-[var(--text-muted)]">Analyzes data & annotates charts</p>
          </div>
          <div className="flex gap-2">
            {aiAnnotations.length > 0 && (
              <button onClick={() => setAiAnnotations([])} className="text-[10px] text-[var(--text-muted)] hover:text-white px-2 py-1 border border-[var(--border)] rounded">
                Clear ({aiAnnotations.length})
              </button>
            )}
            <button onClick={() => setChatOpen(false)} className="text-[var(--text-muted)] hover:text-white px-2 py-1 text-lg leading-none">&times;</button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.length === 0 && (
            <div className="text-center py-8 space-y-3">
              <p className="text-[var(--text-muted)] text-xs">Ask the AI to analyze your transactions:</p>
              <div className="flex flex-col gap-2">
                {["Where do you think fraud started?", "Which counterparties look suspicious?", "Analyze the withdrawal patterns", "When did the balance start dropping?", "Summarize the overall financial picture"].map(q => (
                  <button key={q} onClick={() => setChatInput(q)}
                    className="text-xs px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-2xl text-[var(--text-muted)] hover:text-white hover:border-indigo-400 transition-colors text-left">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chatMessages.map((msg, i) => (
            <div key={i} className={msg.role === "user" ? "flex justify-end" : ""}>
              {msg.role === "user" ? (
                <div className="bg-indigo-600 text-white rounded-2xl px-4 py-2.5 text-sm max-w-[85%]">
                  {msg.text}
                </div>
              ) : (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl px-4 py-3 text-sm">
                  <div className="prose prose-sm max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-ul:my-1 prose-ol:my-1 prose-code:px-1 prose-code:rounded prose-a:text-[var(--accent)]">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                  {((msg as any).actions || (msg.annotations && msg.annotations.length > 0)) && (
                    <div className="mt-3 pt-2 border-t border-[var(--border)] space-y-1">
                      {(msg as any).actions?.map((a: string, j: number) => (
                        <div key={`act-${j}`} className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                          <span>&#10003;</span> {a}
                        </div>
                      ))}
                      {msg.annotations && msg.annotations.length > 0 && (
                        <>
                          <p className="text-[10px] text-amber-600 font-medium">{msg.annotations.length} annotation{msg.annotations.length > 1 ? "s" : ""} on charts</p>
                          {msg.annotations.map((a: any, j: number) => (
                            <div key={j} className="text-[10px] text-[var(--text-muted)] flex gap-1">
                              <span className="font-medium" style={{ color: a.color || "#f59e0b" }}>{a.type}</span>
                              <span>{a.label}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {chatLoading && (
            <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl px-4 py-3">
              <span className="spinner"></span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-[var(--border)]">
          <div className="flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
              placeholder="Ask about the data..."
              className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-2xl px-3 py-2 text-sm" />
            <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()}
              className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 transition-colors disabled:opacity-50 rounded-lg text-sm font-medium">
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Trace Flow Modal */}
      {(traceData || traceLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { setTraceData(null); setTraceLoading(false); }} />
          <div className="relative bg-white border border-[var(--border)] rounded-2xl shadow-xl w-[900px] max-w-[95vw] max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Money Flow Trace</h3>
                {traceData && <p className="text-xs text-[var(--text-muted)]">Amount: {fmt(traceData.target_amount)} | Traced to destinations: {fmt(traceData.destinations_total)} | Unaccounted: {fmt(traceData.unaccounted)}</p>}
              </div>
              <button onClick={() => { setTraceData(null); setTraceLoading(false); }} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg">&times;</button>
            </div>
            <div className="overflow-auto flex-1 p-6">
              {traceLoading ? (
                <div className="text-center py-12"><span className="spinner"></span> Tracing flow...</div>
              ) : traceData?.chain && Array.isArray(traceData.chain) && traceData.chain.length > 0 ? (() => {
                // Group chain by step level — same step = same level (stacked vertically)
                const levels: Record<string, any[]> = {};
                for (const t of traceData.chain) {
                  const key = String(Math.floor(t.step));
                  if (!levels[key]) levels[key] = [];
                  levels[key].push(t);
                }
                const sortedKeys = Object.keys(levels).sort((a, b) => Number(a) - Number(b));

                return (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-muted)] mb-4">{traceData.chain_length} transactions in chain · Amount: {fmt(traceData.target_amount)}</p>
                  {/* Vertical flowchart */}
                  <div className="flex flex-col items-center gap-0">
                    {sortedKeys.map((key, levelIdx) => {
                      const txns = levels[key];
                      const isSplit = txns.length > 1;
                      return (
                        <React.Fragment key={key}>
                          {/* Arrow between levels */}
                          {levelIdx > 0 && (
                            <div className="flex flex-col items-center py-1">
                              <div className="w-0.5 h-4 bg-[var(--border)]" />
                              <svg className="w-4 h-4 text-[var(--text-muted)] -mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                              </svg>
                              {isSplit && (
                                <div className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 mt-0.5">
                                  SPLIT INTO {txns.length}
                                </div>
                              )}
                            </div>
                          )}
                          {/* Level: cards stacked vertically if split, single card if not */}
                          <div className={`flex ${isSplit ? "flex-row flex-wrap justify-center" : "flex-col items-center"} gap-3`}>
                            {txns.map((t: any) => {
                              const isStart = t.role === "start";
                              const isFx = t.role === "fx_delivery";
                              const isNeg = (t.amount || 0) < 0;
                              const borderColor = isStart ? "border-amber-400" : isFx ? "border-purple-300" : isNeg ? "border-red-300" : "border-emerald-300";
                              const bgColor = isStart ? "bg-amber-50" : isFx ? "bg-purple-50" : isNeg ? "bg-red-50" : "bg-emerald-50";
                              const labelColor = isStart ? "text-amber-600" : isFx ? "text-purple-600" : isNeg ? "text-red-600" : "text-emerald-600";
                              const stepLabel = isStart ? "ORIGIN" : isFx ? "FX DELIVERY" : t.role === "split" ? "SPLIT" : t.step < 0 ? `SOURCE ${Math.abs(t.step)}` : `STEP ${t.step}`;
                              const acctLabel = t.account || "-";
                              const bankLabel = t.bank || "";
                              return (
                                <div key={t.id} className={`border-2 ${borderColor} ${bgColor} rounded-xl p-4 w-[340px] ${isStart ? "ring-2 ring-amber-400 ring-offset-2" : ""}`}>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className={`text-[10px] ${labelColor} font-bold uppercase tracking-wide`}>{stepLabel}</span>
                                    <span className="text-[10px] text-[var(--text-muted)]">ID: {t.id}</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-[11px] text-[var(--text-muted)] font-medium">{bankLabel}{bankLabel && acctLabel ? " · " : ""}{acctLabel}</div>
                                      <div className="text-xs text-[var(--text-muted)]">{t.date}</div>
                                    </div>
                                    <div className={`text-xl font-bold ${isNeg ? "text-red-600" : "text-emerald-600"}`}>{fmt(t.amount)}</div>
                                  </div>
                                  <div className="text-xs mt-2 text-[var(--text)] leading-relaxed" style={{ wordBreak: "break-word" }}>{(t.description || "-").slice(0, 120)}</div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2">
                                    {t.counterparty && <span className="text-[10px] text-[var(--text-muted)]">To: <strong>{t.counterparty}</strong></span>}
                                    {t.beneficiary && <span className="text-[10px] text-[var(--text-muted)]">Beneficiary: <strong>{t.beneficiary}</strong></span>}
                                    {t.ext_bank && <span className="text-[10px] text-[var(--text-muted)]">Bank: {t.ext_bank}</span>}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <span className="text-[10px] text-[var(--text-muted)]">{t.direction || "-"}</span>
                                    <span className="text-[10px] text-[var(--text-muted)]">·</span>
                                    <span className="text-[10px] text-[var(--text-muted)]">{t.category || "-"}</span>
                                    <span className="text-[10px] text-[var(--text-muted)]">·</span>
                                    <FlagBadge flag={t.flag} />
                                  </div>
                                  {t.note && <div className="text-[10px] text-purple-600 mt-1 italic">{t.note}</div>}
                                </div>
                              );
                            })}
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>);
              })() : (
                <p className="text-[var(--text-muted)] text-center py-8">No flow chain found for this transaction. Try tracing from the middle of a transfer chain.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Match Group Modal */}
      {matchGroupView && matchGroupTxns.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMatchGroupView(null)} />
          <div className="relative bg-white border border-[var(--border)] rounded-2xl shadow-xl w-[800px] max-w-[95vw] max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Linked Transactions</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{matchGroupTxns.length} transactions in this match group</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => unlinkMatchGroup(matchGroupView)}
                  className="px-3 py-1.5 text-xs bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 rounded-lg">Unlink All</button>
                <button onClick={() => setMatchGroupView(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg ml-2">&times;</button>
              </div>
            </div>
            <div className="overflow-auto flex-1 p-4">
              {/* Flow visualization */}
              <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
                {matchGroupTxns.map((t: any, i: number) => (
                  <React.Fragment key={t.id}>
                    {i > 0 && (
                      <div className="flex-shrink-0 text-[var(--text-muted)]">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </div>
                    )}
                    <div className={`flex-shrink-0 border rounded-xl p-3 min-w-[200px] ${t.amount < 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
                      <div className="text-[10px] text-[var(--text-muted)] font-medium">{t.bank || "-"} · {t.account || "-"}</div>
                      <div className={`text-lg font-bold ${t.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(t.amount)}</div>
                      <div className="text-xs text-[var(--text-muted)]">{t.date}</div>
                      <div className="text-xs mt-1 truncate max-w-[180px]" title={t.description}>{t.description}</div>
                      {t.counterparty && <div className="text-[10px] text-[var(--text-muted)] mt-1">→ {t.counterparty}</div>}
                    </div>
                  </React.Fragment>
                ))}
              </div>
              {/* Detail table */}
              <table className="w-full text-sm">
                <thead><tr className="text-[var(--text-muted)] text-xs uppercase border-b border-[var(--border)]">
                  {["Date", "Account", "Bank", "Description", "Amount", "Direction", "Category", "Flag"].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {matchGroupTxns.map((t: any) => (
                    <tr key={t.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-muted)]">
                      <td className="px-3 py-2 whitespace-nowrap">{t.date}</td>
                      <td className="px-3 py-2 font-mono text-xs">{t.account}</td>
                      <td className="px-3 py-2">{t.bank || "-"}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate" title={t.description}>{t.description}</td>
                      <td className={`px-3 py-2 tabular-nums font-semibold ${t.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(t.amount)}</td>
                      <td className="px-3 py-2">{t.direction || "-"}</td>
                      <td className="px-3 py-2">{t.category || "-"}</td>
                      <td className="px-3 py-2"><FlagBadge flag={t.flag} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Receiving Entity Drill-Down Modal */}
      {drillCounterparty && analyticsData?.raw_transactions && (() => {
        const txns = analyticsData.raw_transactions
          .filter((t: any) => t.counterparty === drillCounterparty)
          .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const totalIn = txns.filter((t: any) => (t.amount || 0) > 0).reduce((s: number, t: any) => s + t.amount, 0);
        const totalOut = txns.filter((t: any) => (t.amount || 0) < 0).reduce((s: number, t: any) => s + Math.abs(t.amount), 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDrillCounterparty(null)} />
            <div className="relative bg-white border border-[var(--border)] rounded-2xl shadow-xl w-[800px] max-w-[95vw] max-h-[85vh] flex flex-col">
              <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">{drillCounterparty}</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{txns.length} transactions</p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div><span className="text-[var(--text-muted)]">In:</span> <span className="text-emerald-600 font-semibold">{fmt(totalIn)}</span></div>
                  <div><span className="text-[var(--text-muted)]">Out:</span> <span className="text-red-600 font-semibold">{fmt(totalOut)}</span></div>
                  <div><span className="text-[var(--text-muted)]">Net:</span> <span className={`font-semibold ${totalIn - totalOut >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmt(totalIn - totalOut)}</span></div>
                  <button onClick={() => setDrillCounterparty(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg ml-2">&times;</button>
                </div>
              </div>
              <div className="overflow-auto flex-1 p-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[var(--text-muted)] text-xs uppercase border-b border-[var(--border)]">
                      {["Date", "Description", "Amount", "Direction", "Account", "Category", "Flag"].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((t: any) => (
                      <tr key={t.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-muted)]">
                        <td className="px-3 py-2 whitespace-nowrap">{t.date || "-"}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate" title={t.description}>{t.description || "-"}</td>
                        <td className={`px-3 py-2 tabular-nums font-medium ${(t.amount || 0) < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(t.amount)}</td>
                        <td className="px-3 py-2">{t.direction || "-"}</td>
                        <td className="px-3 py-2">{t.account || "-"}</td>
                        <td className="px-3 py-2">{t.category || "-"}</td>
                        <td className="px-3 py-2"><FlagBadge flag={t.flag} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Modal */}
      {editTxn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setEditTxn(null)} />
          <div className="relative bg-white border border-[var(--border)] rounded-2xl p-6 w-[520px] max-w-[90vw] shadow-xl">
            <h3 className="text-base font-semibold mb-3">Edit Transaction</h3>
            <div className="text-xs text-[var(--text-muted)] mb-5 p-3 bg-[var(--bg)] rounded-xl ring-1 ring-[var(--border)]">
              <div><strong>Date:</strong> {editTxn.date} | <strong>Amount:</strong> {fmt(editTxn.amount)}</div>
              <div className="mt-1"><strong>Description:</strong> {editTxn.description}</div>
              {editTxn.security && <div className="mt-1"><strong>Security:</strong> {editTxn.security}</div>}
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Amount (use negative for withdrawals/outgoing)</label>
                <input type="number" step="0.01" className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]"
                  value={editForm.amount} onChange={e => setEditForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Category</label>
                <select className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]"
                  value={editForm.category} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}>
                  <option value="">Select...</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.is_suspicious ? "⚠ " : ""}{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Subcategory</label>
                <input className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]"
                  value={editForm.subcategory} onChange={e => setEditForm(p => ({ ...p, subcategory: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Flag</label>
                <select className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]"
                  value={editForm.flag} onChange={e => setEditForm(p => ({ ...p, flag: e.target.value }))}>
                  <option value="">None</option>
                  {["normal", "review", "suspicious", "critical", "verified_fraud", "disqualified"].map(f => <option key={f} value={f}>{f === "verified_fraud" ? "VERIFIED FRAUD" : f === "disqualified" ? "DISQUALIFIED" : f}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Direction</label>
                <select className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]"
                  value={editForm.direction} onChange={e => setEditForm(p => ({ ...p, direction: e.target.value }))}>
                  <option value="">Unknown</option>
                  <option value="Contribution">Contribution (Incoming)</option>
                  <option value="Withdraw">Withdraw (Outgoing)</option>
                  <option value="Internal Transfer">Internal Transfer</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Receiving Entity</label>
                <input className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]"
                  placeholder="Bank/entity that sent or received the money"
                  value={editForm.counterparty} onChange={e => setEditForm(p => ({ ...p, counterparty: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Beneficiary</label>
                <input className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]"
                  placeholder="Person/entity that ultimately benefits (e.g. client name from REF)"
                  value={editForm.beneficiary} onChange={e => setEditForm(p => ({ ...p, beneficiary: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">External Bank (receiving for withdrawals, originating for deposits)</label>
                <input className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]"
                  placeholder="e.g. Wells Fargo, Banca Mifel, City National Bank..."
                  value={editForm.ext_bank} onChange={e => setEditForm(p => ({ ...p, ext_bank: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Bank / Custodian</label>
                <input className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]"
                  placeholder="e.g. Pershing BNY, Schwab, Fidelity..."
                  value={editForm.bank} onChange={e => setEditForm(p => ({ ...p, bank: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
                <textarea className="w-full bg-[var(--bg)] ring-1 ring-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)]" rows={3}
                  value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
              {/* Documents */}
              <div className="pt-3 border-t border-[var(--border)]">
                <label className="block text-xs text-[var(--text-muted)] mb-2">Documents</label>
                <div className="space-y-2 mb-2">
                  {editDocs.map((doc: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-[var(--bg-page)] rounded-lg text-xs">
                      <a href={doc.url} target="_blank" rel="noopener" className="flex-1 text-indigo-600 hover:underline truncate">{doc.name}</a>
                      <span className="text-[var(--text-muted)]">{(doc.size / 1024).toFixed(0)}KB</span>
                      {doc.path?.match(/\.(png|jpg|jpeg|gif|webp)$/i) && refSignatures.length > 0 && (
                        <button onClick={() => compareSignature(doc.path)} disabled={sigComparing}
                          className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[10px] font-medium hover:bg-amber-100 disabled:opacity-50">
                          {sigComparing ? "..." : "Compare Sig"}
                        </button>
                      )}
                    </div>
                  ))}
                  {editDocs.length === 0 && <p className="text-xs text-[var(--text-muted)]">No documents attached</p>}
                </div>
                <input type="file" id="doc-upload" hidden onChange={e => { if (e.target.files?.[0]) uploadDocForTxn(e.target.files[0]); e.target.value = ""; }} />
                <button onClick={() => document.getElementById("doc-upload")?.click()}
                  className="px-3 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-muted)]">
                  Attach Document
                </button>
                {docUploadStatus && <span className="ml-2 text-xs text-[var(--text-muted)]">{docUploadStatus}</span>}
              </div>

              {/* Signature comparison result */}
              {sigCompareResult && (
                <div className={`p-3 rounded-xl border text-xs mt-2 ${
                  sigCompareResult.assessment === "authentic" ? "bg-emerald-50 border-emerald-200" :
                  sigCompareResult.assessment === "suspicious" ? "bg-amber-50 border-amber-200" :
                  "bg-red-50 border-red-200"
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{sigCompareResult.assessment?.toUpperCase()}</span>
                    <span className="text-[var(--text-muted)]">Confidence: {((sigCompareResult.confidence || 0) * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-[var(--text-secondary)]">{sigCompareResult.reasoning}</p>
                  {sigCompareResult.differences?.length > 0 && (
                    <ul className="mt-1 list-disc list-inside text-[var(--text-muted)]">
                      {sigCompareResult.differences.map((d: string, i: number) => <li key={i}>{d}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditTxn(null)} className="px-4 py-2 border border-[var(--border)] rounded text-sm hover:bg-[var(--bg-muted)]">Cancel</button>
              <button onClick={saveEdit} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 transition-colors rounded text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
