// ── State ─────────────────────────────────────────────────────────────────────
let categories = [];
let currentSort = { field: "date", desc: true };
let selectedIds = new Set();
let csvFile = null;
let csvHeaders = [];
let csvPreviewRows = [];
let fieldMap = {};

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    loadCategories();
    loadDashboard();
    setupNavigation();
    setupUpload();
    setupSearch();
    setupBulkActions();
    setupModal();
    setupExport();
});

// ── Navigation ───────────────────────────────────────────────────────────────
function setupNavigation() {
    document.querySelectorAll("[data-tab]").forEach(el => {
        el.addEventListener("click", e => {
            e.preventDefault();
            switchTab(el.dataset.tab);
        });
    });
}

function switchTab(tab) {
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
    document.getElementById("tab-" + tab).classList.add("active");
    document.querySelector(`.nav-link[data-tab="${tab}"]`)?.classList.add("active");

    if (tab === "dashboard") loadDashboard();
    if (tab === "transactions") loadTransactions();
    if (tab === "categorize") loadCategorizeStatus();
    if (tab === "suspicious") loadSuspicious();
}

// ── API helpers ──────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json", ...opts.headers },
        ...opts,
    });
    return res.json();
}

function fmt(amount) {
    if (amount == null) return "$0.00";
    const n = Number(amount);
    const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? "-$" : "$") + s;
}

function flagHtml(flag) {
    if (!flag) return "";
    return `<span class="flag flag-${flag}">${flag}</span>`;
}

function sourceHtml(src) {
    if (!src) return "";
    return `<span class="source-tag source-${src}">${src}</span>`;
}

function amountHtml(amount) {
    const n = Number(amount);
    const cls = n < 0 ? "amount-negative" : "amount-positive";
    return `<span class="${cls}">${fmt(n)}</span>`;
}

// ── Categories ───────────────────────────────────────────────────────────────
async function loadCategories() {
    categories = await api("/api/categories");
    populateCategoryDropdowns();
}

function populateCategoryDropdowns() {
    const selects = ["filter-category", "bulk-category", "edit-category"];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">Select Category...</option>';
        categories.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.name;
            opt.textContent = c.is_suspicious ? "⚠ " + c.name : c.name;
            sel.appendChild(opt);
        });
        sel.value = current;
    });
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
    const stats = await api("/api/stats");
    document.getElementById("stat-total").textContent = stats.total_transactions;
    document.getElementById("stat-amount").textContent = fmt(stats.total_amount);
    document.getElementById("stat-categorized").textContent = stats.categorized;
    document.getElementById("stat-uncategorized").textContent = stats.uncategorized;
    document.getElementById("stat-suspicious").textContent = fmt(stats.suspicious_amount);

    // Category breakdown
    const catDiv = document.getElementById("category-breakdown");
    if (stats.by_category.length === 0) {
        catDiv.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No categorized transactions yet</p>';
    } else {
        catDiv.innerHTML = stats.by_category.map(c => `
            <div class="breakdown-item">
                <span class="breakdown-name">${c.category || "Uncategorized"}</span>
                <span class="breakdown-count">${c.count} txns</span>
                <span class="breakdown-amount">${fmt(c.total_amount)}</span>
            </div>`).join("");
    }

    // Flag breakdown
    const flagDiv = document.getElementById("flag-breakdown");
    if (stats.by_flag.length === 0) {
        flagDiv.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No flagged transactions yet</p>';
    } else {
        flagDiv.innerHTML = stats.by_flag.map(f => `
            <div class="breakdown-item">
                ${flagHtml(f.flag)}
                <span class="breakdown-count">${f.count} txns</span>
                <span class="breakdown-amount">${fmt(f.total_amount)}</span>
            </div>`).join("");
    }

    // Suspicious breakdown
    const suspDiv = document.getElementById("suspicious-breakdown");
    if (stats.suspicious_breakdown.length === 0) {
        suspDiv.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No suspicious transactions detected</p>';
    } else {
        suspDiv.innerHTML = stats.suspicious_breakdown.map(s => `
            <div class="breakdown-item">
                <span class="breakdown-name">${s.category}</span>
                ${flagHtml(s.flag)}
                <span class="breakdown-count">${s.count}</span>
                <span class="breakdown-amount" style="color:var(--danger)">${fmt(s.total_amount)}</span>
            </div>`).join("");
    }
}

// ── Upload ───────────────────────────────────────────────────────────────────
function setupUpload() {
    const zone = document.getElementById("upload-zone");
    const input = document.getElementById("file-input");

    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", e => {
        e.preventDefault();
        zone.classList.remove("dragover");
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    input.addEventListener("change", () => { if (input.files.length) handleFile(input.files[0]); });

    document.getElementById("btn-confirm-upload").addEventListener("click", confirmUpload);
}

