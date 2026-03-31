"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Papa from "papaparse";

type Tab = "dashboard" | "upload" | "transactions" | "categorize" | "suspicious";
type Flag = "" | "normal" | "review" | "suspicious" | "critical";

interface Transaction {
  id: number; date: string; description: string; amount: number;
  currency: string; account: string; reference: string; counterparty: string;
  category: string; subcategory: string; flag: string; notes: string;
  categorized_by: string; raw_data: any;
}
interface Category { id: number; name: string; description: string; is_suspicious: boolean; }
interface Stats {
  total_transactions: number; total_amount: number; categorized: number;
  uncategorized: number; suspicious_amount: number;
  suspicious_breakdown: any[]; by_category: any[]; by_flag: any[];
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
  const [editForm, setEditForm] = useState({ category: "", subcategory: "", flag: "", notes: "" });
  const [filters, setFilters] = useState({ search: "", category: "", flag: "", min: "", max: "" });
  const [sort, setSort] = useState({ field: "date", desc: true });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ type: string; msg: string } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ type: string; msg: string } | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkFlag, setBulkFlag] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/categories");
    setCategories(await res.json());
  }, []);

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/stats");
    setStats(await res.json());
  }, []);

  const loadTransactions = useCallback(async () => {
    const q = new URLSearchParams();
    if (filters.search) q.set("search", filters.search);
    if (filters.category) q.set("category", filters.category);
    if (filters.flag) q.set("flag", filters.flag);
    if (filters.min) q.set("min_amount", filters.min);
    if (filters.max) q.set("max_amount", filters.max);
    q.set("order", sort.field);
    if (sort.desc) q.set("desc", "1");
    const res = await fetch("/api/transactions?" + q.toString());
    setTransactions(await res.json());
    setSelectedIds(new Set());
  }, [filters, sort]);

  useEffect(() => { loadCategories(); loadStats(); }, [loadCategories, loadStats]);
  useEffect(() => { if (tab === "transactions" || tab === "suspicious") loadTransactions(); }, [tab, loadTransactions]);
  useEffect(() => { if (tab === "dashboard") loadStats(); }, [tab, loadStats]);

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
        date: ["date", "fecha", "transaction date", "posting date", "value date", "trade date", "settle date"],
        description: ["description", "descripcion", "memo", "detail", "narrative", "concepto", "security", "symbol"],
        amount: ["amount", "monto", "importe", "value", "unit price"],
        currency: ["currency", "moneda"],
        account: ["account", "cuenta", "account name"],
        reference: ["reference", "referencia", "ref", "strategy", "direction", "quantity"],
        counterparty: ["counterparty", "beneficiary", "beneficiario", "payee", "recipient"],
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
      if (data.error) setUploadStatus({ type: "error", msg: data.error });
      else {
        setUploadStatus({ type: "success", msg: `${data.message} (Batch: ${data.batch_id})` });
        loadStats();
        setCsvFile(null); setCsvHeaders([]); setCsvPreview([]);
      }
    } catch (err: any) { setUploadStatus({ type: "error", msg: err.message }); }
  };

  // ── Edit ───
  const openEdit = (t: Transaction) => {
    setEditTxn(t);
    setEditForm({ category: t.category || "", subcategory: t.subcategory || "", flag: t.flag || "", notes: t.notes || "" });
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
      const data = await res.json();
      if (data.error) setAiStatus({ type: "error", msg: data.error });
      else {
        const flagged = data.results?.filter((r: any) => r.flag === "suspicious" || r.flag === "critical").length || 0;
        setAiStatus({
          type: "success",
          msg: `Categorized ${data.categorized} transactions.${flagged > 0 ? ` ⚠ ${flagged} flagged as suspicious/critical!` : ""}`,
        });
        loadStats();
      }
    } catch (err: any) { setAiStatus({ type: "error", msg: err.message }); }
    setAiLoading(false);
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
          {([["dashboard", "Dashboard"], ["upload", "Upload CSV"], ["transactions", "All Transactions"], ["categorize", "Categorize"], ["suspicious", "Suspicious Activity"]] as [Tab, string][]).map(([key, label]) => (
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    {["date", "description", "amount", "currency", "account", "reference", "counterparty"].map(f => (
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
                    {[["date", "Date"], ["description", "Description"], ["amount", "Amount"]].map(([f, l]) => (
                      <th key={f} className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase tracking-wide px-3 py-2 text-left cursor-pointer hover:text-white"
                        onClick={() => handleSort(f)}>
                        {l} {sort.field === f ? (sort.desc ? "↓" : "↑") : ""}
                      </th>
                    ))}
                    <th className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase px-3 py-2 text-left">Counterparty</th>
                    <th className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase px-3 py-2 text-left cursor-pointer hover:text-white" onClick={() => handleSort("category")}>
                      Category {sort.field === "category" ? (sort.desc ? "↓" : "↑") : ""}
                    </th>
                    <th className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase px-3 py-2 text-left">Flag</th>
                    <th className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase px-3 py-2 text-left">Source</th>
                    <th className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr><td colSpan={9} className="text-center text-[var(--text-muted)] py-8">No transactions found. Upload a CSV to get started.</td></tr>
                  ) : transactions.map(t => (
                    <tr key={t.id} className="hover:bg-[var(--bg-hover)] border-b border-[var(--border)]">
                      <td className="px-3 py-2"><input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{t.date || "-"}</td>
                      <td className="px-3 py-2 max-w-[250px] truncate" title={t.description}>{t.description || "-"}</td>
                      <td className={`px-3 py-2 tabular-nums font-medium ${t.amount < 0 ? "text-red-400" : "text-green-400"}`}>{fmt(t.amount)}</td>
                      <td className="px-3 py-2">{t.counterparty || "-"}</td>
                      <td className="px-3 py-2 text-sm">{t.category || <span className="text-[var(--text-muted)]">—</span>}</td>
                      <td className="px-3 py-2"><FlagBadge flag={t.flag} /></td>
                      <td className="px-3 py-2"><SourceBadge src={t.categorized_by} /></td>
                      <td className="px-3 py-2 text-center"><button onClick={() => openEdit(t)} className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--bg-hover)]">Edit</button></td>
                    </tr>
                  ))}
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
                    {["Date", "Description", "Amount", "Counterparty", "Category", "Flag", "AI Notes", "Actions"].map(h => (
                      <th key={h} className="bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs uppercase px-3 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suspiciousTxns.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-[var(--text-muted)] py-8">No suspicious transactions found. Run AI categorization to detect fraud patterns.</td></tr>
                  ) : suspiciousTxns.map(t => (
                    <tr key={t.id} className="hover:bg-[var(--bg-hover)] border-b border-[var(--border)]">
                      <td className="px-3 py-2 whitespace-nowrap">{t.date || "-"}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{t.description || "-"}</td>
                      <td className={`px-3 py-2 tabular-nums font-medium ${t.amount < 0 ? "text-red-400" : "text-green-400"}`}>{fmt(t.amount)}</td>
                      <td className="px-3 py-2">{t.counterparty || "-"}</td>
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
      </main>

      {/* Edit Modal */}
      {editTxn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setEditTxn(null)} />
          <div className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-6 w-[500px] max-w-[90vw]">
            <h3 className="text-lg font-semibold mb-4">Edit Transaction</h3>
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
