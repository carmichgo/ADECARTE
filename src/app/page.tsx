"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Papa from "papaparse";
import ReactMarkdown from "react-markdown";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceDot, ReferenceArea,
  ReferenceLine
} from "recharts";

type Tab = "dashboard" | "upload" | "transactions" | "categorize" | "suspicious" | "analytics";
type Flag = "" | "normal" | "review" | "suspicious" | "critical";

interface Transaction {
  id: number; date: string; settle_date: string; description: string; amount: number;
  unit_price: number; quantity: number; currency: string; account: string;
  account_name: string; reference: string; counterparty: string;
  symbol: string; security: string; strategy: string; direction: string;
  category: string; subcategory: string; flag: string; notes: string;
  categorized_by: string; raw_data: any;
}
interface Category { id: number; name: string; description: string; is_suspicious: boolean; }
interface Stats {
  total_transactions: number; total_amount: number; categorized: number;
  uncategorized: number; suspicious_amount: number;
  suspicious_breakdown: any[]; by_category: any[]; by_flag: any[]; by_account: any[];
}

const fmt = (n: number | null) => {
  if (n == null) return "$0.00";
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "-$" : "$") + abs;
};

export default function Home() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState({ category: "", subcategory: "", flag: "", notes: "", direction: "", counterparty: "" });
  const [filters, setFilters] = useState({ search: "", category: "", flag: "", min: "", max: "" });
  const [sort, setSort] = useState({ field: "id", desc: true });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ type: string; msg: string } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ type: string; msg: string } | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkFlag, setBulkFlag] = useState("");
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [partyLoading, setPartyLoading] = useState(false);
  const [partyStatus, setPartyStatus] = useState<{ type: string; msg: string } | null>(null);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [counterparties, setCounterparties] = useState<Array<{ name: string; count: number; total_amount: number }>>([]);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergeCanonical, setMergeCanonical] = useState("");
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeStatus, setMergeStatus] = useState<{ type: string; msg: string } | null>(null);
  // Cluster detection config
  const [showClusters, setShowClusters] = useState(true);
  const [clusterMinWithdrawals, setClusterMinWithdrawals] = useState(3);
  const [clusterMinAmount, setClusterMinAmount] = useState(10000);
  const [clusterWindowDays, setClusterWindowDays] = useState(7);
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
    if (filters.min) q.set("min_amount", filters.min);
    if (filters.max) q.set("max_amount", filters.max);
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
    setTransactions(rows);
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

  useEffect(() => { loadCategories(); loadStats(); }, [loadCategories, loadStats]);
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

  // ── Cluster detection (computed client-side) ───
  const withdrawalClusters = (() => {
    if (!analyticsData?.balance_over_time) return [];
    const data = analyticsData.balance_over_time;
    const clusters: Array<{ startIdx: number; endIdx: number; count: number; total: number; label: string }> = [];

    for (let i = 0; i < data.length; i++) {
      // Look ahead within window
      let windowCount = 0;
      let windowTotal = 0;
      let endIdx = i;

      for (let j = i; j < data.length; j++) {
        const dayDiff = j - i; // approximate: each entry is a date
        if (dayDiff > clusterWindowDays) break;
        windowCount += data[j].withdraw_count || 0;
        windowTotal += data[j].withdraw_total || 0;
        endIdx = j;
      }

      if (windowCount >= clusterMinWithdrawals && windowTotal >= clusterMinAmount) {
        // Avoid overlapping clusters
        if (clusters.length === 0 || i > clusters[clusters.length - 1].endIdx) {
          clusters.push({
            startIdx: i,
            endIdx,
            count: windowCount,
            total: windowTotal,
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
        }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { text: "Error parsing response", annotations: [] }; }

      setChatMessages(prev => [...prev, { role: "ai", text: data.text || "No response", annotations: data.annotations }]);
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
  const openEdit = (t: Transaction) => {
    setEditTxn(t);
    setEditForm({ category: t.category || "", subcategory: t.subcategory || "", flag: t.flag || "", notes: t.notes || "", direction: t.direction || "", counterparty: t.counterparty || "" });
  };

  const saveEdit = async () => {
    if (!editTxn) return;
    await fetch(`/api/transactions/${editTxn.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    setEditTxn(null);
    loadTransactions();
    loadStats();
  };

  // ── Bulk ───
  const applyBulk = async () => {
    const updates: any = {};
    if (bulkCategory) updates.category = bulkCategory;
    if (bulkFlag) updates.flag = bulkFlag;
    if (Object.keys(updates).length === 0) return;
    await fetch("/api/transactions/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], updates }),
    });
    loadTransactions();
    loadStats();
    setBulkCategory(""); setBulkFlag("");
  };

  // ── AI ───
  const runAi = async () => {
    setAiLoading(true);
    setAiStatus({ type: "info", msg: "AI is analyzing transactions. This may take a moment..." });
    try {
      const res = await fetch("/api/ai/categorize", { method: "POST" });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { error: `Server error (${res.status}): ${text.slice(0, 200)}` }; }
      if (data.error) setAiStatus({ type: "error", msg: data.error });
      else {
        const flagged = data.results?.filter((r: any) => r.flag === "suspicious" || r.flag === "critical").length || 0;
        setAiStatus({
          type: "success",
          msg: `Categorized ${data.categorized} transactions.${flagged > 0 ? ` ⚠ ${flagged} flagged as suspicious/critical!` : ""}`,
        });
        loadStats();
      }
    } catch (err: any) { setAiStatus({ type: "error", msg: "Request failed: " + err.message }); }
    setAiLoading(false);
  };

  // ── Expanded rows ───
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => {
    const next = new Set(expandedRows);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedRows(next);
  };

  // ── Derived ───
  const suspiciousTxns = transactions.filter(t =>
    t.flag === "suspicious" || t.flag === "critical" || (t.category && t.category.startsWith("SUSPICIOUS"))
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
      normal: "bg-green-500/15 text-green-400",
      review: "bg-yellow-500/15 text-yellow-400",
      suspicious: "bg-orange-500/15 text-orange-400",
      critical: "bg-red-500/15 text-red-400",
    };
    return <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${colors[flag] || ""}`}>{flag}</span>;
  };

  const SourceBadge = ({ src }: { src: string }) => {
    if (!src) return null;
    const c = src === "manual" ? "border-indigo-400 text-indigo-400" : "border-amber-400 text-amber-400";
    return <span className={`text-[10px] px-1.5 py-0.5 border rounded ${c}`}>{src}</span>;
  };

  const StatusMsg = ({ status }: { status: { type: string; msg: string } | null }) => {
    if (!status) return null;
    const c = { success: "border-green-500 bg-green-500/10", error: "border-red-500 bg-red-500/10 text-red-400", info: "border-indigo-500 bg-indigo-500/10" }[status.type] || "";
    return <div className={`mt-3 p-3 rounded-lg border text-sm ${c}`}>{status.msg}</div>;
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <nav className="w-[220px] bg-[var(--bg-card)] border-r border-[var(--border)] p-6 flex flex-col fixed top-0 bottom-0">
        <div>
          <h1 className="text-xl font-bold text-indigo-400 tracking-widest">ADECARTE</h1>
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Transaction Investigator</span>
        </div>
        <ul className="mt-8 space-y-0.5">
          {([["dashboard", "Dashboard"], ["upload", "Upload CSV"], ["transactions", "All Transactions"], ["categorize", "Categorize"], ["analytics", "Analytics"], ["suspicious", "Suspicious Activity"]] as [Tab, string][]).map(([key, label]) => (
            <li key={key}>
              <button onClick={() => setTab(key)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${tab === key ? "bg-indigo-500 text-white" : "text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-hover)]"}`}>
                {label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-auto">
          <a href="/api/export" className="block text-center text-sm px-3 py-2 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-hover)] transition-colors">
            Export CSV
          </a>
        </div>
      </nav>

      {/* Main */}
      <main className="ml-[220px] flex-1 p-8 min-w-0">

        {/* ═══ Dashboard ═══ */}
        {tab === "dashboard" && stats && (
          <>
            <h2 className="text-2xl font-semibold mb-6">Investigation Dashboard</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
              {[
                ["Total Transactions", stats.total_transactions, false],
                ["Total Amount", fmt(stats.total_amount), false],
                ["Categorized", stats.categorized, false],
                ["Uncategorized", stats.uncategorized, false],
                ["Suspicious Amount", fmt(stats.suspicious_amount), true],
              ].map(([label, value, alert], i) => (
                <div key={i} className={`bg-[var(--bg-card)] border rounded-lg p-5 text-center ${alert ? "border-red-500 bg-red-500/5" : "border-[var(--border)]"}`}>
                  <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label as string}</div>
                  <div className="text-2xl font-bold mt-2">{String(value)}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5">
                <h3 className="font-semibold mb-3">By Category</h3>
                <div className="max-h-72 overflow-y-auto space-y-1">
                  {stats.by_category.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No data yet</p> :
                    stats.by_category.map((c, i) => (
                      <div key={i} className="flex justify-between text-sm py-1 border-b border-[var(--border)]">
                        <span className="flex-1 truncate">{c.category}</span>
                        <span className="text-[var(--text-muted)] mx-3">{c.count}</span>
                        <span className="font-semibold tabular-nums">{fmt(c.total_amount)}</span>
                      </div>
                    ))}
                </div>
              </div>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5">
                <h3 className="font-semibold mb-3">By Flag</h3>
                <div className="space-y-1">
                  {stats.by_flag.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No data yet</p> :
                    stats.by_flag.map((f, i) => (
                      <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-[var(--border)]">
                        <FlagBadge flag={f.flag} />
                        <span className="text-[var(--text-muted)] mx-3">{f.count}</span>
                        <span className="font-semibold tabular-nums">{fmt(f.total_amount)}</span>
                      </div>
                    ))}
                </div>
              </div>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5">
                <h3 className="font-semibold mb-3">Suspicious Breakdown</h3>
                <div className="space-y-1">
                  {stats.suspicious_breakdown.length === 0 ? <p className="text-sm text-[var(--text-muted)]">None detected</p> :
                    stats.suspicious_breakdown.map((s, i) => (
                      <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-[var(--border)]">
                        <span className="flex-1 truncate">{s.category}</span>
                        <FlagBadge flag={s.flag} />
                        <span className="text-[var(--text-muted)] mx-2">{s.count}</span>
                        <span className="font-semibold text-red-400 tabular-nums">{fmt(s.total_amount)}</span>
                      </div>
                    ))}
                </div>
              </div>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5">
                <h3 className="font-semibold mb-3">By Account</h3>
                <div className="max-h-72 overflow-y-auto space-y-1">
                  {!stats.by_account || stats.by_account.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No data yet</p> :
                    stats.by_account.map((a: any, i: number) => (
                      <div key={i} className="flex justify-between text-sm py-1.5 border-b border-[var(--border)]">
                        <span className="flex-1 truncate font-medium">{a.account}</span>
                        <span className="text-[var(--text-muted)] mx-2 text-xs">{a.count} txns</span>
                        <span className={`font-semibold tabular-nums ${a.total_amount < 0 ? "text-red-400" : "text-green-400"}`}>{fmt(a.total_amount)}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ═══ Upload ═══ */}
        {tab === "upload" && (
          <>
            <h2 className="text-2xl font-semibold mb-6">Upload Transactions</h2>
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5">
              {!csvFile ? (
                <div
                  className="border-2 border-dashed border-[var(--border)] rounded-lg p-12 text-center cursor-pointer hover:border-indigo-400 transition-colors"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("border-indigo-400"); }}
                  onDragLeave={e => e.currentTarget.classList.remove("border-indigo-400")}
                  onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("border-indigo-400"); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); }}
                >
                  <p className="text-[var(--text-muted)] mb-4">Drag & drop a CSV file here, or click to browse</p>
                  <button className="px-4 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-md text-sm hover:bg-[var(--bg-hover)]">Choose File</button>
                  <input ref={fileRef} type="file" accept=".csv" hidden onChange={e => { if (e.target.files?.length) handleFile(e.target.files[0]); }} />
                </div>
              ) : (
                <>
                  <h3 className="font-semibold mb-3">Column Mapping</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {["date", "settle_date", "description", "amount", "unit_price", "quantity", "currency", "account", "account_name", "reference", "counterparty", "symbol", "security", "strategy", "direction"].map(f => (
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
                        <thead><tr>{csvHeaders.map(h => <th key={h} className="bg-[var(--bg-hover)] text-[var(--text-muted)] px-2 py-1 text-left">{h}</th>)}</tr></thead>
                        <tbody>{csvPreview.map((row, i) => <tr key={i}>{csvHeaders.map(h => <td key={h} className="px-2 py-1 border-b border-[var(--border)]">{row[h]}</td>)}</tr>)}</tbody>
                      </table>
                      <p className="text-xs text-[var(--text-muted)] mt-1">Showing first {csvPreview.length} rows</p>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button onClick={confirmUpload} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 rounded-md text-sm font-medium">Upload & Import</button>
                    <button onClick={() => { setCsvFile(null); setCsvHeaders([]); setCsvPreview([]); setUploadStatus(null); }} className="px-4 py-2 border border-[var(--border)] rounded-md text-sm hover:bg-[var(--bg-hover)]">Cancel</button>
                  </div>
                </>
              )}
              <StatusMsg status={uploadStatus} />
            </div>
          </>
        )}

        {/* ═══ All Transactions ═══ */}
        {tab === "transactions" && (
          <>
            <h2 className="text-2xl font-semibold mb-6">All Transactions</h2>
            <div className="flex flex-wrap gap-2 mb-4 items-center">
              <input placeholder="Search..." className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-3 py-1.5 w-60"
                value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") loadTransactions(); }} />
              <select className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-2 py-1.5"
                value={filters.category} onChange={e => setFilters(p => ({ ...p, category: e.target.value }))}>
                <option value="">All Categories</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.is_suspicious ? "⚠ " : ""}{c.name}</option>)}
              </select>
              <select className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-2 py-1.5"
                value={filters.flag} onChange={e => setFilters(p => ({ ...p, flag: e.target.value }))}>
                <option value="">All Flags</option>
                {["normal", "review", "suspicious", "critical"].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <input type="number" placeholder="Min $" className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-2 py-1.5 w-24"
                value={filters.min} onChange={e => setFilters(p => ({ ...p, min: e.target.value }))} />
              <input type="number" placeholder="Max $" className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-2 py-1.5 w-24"
                value={filters.max} onChange={e => setFilters(p => ({ ...p, max: e.target.value }))} />
              <button onClick={loadTransactions} className="px-3 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded text-sm hover:bg-[var(--bg-hover)]">Filter</button>
              <button onClick={() => { setFilters({ search: "", category: "", flag: "", min: "", max: "" }); }} className="px-3 py-1.5 border border-[var(--border)] rounded text-sm hover:bg-[var(--bg-hover)]">Clear</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-[var(--border)] rounded-lg">
                <thead>
                  <tr>
                    <th className="bg-[var(--bg-hover)] px-3 py-2"><input type="checkbox" onChange={toggleAll} checked={selectedIds.size === transactions.length && transactions.length > 0} /></th>
                    {([
                      ["date", "Trade Date"], ["description", "Description"], ["amount", "Amount"],
                      ["settle_date", "Settle Date"], ["symbol", "Symbol"], ["security", "Security"],
                      ["direction", "Direction"], ["quantity", "Qty"], ["unit_price", "Unit Price"],
                      ["account_name", "Account"], ["strategy", "Strategy"], ["counterparty", "Counterparty"],
                      ["category", "Category"], ["flag", "Flag"], ["categorized_by", "Source"],
                    ] as [string, string][]).map(([f, l]) => (
                      <th key={f} className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase tracking-wide px-3 py-2 text-left cursor-pointer hover:text-white select-none"
                        onClick={() => handleSort(f)}>
                        {l} {sort.field === f ? (sort.desc ? "↓" : "↑") : ""}
                      </th>
                    ))}
                    <th className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr><td colSpan={17} className="text-center text-[var(--text-muted)] py-8">No transactions found. Upload a CSV to get started.</td></tr>
                  ) : transactions.map(t => {
                    const dirLower = (t.direction || "").toLowerCase();
                    const dirColor = dirLower.match(/^(internal|transfer between|internal transfer)/)
                      ? "text-amber-400 font-semibold"
                      : dirLower.match(/^(buy|in|incoming|deposit|credit|contribut|receive)/)
                        ? "text-green-400 font-semibold"
                        : dirLower ? "text-red-400 font-semibold" : "";
                    const expanded = expandedRows.has(t.id);
                    return (
                    <tr key={t.id} className="hover:bg-[var(--bg-hover)] border-b border-[var(--border)] align-top">
                      <td className="px-3 py-2"><input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{t.date || "-"}</td>
                      <td className="px-3 py-2 min-w-[200px]">
                        <div className={expanded ? "" : "max-w-[250px] truncate"} title={t.description}>
                          {t.description || "-"}
                        </div>
                        {t.description && t.description.length > 30 && (
                          <button onClick={() => toggleExpand(t.id)} className="text-[10px] text-indigo-400 hover:underline mt-0.5">
                            {expanded ? "collapse" : "expand"}
                          </button>
                        )}
                      </td>
                      <td className={`px-3 py-2 tabular-nums font-medium ${t.amount < 0 ? "text-red-400" : "text-green-400"}`}>{fmt(t.amount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{t.settle_date || "-"}</td>
                      <td className="px-3 py-2 font-mono">{t.symbol || "-"}</td>
                      <td className="px-3 py-2 min-w-[120px]">
                        <div className={expanded ? "" : "max-w-[150px] truncate"} title={t.security}>{t.security || "-"}</div>
                      </td>
                      <td className="px-3 py-2">{t.direction ? <span className={dirColor}>{t.direction}</span> : "-"}</td>
                      <td className="px-3 py-2 tabular-nums">{t.quantity || "-"}</td>
                      <td className="px-3 py-2 tabular-nums">{t.unit_price ? fmt(t.unit_price) : "-"}</td>
                      <td className="px-3 py-2">{t.account || t.account_name || "-"}</td>
                      <td className="px-3 py-2">{t.strategy || "-"}</td>
                      <td className="px-3 py-2">{t.counterparty || "-"}</td>
                      <td className="px-3 py-2 text-sm">{t.category || <span className="text-[var(--text-muted)]">—</span>}</td>
                      <td className="px-3 py-2"><FlagBadge flag={t.flag} /></td>
                      <td className="px-3 py-2"><SourceBadge src={t.categorized_by} /></td>
                      <td className="px-3 py-2 text-center"><button onClick={() => openEdit(t)} className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--bg-hover)]">Edit</button></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 mt-3 p-3 bg-[var(--bg-card)] border border-indigo-500 rounded-lg">
                <span className="text-sm font-medium">{selectedIds.size} selected</span>
                <select className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-2 py-1" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}>
                  <option value="">Set Category...</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <select className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-2 py-1" value={bulkFlag} onChange={e => setBulkFlag(e.target.value)}>
                  <option value="">Set Flag...</option>
                  {["normal", "review", "suspicious", "critical"].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <button onClick={applyBulk} className="px-3 py-1 bg-indigo-500 hover:bg-indigo-400 rounded text-sm">Apply</button>
              </div>
            )}
          </>
        )}

        {/* ═══ Categorize ═══ */}
        {tab === "categorize" && (
          <>
            <h2 className="text-2xl font-semibold mb-6">AI Categorization</h2>
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 space-y-5">
              <div className="border border-[var(--border)] rounded-lg p-4">
                <h3 className="text-indigo-400 font-semibold mb-2">Step 1: Manual Categorization</h3>
                <p className="text-sm text-[var(--text-muted)] mb-2">Go to All Transactions and manually categorize at least 3 transactions. The more you categorize, the better the AI will perform.</p>
                <p className="text-sm text-[var(--text-muted)]">{stats?.categorized || 0} categorized, {stats?.uncategorized || 0} remaining</p>
              </div>
              <div className="border border-[var(--border)] rounded-lg p-4">
                <h3 className="text-indigo-400 font-semibold mb-2">Step 2: AI Auto-Categorize</h3>
                <p className="text-sm text-[var(--text-muted)] mb-3">Click below to let AI categorize remaining transactions using your manual labels as guidance.</p>
                <button onClick={runAi} disabled={aiLoading || (stats?.uncategorized || 0) === 0}
                  className="px-6 py-2.5 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-md font-medium">
                  {aiLoading ? <><span className="spinner mr-2"></span>Running AI...</> : "Run AI Categorization"}
                </button>
                <StatusMsg status={aiStatus} />
              </div>
              <div className="border border-[var(--border)] rounded-lg p-4">
                <h3 className="text-indigo-400 font-semibold mb-2">Step 3: Review Results</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Review AI categorizations in <button onClick={() => setTab("transactions")} className="text-indigo-400 underline">Transactions</button> tab.
                  Check <button onClick={() => setTab("suspicious")} className="text-indigo-400 underline">Suspicious Activity</button> for flagged items.
                </p>
              </div>
            </div>
          </>
        )}

        {/* ═══ Suspicious ═══ */}
        {tab === "suspicious" && (
          <>
            <h2 className="text-2xl font-semibold mb-6">Suspicious Activity Report</h2>
            {suspiciousTxns.length > 0 && (
              <div className="p-4 rounded-lg mb-4 bg-red-500/10 border border-red-500 text-center font-semibold">
                ⚠ {suspiciousTxns.length} suspicious transactions — Total: {fmt(suspiciousTxns.reduce((s, t) => s + (t.amount || 0), 0))}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-[var(--border)] rounded-lg">
                <thead>
                  <tr>
                    {["Date", "Description", "Amount", "Direction", "Symbol", "Security", "Qty", "Account", "Strategy", "Category", "Flag", "AI Notes", "Actions"].map(h => (
                      <th key={h} className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase px-3 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suspiciousTxns.length === 0 ? (
                    <tr><td colSpan={13} className="text-center text-[var(--text-muted)] py-8">No suspicious transactions found. Run AI categorization to detect fraud patterns.</td></tr>
                  ) : suspiciousTxns.map(t => (
                    <tr key={t.id} className="hover:bg-[var(--bg-hover)] border-b border-[var(--border)]">
                      <td className="px-3 py-2 whitespace-nowrap">{t.date || "-"}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{t.description || "-"}</td>
                      <td className={`px-3 py-2 tabular-nums font-medium ${t.amount < 0 ? "text-red-400" : "text-green-400"}`}>{fmt(t.amount)}</td>
                      <td className="px-3 py-2">{t.direction ? <span className={
                        t.direction.toLowerCase().match(/^(internal|transfer between|internal transfer)/) ? "text-amber-400 font-semibold" :
                        t.direction.toLowerCase().match(/^(buy|in|incoming|deposit|credit|contribut|receive)/) ? "text-green-400 font-semibold" : "text-red-400 font-semibold"
                      }>{t.direction}</span> : "-"}</td>
                      <td className="px-3 py-2 font-mono">{t.symbol || "-"}</td>
                      <td className="px-3 py-2 max-w-[150px] truncate">{t.security || "-"}</td>
                      <td className="px-3 py-2 tabular-nums">{t.quantity || "-"}</td>
                      <td className="px-3 py-2">{t.account || t.account_name || "-"}</td>
                      <td className="px-3 py-2">{t.strategy || "-"}</td>
                      <td className="px-3 py-2">{t.category}</td>
                      <td className="px-3 py-2"><FlagBadge flag={t.flag} /></td>
                      <td className="px-3 py-2 max-w-[250px] text-xs text-[var(--text-muted)] truncate" title={t.notes}>{t.notes || "-"}</td>
                      <td className="px-3 py-2"><button onClick={() => openEdit(t)} className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--bg-hover)]">Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {suspiciousTxns.length > 0 && (() => {
              const byCategory: Record<string, { count: number; total: number }> = {};
              suspiciousTxns.forEach(t => {
                const cat = t.category || "Unknown";
                if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0 };
                byCategory[cat].count++;
                byCategory[cat].total += t.amount || 0;
              });
              const totalSusp = suspiciousTxns.reduce((s, t) => s + (t.amount || 0), 0);
              return (
                <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mt-4">
                  <h3 className="font-semibold mb-3">Investigation Summary</h3>
                  <table className="w-full text-sm">
                    <thead><tr>
                      <th className="text-left text-[var(--text-muted)] text-xs uppercase px-3 py-2">Category</th>
                      <th className="text-left text-[var(--text-muted)] text-xs uppercase px-3 py-2">Count</th>
                      <th className="text-left text-[var(--text-muted)] text-xs uppercase px-3 py-2">Total Amount</th>
                    </tr></thead>
                    <tbody>
                      {Object.entries(byCategory).map(([cat, d]) => (
                        <tr key={cat} className="border-b border-[var(--border)]">
                          <td className="px-3 py-2">{cat}</td>
                          <td className="px-3 py-2">{d.count}</td>
                          <td className="px-3 py-2 text-red-400 font-semibold">{fmt(d.total)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-[var(--border)] font-bold">
                        <td className="px-3 py-2">TOTAL SUSPICIOUS</td>
                        <td className="px-3 py-2">{suspiciousTxns.length}</td>
                        <td className="px-3 py-2 text-red-400">{fmt(totalSusp)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </>
        )}

        {/* ═══ Analytics ═══ */}
        {tab === "analytics" && (
          <>
            <h2 className="text-2xl font-semibold mb-6">Analytics & Fund Flow</h2>

            {/* AI Party Extraction */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">AI Party Identification</h3>
                  <p className="text-sm text-[var(--text-muted)] mt-1">Use AI to read transaction descriptions and identify who sent or received money.</p>
                </div>
                <button onClick={runPartyExtraction} disabled={partyLoading}
                  className="px-5 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 rounded-md text-sm font-medium whitespace-nowrap">
                  {partyLoading ? <><span className="spinner mr-2"></span>Running...</> : "Extract Parties"}
                </button>
              </div>
              {partyStatus && <StatusMsg status={partyStatus} />}
            </div>

            {/* Merge Counterparties */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mb-6">
              <h3 className="font-semibold mb-1">Merge Counterparties</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Select duplicate/similar counterparties and merge them into one canonical name.</p>
              <div className="flex gap-2 mb-3 items-center">
                <input placeholder="Search counterparties..." className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-3 py-1.5 w-64"
                  value={mergeSearch} onChange={e => setMergeSearch(e.target.value)} />
                <span className="text-xs text-[var(--text-muted)]">{mergeSelected.size} selected</span>
                {mergeSelected.size > 0 && (
                  <button onClick={() => { setMergeSelected(new Set()); setMergeCanonical(""); }} className="text-xs text-indigo-400 hover:underline">Clear</button>
                )}
              </div>
              <div className="max-h-[250px] overflow-y-auto border border-[var(--border)] rounded-lg mb-3">
                {counterparties.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] p-4 text-center">No counterparties found. Run AI Party Identification first.</p>
                ) : counterparties
                    .filter(c => !mergeSearch || c.name.toLowerCase().includes(mergeSearch.toLowerCase()))
                    .map(c => (
                  <label key={c.name}
                    className={`flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-hover)] cursor-pointer border-b border-[var(--border)] last:border-0 text-sm ${mergeSelected.has(c.name) ? "bg-indigo-500/10" : ""}`}>
                    <input type="checkbox" checked={mergeSelected.has(c.name)} onChange={() => toggleMergeSelect(c.name)} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-[var(--text-muted)] text-xs">{c.count} txns</span>
                    <span className={`text-xs tabular-nums font-medium ${c.total_amount < 0 ? "text-red-400" : "text-green-400"}`}>{fmt(c.total_amount)}</span>
                  </label>
                ))}
              </div>
              {mergeSelected.size >= 2 && (
                <div className="flex gap-2 items-center">
                  <label className="text-sm text-[var(--text-muted)] whitespace-nowrap">Merge into:</label>
                  <select className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-2 py-1.5 flex-1"
                    value={mergeCanonical} onChange={e => setMergeCanonical(e.target.value)}>
                    {[...mergeSelected].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <span className="text-[var(--text-muted)]">or</span>
                  <input placeholder="Custom name..." className="bg-[var(--bg)] border border-[var(--border)] text-sm rounded px-3 py-1.5 flex-1"
                    value={[...mergeSelected].includes(mergeCanonical) ? "" : mergeCanonical}
                    onChange={e => setMergeCanonical(e.target.value)} />
                  <button onClick={mergeCounterparties} className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 rounded text-sm font-medium whitespace-nowrap">
                    Merge ({mergeSelected.size})
                  </button>
                </div>
              )}
              {mergeStatus && <StatusMsg status={mergeStatus} />}
            </div>

            {!analyticsData ? (
              <div className="text-center text-[var(--text-muted)] py-12">Loading analytics...</div>
            ) : (
              <>
                {/* Cluster Detection Config */}
                <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm">Withdrawal Cluster Detection</h3>
                    <button onClick={() => setShowClusters(!showClusters)}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${showClusters ? "bg-red-500/20 border-red-500/50 text-red-400" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
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
                    <span className="text-xs text-amber-400 font-medium">
                      {withdrawalClusters.length} cluster{withdrawalClusters.length !== 1 ? "s" : ""} detected
                    </span>
                  </div>
                </div>

                {/* Chart 1: Overall Balance Over Time + Clusters + AI Annotations */}
                <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mb-6">
                  <h3 className="font-semibold mb-1">Overall Balance Over Time</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-4">Red dots = withdrawal clusters. Orange highlighted zones = AI-flagged regions.</p>
                  {analyticsData.balance_over_time.length === 0 ? (
                    <p className="text-[var(--text-muted)] text-sm py-8 text-center">No data available</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={analyticsData.balance_over_time}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2e3d" />
                        <XAxis dataKey="date" tick={{ fill: "#8b8d98", fontSize: 11 }} angle={-45} textAnchor="end" height={70} />
                        <YAxis tick={{ fill: "#8b8d98", fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ background: "#1a1d27", border: "1px solid #2a2e3d", borderRadius: 8, fontSize: 12 }}
                          formatter={(value: any, name: any) => [fmt(Number(value)), String(name)]}
                        />
                        <Legend />
                        {/* AI highlight annotations */}
                        {aiAnnotations.filter(a => a.chart === "balance" && a.type === "highlight").map((a, i) => (
                          <ReferenceArea key={`ai-area-${i}`}
                            x1={analyticsData.balance_over_time[a.dateIndex]?.date}
                            x2={analyticsData.balance_over_time[a.dateIndexEnd ?? a.dateIndex]?.date}
                            fill={a.color || "#f97316"} fillOpacity={0.15}
                            label={{ value: a.label, fill: a.color || "#f97316", fontSize: 10, position: "insideTop" }}
                          />
                        ))}
                        {/* Cluster highlight zones */}
                        {showClusters && withdrawalClusters.map((c, i) => (
                          <ReferenceArea key={`cluster-${i}`}
                            x1={analyticsData.balance_over_time[c.startIdx]?.date}
                            x2={analyticsData.balance_over_time[c.endIdx]?.date}
                            fill="#ef4444" fillOpacity={0.1}
                            label={{ value: c.label, fill: "#ef4444", fontSize: 9, position: "insideTop" }}
                          />
                        ))}
                        <Line type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2} dot={false} name="Balance" />
                        <Line type="monotone" dataKey="inflow" stroke="#22c55e" strokeWidth={1} dot={false} name="Daily Inflow" />
                        <Line type="monotone" dataKey="outflow" stroke="#ef4444" strokeWidth={1} dot={false} name="Daily Outflow" />
                        {/* Cluster dots on balance line */}
                        {showClusters && withdrawalClusters.map((c, i) => {
                          const midIdx = Math.floor((c.startIdx + c.endIdx) / 2);
                          const point = analyticsData.balance_over_time[midIdx];
                          if (!point) return null;
                          return <ReferenceDot key={`cdot-${i}`} x={point.date} y={point.balance} r={8} fill="#ef4444" stroke="#fff" strokeWidth={2} />;
                        })}
                        {/* AI dot/circle annotations */}
                        {aiAnnotations.filter(a => a.chart === "balance" && (a.type === "dot" || a.type === "circle" || a.type === "arrow")).map((a, i) => {
                          const point = analyticsData.balance_over_time[a.dateIndex];
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
                  )}
                </div>

                {/* Chart 2: Balance Over Time by Account */}
                <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mb-6">
                  <h3 className="font-semibold mb-1">Balance Over Time by Account</h3>
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
                      <ResponsiveContainer width="100%" height={350}>
                        <LineChart>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2e3d" />
                          <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fill: "#8b8d98", fontSize: 11 }} angle={-45} textAnchor="end" height={70} />
                          <YAxis tick={{ fill: "#8b8d98", fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                          <Tooltip contentStyle={{ background: "#1a1d27", border: "1px solid #2a2e3d", borderRadius: 8, fontSize: 12 }} formatter={(value: any, name: any) => [fmt(Number(value)), String(name)]} />
                          <Legend />
                          {Object.entries(analyticsData.balance_by_account).map(([acct, points]: [string, any], i: number) => {
                            const colors = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#64748b"];
                            if (!selectedAccounts.has(acct)) return null;
                            return <Line key={acct} data={points} type="monotone" dataKey="balance" stroke={colors[i % colors.length]} strokeWidth={2} dot={false} name={acct} />;
                          })}
                        </LineChart>
                      </ResponsiveContainer>
                    </>
                  )}
                </div>

                {/* Chart 3: Counterparty Breakdown */}
                <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mb-6">
                  <h3 className="font-semibold mb-1">Deposits vs Withdrawals by Counterparty</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-4">Number of incoming vs outgoing transactions per party.</p>
                  {analyticsData.transaction_counts.length === 0 ? (
                    <p className="text-[var(--text-muted)] text-sm py-8 text-center">No data available</p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={Math.max(300, analyticsData.transaction_counts.length * 32)}>
                        <BarChart data={analyticsData.transaction_counts} layout="vertical" margin={{ left: 150 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2e3d" />
                          <XAxis type="number" tick={{ fill: "#8b8d98", fontSize: 11 }} />
                          <YAxis dataKey="party" type="category" tick={{ fill: "#8b8d98", fontSize: 11 }} width={140} />
                          <Tooltip contentStyle={{ background: "#1a1d27", border: "1px solid #2a2e3d", borderRadius: 8, fontSize: 12 }} />
                          <Legend />
                          <Bar dataKey="deposits" fill="#22c55e" name="Deposits (In)" />
                          <Bar dataKey="withdrawals" fill="#ef4444" name="Withdrawals (Out)" />
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full text-sm border border-[var(--border)] rounded-lg">
                          <thead><tr>
                            {["Party", "Deposits", "Deposit Amount", "Withdrawals", "Withdrawal Amount", "Net"].map(h => (
                              <th key={h} className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase px-3 py-2 text-left">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {analyticsData.transaction_counts.map((p: any) => (
                              <tr key={p.party} className="hover:bg-[var(--bg-hover)] border-b border-[var(--border)]">
                                <td className="px-3 py-2 font-medium">{p.party}</td>
                                <td className="px-3 py-2 text-green-400">{p.deposits}</td>
                                <td className="px-3 py-2 text-green-400 tabular-nums">{fmt(p.deposit_amount)}</td>
                                <td className="px-3 py-2 text-red-400">{p.withdrawals}</td>
                                <td className="px-3 py-2 text-red-400 tabular-nums">{fmt(p.withdrawal_amount)}</td>
                                <td className={`px-3 py-2 font-semibold tabular-nums ${p.deposit_amount - p.withdrawal_amount >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(p.deposit_amount - p.withdrawal_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>

              </>
            )}
          </>
        )}
      </main>

      {/* AI Chat Toggle Button (fixed) */}
      <button onClick={() => setChatOpen(!chatOpen)}
        className={`fixed bottom-6 z-40 px-4 py-3 rounded-full shadow-lg text-sm font-medium transition-all ${
          chatOpen ? "right-[420px] bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-white" : "right-6 bg-indigo-500 hover:bg-indigo-400 text-white"
        }`}>
        {chatOpen ? "Close" : "AI Analyst"}
        {aiAnnotations.length > 0 && !chatOpen && (
          <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-[10px] bg-amber-500 text-black rounded-full">{aiAnnotations.length}</span>
        )}
      </button>

      {/* AI Chat Sidebar */}
      <div className={`fixed top-0 right-0 h-full w-[400px] bg-[var(--bg-card)] border-l border-[var(--border)] z-30 flex flex-col transition-transform duration-300 ${chatOpen ? "translate-x-0" : "translate-x-full"}`}>
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
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
                    className="text-xs px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text-muted)] hover:text-white hover:border-indigo-400 transition-colors text-left">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chatMessages.map((msg, i) => (
            <div key={i} className={msg.role === "user" ? "flex justify-end" : ""}>
              {msg.role === "user" ? (
                <div className="bg-indigo-500/20 border border-indigo-500/30 rounded-lg px-3 py-2 text-sm max-w-[85%]">
                  {msg.text}
                </div>
              ) : (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm">
                  <div className="prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-ul:my-1 prose-ol:my-1 prose-code:text-indigo-300 prose-code:bg-[var(--bg-card)] prose-code:px-1 prose-code:rounded prose-strong:text-white prose-a:text-indigo-400">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                  {msg.annotations && msg.annotations.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-[var(--border)]">
                      <p className="text-[10px] text-amber-400 font-medium mb-1">{msg.annotations.length} annotation{msg.annotations.length > 1 ? "s" : ""} added to charts</p>
                      {msg.annotations.map((a: any, j: number) => (
                        <div key={j} className="text-[10px] text-[var(--text-muted)] flex gap-1">
                          <span className="font-medium" style={{ color: a.color || "#f59e0b" }}>{a.type}</span>
                          <span>{a.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {chatLoading && (
            <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3">
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
              className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
            <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()}
              className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 rounded-lg text-sm font-medium">
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editTxn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setEditTxn(null)} />
          <div className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-6 w-[500px] max-w-[90vw]">
            <h3 className="text-lg font-semibold mb-2">Edit Transaction</h3>
            <div className="text-xs text-[var(--text-muted)] mb-4 p-2 bg-[var(--bg)] rounded border border-[var(--border)]">
              <div><strong>Date:</strong> {editTxn.date} | <strong>Amount:</strong> {fmt(editTxn.amount)}</div>
              <div className="mt-1"><strong>Description:</strong> {editTxn.description}</div>
              {editTxn.security && <div className="mt-1"><strong>Security:</strong> {editTxn.security}</div>}
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Category</label>
                <select className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm"
                  value={editForm.category} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}>
                  <option value="">Select...</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.is_suspicious ? "⚠ " : ""}{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Subcategory</label>
                <input className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm"
                  value={editForm.subcategory} onChange={e => setEditForm(p => ({ ...p, subcategory: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Flag</label>
                <select className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm"
                  value={editForm.flag} onChange={e => setEditForm(p => ({ ...p, flag: e.target.value }))}>
                  <option value="">None</option>
                  {["normal", "review", "suspicious", "critical"].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Direction</label>
                <select className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm"
                  value={editForm.direction} onChange={e => setEditForm(p => ({ ...p, direction: e.target.value }))}>
                  <option value="">Unknown</option>
                  <option value="Contribution">Contribution (Incoming)</option>
                  <option value="Withdraw">Withdraw (Outgoing)</option>
                  <option value="Internal Transfer">Internal Transfer</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Counterparty</label>
                <input className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm"
                  placeholder="Who sent or received the money"
                  value={editForm.counterparty} onChange={e => setEditForm(p => ({ ...p, counterparty: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
                <textarea className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm" rows={3}
                  value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditTxn(null)} className="px-4 py-2 border border-[var(--border)] rounded text-sm hover:bg-[var(--bg-hover)]">Cancel</button>
              <button onClick={saveEdit} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 rounded text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