function handleFile(file) {
    if (!file.name.endsWith(".csv")) { alert("Please upload a CSV file"); return; }
    csvFile = file;

    const reader = new FileReader();
    reader.onload = e => {
        const lines = e.target.result.split("\n").filter(l => l.trim());
        if (lines.length < 2) { alert("CSV appears empty"); return; }

        csvHeaders = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
        csvPreviewRows = lines.slice(1, 6).map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));

        showFieldMapping();
    };
    reader.readAsText(file);
}

function showFieldMapping() {
    const fields = ["date", "description", "amount", "currency", "account", "reference", "counterparty"];
    const mapDiv = document.getElementById("field-mapping");

    mapDiv.innerHTML = fields.map(f => {
        const options = csvHeaders.map(h =>
            `<option value="${h}" ${h.toLowerCase().includes(f) ? "selected" : ""}>${h}</option>`
        ).join("");
        return `
            <div class="field-map-item">
                <label>${f}:</label>
                <select class="input" data-field="${f}">
                    <option value="">-- skip --</option>
                    ${options}
                </select>
            </div>`;
    }).join("");

    // Auto-select based on common patterns
    autoSelectMappings();

    // Preview table
    const previewDiv = document.getElementById("csv-preview-table");
    previewDiv.innerHTML = `
        <table style="margin-top:1rem;">
            <thead><tr>${csvHeaders.map(h => `<th>${h}</th>`).join("")}</tr></thead>
            <tbody>${csvPreviewRows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
        <p style="color:var(--text-muted);font-size:0.8rem;margin-top:0.5rem;">Showing first ${csvPreviewRows.length} rows</p>`;

    document.getElementById("upload-preview").classList.remove("hidden");
}

function autoSelectMappings() {
    const patterns = {
        date: ["date", "fecha", "transaction date", "trans date", "posting date", "value date"],
        description: ["description", "descripcion", "memo", "detail", "details", "narrative", "concept", "concepto"],
        amount: ["amount", "monto", "importe", "value", "sum", "debit", "credit"],
        currency: ["currency", "moneda", "ccy"],
        account: ["account", "cuenta", "account number", "acct"],
        reference: ["reference", "referencia", "ref", "transaction id", "trans id"],
        counterparty: ["counterparty", "beneficiary", "beneficiario", "payee", "recipient", "destinatario"],
    };

    for (const [field, candidates] of Object.entries(patterns)) {
        const sel = document.querySelector(`select[data-field="${field}"]`);
        if (!sel) continue;
        for (const candidate of candidates) {
            const match = csvHeaders.find(h => h.toLowerCase().trim() === candidate);
            if (match) { sel.value = match; break; }
        }
    }
}

async function confirmUpload() {
    if (!csvFile) return;

    fieldMap = {};
    document.querySelectorAll("#field-mapping select").forEach(sel => {
        if (sel.value) fieldMap[sel.dataset.field] = sel.value;
    });

    const formData = new FormData();
    formData.append("file", csvFile);
    formData.append("field_map", JSON.stringify(fieldMap));

    const statusDiv = document.getElementById("upload-status");
    statusDiv.className = "status status-info";
    statusDiv.innerHTML = '<span class="spinner"></span> Uploading...';

    try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.error) {
            statusDiv.className = "status status-error";
            statusDiv.textContent = data.error;
        } else {
            statusDiv.className = "status status-success";
            statusDiv.textContent = `${data.message} (Batch: ${data.batch_id})`;
            loadDashboard();
        }
    } catch (err) {
        statusDiv.className = "status status-error";
        statusDiv.textContent = "Upload failed: " + err.message;
    }
}

// ── Transactions ─────────────────────────────────────────────────────────────
async function loadTransactions(params = {}) {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.category) query.set("category", params.category);
    if (params.flag) query.set("flag", params.flag);
    if (params.min_amount) query.set("min_amount", params.min_amount);
    if (params.max_amount) query.set("max_amount", params.max_amount);
    query.set("order", currentSort.field);
    if (currentSort.desc) query.set("desc", "1");

    const txns = await api("/api/transactions?" + query.toString());
    renderTransactions(txns);
}

function renderTransactions(txns) {
    const tbody = document.getElementById("transactions-body");
    selectedIds.clear();
    updateBulkBar();

    if (txns.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:2rem;">No transactions found. Upload a CSV to get started.</td></tr>';
        return;
    }

    tbody.innerHTML = txns.map(t => `
        <tr data-id="${t.id}">
            <td><input type="checkbox" class="row-check" data-id="${t.id}"></td>
            <td>${t.date || "-"}</td>
            <td title="${(t.description || "").replace(/"/g, '&quot;')}">${truncate(t.description, 50)}</td>
            <td>${amountHtml(t.amount)}</td>
            <td>${t.counterparty || "-"}</td>
            <td>${t.category ? `<span title="${t.subcategory || ""}">${t.category}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td>${flagHtml(t.flag)}</td>
            <td>${sourceHtml(t.categorized_by)}</td>
            <td><button class="btn btn-sm" onclick="openEditModal(${t.id})">Edit</button></td>
        </tr>`).join("");
}

function truncate(str, len) {
    if (!str) return "-";
    return str.length > len ? str.slice(0, len) + "..." : str;
}

// ── Search & Filter ──────────────────────────────────────────────────────────
function setupSearch() {
    document.getElementById("btn-search").addEventListener("click", applyFilters);
    document.getElementById("btn-clear-filters").addEventListener("click", () => {
        document.getElementById("search-input").value = "";
        document.getElementById("filter-category").value = "";
        document.getElementById("filter-flag").value = "";
        document.getElementById("filter-min").value = "";
        document.getElementById("filter-max").value = "";
        loadTransactions();
    });
    document.getElementById("search-input").addEventListener("keydown", e => {
        if (e.key === "Enter") applyFilters();
    });

    // Sort
    document.querySelectorAll(".sortable").forEach(th => {
        th.addEventListener("click", () => {
            const field = th.dataset.sort;
            if (currentSort.field === field) {
                currentSort.desc = !currentSort.desc;
            } else {
                currentSort = { field, desc: false };
            }
            applyFilters();
        });
    });
}

function applyFilters() {
    loadTransactions({
        search: document.getElementById("search-input").value,
        category: document.getElementById("filter-category").value,
        flag: document.getElementById("filter-flag").value,
        min_amount: document.getElementById("filter-min").value,
        max_amount: document.getElementById("filter-max").value,
    });
}

// ── Bulk Actions ─────────────────────────────────────────────────────────────
function setupBulkActions() {
    document.getElementById("select-all").addEventListener("change", e => {
        document.querySelectorAll(".row-check").forEach(cb => {
            cb.checked = e.target.checked;
            if (e.target.checked) selectedIds.add(Number(cb.dataset.id));
            else selectedIds.delete(Number(cb.dataset.id));
        });
        updateBulkBar();
    });

    document.getElementById("transactions-body").addEventListener("change", e => {
        if (e.target.classList.contains("row-check")) {
            const id = Number(e.target.dataset.id);
            if (e.target.checked) selectedIds.add(id);
            else selectedIds.delete(id);
            updateBulkBar();
        }
    });

    document.getElementById("btn-bulk-apply").addEventListener("click", async () => {
        const cat = document.getElementById("bulk-category").value;
        const flag = document.getElementById("bulk-flag").value;
        const updates = {};
        if (cat) updates.category = cat;
        if (flag) updates.flag = flag;
        if (Object.keys(updates).length === 0) return;

        await api("/api/transactions/bulk-update", {
            method: "POST",
            body: JSON.stringify({ ids: [...selectedIds], updates }),
        });
        loadTransactions();
    });
}

function updateBulkBar() {
    const bar = document.getElementById("bulk-actions");
    if (selectedIds.size > 0) {
        bar.classList.remove("hidden");
        document.getElementById("selected-count").textContent = selectedIds.size + " selected";
    } else {
        bar.classList.add("hidden");
    }
}

// ── Edit Modal ───────────────────────────────────────────────────────────────
function setupModal() {
    document.getElementById("btn-modal-cancel").addEventListener("click", closeModal);
    document.querySelector(".modal-backdrop").addEventListener("click", closeModal);
    document.getElementById("btn-modal-save").addEventListener("click", saveEdit);
}

async function openEditModal(id) {
    const txns = await api(`/api/transactions?search=`);
    const txn = txns.find(t => t.id === id);
    if (!txn) return;

    document.getElementById("edit-id").value = id;
    document.getElementById("edit-category").value = txn.category || "";
    document.getElementById("edit-subcategory").value = txn.subcategory || "";
    document.getElementById("edit-flag").value = txn.flag || "";
    document.getElementById("edit-notes").value = txn.notes || "";
    document.getElementById("edit-modal").classList.remove("hidden");
}

function closeModal() {
    document.getElementById("edit-modal").classList.add("hidden");
}

async function saveEdit() {
    const id = document.getElementById("edit-id").value;
    await api(`/api/transactions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
            category: document.getElementById("edit-category").value,
            subcategory: document.getElementById("edit-subcategory").value,
            flag: document.getElementById("edit-flag").value,
            notes: document.getElementById("edit-notes").value,
        }),
    });
    closeModal();
    applyFilters();
}

// ── AI Categorize ────────────────────────────────────────────────────────────
async function loadCategorizeStatus() {
    const stats = await api("/api/stats");
    document.getElementById("manual-count").textContent =
        `${stats.categorized} transactions categorized (${stats.uncategorized} remaining)`;
    document.getElementById("uncategorized-count").textContent =
        `${stats.uncategorized} transactions awaiting categorization`;

    const btn = document.getElementById("btn-ai-categorize");
    btn.disabled = stats.uncategorized === 0;
    btn.onclick = runAiCategorize;
}

async function runAiCategorize() {
    const btn = document.getElementById("btn-ai-categorize");
    const status = document.getElementById("ai-status");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Running AI...';
    status.className = "status status-info";
    status.textContent = "AI is analyzing transactions. This may take a moment...";

    try {
        const res = await api("/api/ai/categorize", { method: "POST" });
        if (res.error) {
            status.className = "status status-error";
            status.textContent = res.error;
        } else {
            status.className = "status status-success";
            const flagged = res.results ? res.results.filter(r => r.flag === "suspicious" || r.flag === "critical").length : 0;
            status.innerHTML = `
                Categorized ${res.categorized} transactions.<br>
                ${flagged > 0 ? `<strong style="color:var(--danger)">⚠ ${flagged} transactions flagged as suspicious/critical!</strong> Check the Suspicious Activity tab.` : "No suspicious transactions detected."}`;
        }
    } catch (err) {
        status.className = "status status-error";
        status.textContent = "AI categorization failed: " + err.message;
    }

    btn.disabled = false;
    btn.textContent = "Run AI Categorization";
    loadCategorizeStatus();
}

// ── Suspicious ───────────────────────────────────────────────────────────────
async function loadSuspicious() {
    const txns = await api("/api/transactions?desc=1&order=amount");
    const suspicious = txns.filter(t =>
        t.flag === "suspicious" || t.flag === "critical" || (t.category && t.category.startsWith("SUSPICIOUS"))
    );

    const alert = document.getElementById("suspicious-alert");
    if (suspicious.length === 0) {
        alert.textContent = "";
        document.getElementById("suspicious-body").innerHTML =
            '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:2rem;">No suspicious transactions found. Run AI categorization to detect fraud patterns.</td></tr>';
        document.getElementById("suspicious-summary").innerHTML = "";
        return;
    }

    const totalSuspicious = suspicious.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    alert.innerHTML = `⚠ ${suspicious.length} suspicious transactions detected — Total amount: ${fmt(totalSuspicious)}`;

    document.getElementById("suspicious-body").innerHTML = suspicious.map(t => `
        <tr>
            <td>${t.date || "-"}</td>
            <td>${truncate(t.description, 40)}</td>
            <td>${amountHtml(t.amount)}</td>
            <td>${t.counterparty || "-"}</td>
            <td>${t.category || "-"}</td>
            <td>${flagHtml(t.flag)}</td>
            <td style="max-width:250px;font-size:0.8rem;color:var(--text-muted)">${t.notes || "-"}</td>
            <td><button class="btn btn-sm" onclick="openEditModal(${t.id})">Edit</button></td>
        </tr>`).join("");

    // Summary
    const byCategory = {};
    suspicious.forEach(t => {
        const cat = t.category || "Unknown";
        if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0 };
        byCategory[cat].count++;
        byCategory[cat].total += Number(t.amount) || 0;
    });

    document.getElementById("suspicious-summary").innerHTML = `
        <h3>Investigation Summary</h3>
        <table>
            <thead><tr><th>Category</th><th>Count</th><th>Total Amount</th></tr></thead>
            <tbody>
                ${Object.entries(byCategory).map(([cat, d]) => `
                    <tr>
                        <td>${cat}</td>
                        <td>${d.count}</td>
                        <td style="color:var(--danger);font-weight:600">${fmt(d.total)}</td>
                    </tr>`).join("")}
                <tr style="border-top:2px solid var(--border);font-weight:700">
                    <td>TOTAL SUSPICIOUS</td>
                    <td>${suspicious.length}</td>
                    <td style="color:var(--danger)">${fmt(totalSuspicious)}</td>
                </tr>
            </tbody>
        </table>`;
}

// ── Export ────────────────────────────────────────────────────────────────────
function setupExport() {
    document.getElementById("btn-export").addEventListener("click", () => {
        window.location.href = "/api/export";
    });
}
