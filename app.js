function readStored(key, fallback, validate) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return validate(value) ? value : fallback;
  } catch { return fallback; }
}
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function saveStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { showToast("Browser storage unavailable. Export your shortlist before leaving."); }
}

const state = {
  payload: null,
  projects: [],
  filtered: [],
  selectedId: null,
  page: 1,
  pageSize: 10,
  weights: { service: 35, audience: 25, evidence: 20, timing: 10, award: 10 },
  shortlist: new Set(readStored("rr-shortlist", [], (v) => Array.isArray(v) && v.every((id) => typeof id === "string"))),
  reviews: readStored("rr-reviews", {}, (v) => isRecord(v) && Object.values(v).every((r) => isRecord(r) && typeof r.status === "string" && typeof r.note === "string")),
};

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
const compactMoney = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", notation: "compact", maximumFractionDigits: 1 }).format(value);
const shortDate = (value) => {
  const [year, month, day] = String(value || "").split("/").map(Number);
  if (!year || !month || !day) return value || "—";
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
};
const dateOrder = (value) => {
  const [year, month, day] = String(value || "").split("/").map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) : Infinity;
};

function priorityScore(project) {
  const totalWeight = Object.values(state.weights).reduce((sum, value) => sum + value, 0) || 1;
  const weighted = Object.entries(state.weights).reduce((sum, [key, weight]) => sum + project.scores[key] * weight, 0);
  return Math.round((weighted / (5 * totalWeight)) * 100);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function initSummary() {
  const { meta } = state.payload;
  $("#metric-projects").textContent = meta.project_count.toLocaleString("en-GB");
  $("#metric-candidates").textContent = state.projects.filter((p) => priorityScore(p) >= 55).length.toLocaleString("en-GB");
  $("#metric-award").textContent = compactMoney(meta.total_award);
  const [topService, topCount] = Object.entries(meta.service_counts)[0];
  $("#metric-service").textContent = topService;
  $("#metric-service-count").textContent = `${topCount.toLocaleString("en-GB")} projects contain this signal`;
  document.querySelector(".sidebar-source > strong").textContent = `${state.projects.length.toLocaleString("en-GB")} UKRI projects`;

  const serviceFilter = $("#service-filter");
  Object.keys(meta.service_counts).forEach((service) => {
    const option = document.createElement("option");
    option.value = service;
    option.textContent = service;
    serviceFilter.append(option);
  });
  const audienceFilter = $("#audience-filter");
  Object.keys(meta.audience_counts).forEach((audience) => {
    const option = document.createElement("option");
    option.value = audience;
    option.textContent = audience;
    audienceFilter.append(option);
  });
  updateShortlistCount();
}

function getFilters() {
  return {
    query: $("#search-input").value.trim().toLowerCase(),
    funder: $("#funder-filter").value,
    service: $("#service-filter").value,
    audience: $("#audience-filter").value,
    minimum: Number($("#score-filter").value),
    sort: $("#sort-select").value,
  };
}

function applyFilters() {
  const filters = getFilters();
  $("#score-value").textContent = filters.minimum;
  state.filtered = state.projects.filter((project) => {
    const score = priorityScore(project);
    const searchable = `${project.title} ${project.reference} ${project.abstract}`.toLowerCase();
    return score >= filters.minimum
      && (filters.funder === "all" || project.funder === filters.funder)
      && (filters.service === "all" || project.services.includes(filters.service))
      && (filters.audience === "all" || project.audiences.includes(filters.audience))
      && (!filters.query || searchable.includes(filters.query));
  });

  state.filtered.sort((a, b) => {
    if (filters.sort === "award") return b.award - a.award;
    if (filters.sort === "end") return dateOrder(a.end) - dateOrder(b.end) || a.title.localeCompare(b.title);
    return priorityScore(b) - priorityScore(a) || b.award - a.award;
  });
  state.page = Math.min(state.page, Math.max(1, Math.ceil(state.filtered.length / state.pageSize)));
  if (!state.filtered.some((project) => project.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || null;
  }
  renderList();
  renderDetail(state.projects.find((project) => project.id === state.selectedId));
}

function renderList() {
  const list = $("#prospect-list");
  $("#result-count").textContent = state.filtered.length.toLocaleString("en-GB");
  const start = (state.page - 1) * state.pageSize;
  const pageItems = state.filtered.slice(start, start + state.pageSize);

  if (!pageItems.length) {
    list.innerHTML = `<div class="empty-list"><strong>No projects match these filters.</strong><br>Try lowering the minimum score or broadening the search.</div>`;
  } else {
    list.innerHTML = pageItems.map((project) => {
      const score = priorityScore(project);
      const signal = project.services[0] || project.audiences[0] || "General communication signal";
      return `<button class="prospect-row ${project.id === state.selectedId ? "selected" : ""}" data-id="${project.id}" aria-pressed="${project.id === state.selectedId}">
        <span class="score-disc" style="--score:${score}"><span>${score}</span></span>
        <span class="project-main">
          <strong title="${escapeHtml(project.title)}">${escapeHtml(project.title)}</strong>
          <span class="project-meta"><span>${escapeHtml(project.reference)}</span><span>·</span><span class="signal">${escapeHtml(project.audiences[0] || "Audience not specified")}</span></span>
        </span>
        <span class="funder-chip">${escapeHtml(project.funder)}</span>
        <span class="need-cell" title="${escapeHtml(signal)}">${escapeHtml(signal)}</span>
        <span class="award-cell">Award ${compactMoney(project.award)}</span>
        <span class="date-cell">Ends ${escapeHtml(shortDate(project.end))}</span>
        <span class="row-arrow">›</span>
      </button>`;
    }).join("");
  }

  list.querySelectorAll(".prospect-row").forEach((row) => row.addEventListener("click", () => selectProject(row.dataset.id)));
  const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  $("#page-status").textContent = `Page ${state.page} of ${pages}`;
  $("#prev-page").disabled = state.page <= 1;
  $("#next-page").disabled = state.page >= pages;
}

function selectProject(id) {
  state.selectedId = id;
  const project = state.projects.find((item) => item.id === id);
  renderList();
  renderDetail(project);
  if (window.matchMedia("(max-width: 760px)").matches) {
    $("#detail-panel").scrollIntoView({ behavior: "auto", block: "start" });
  }
}

function renderDetail(project) {
  const panel = $("#detail-panel");
  if (!project) {
    panel.innerHTML = `<div class="empty-detail"><h2>No project selected</h2><p>Broaden the filters to find projects to review.</p></div>`;
    return;
  }
  const score = priorityScore(project);
  const shortlisted = state.shortlist.has(project.id);
  const tags = [...project.services, ...project.audiences];
  const outreachService = project.services[0] || "research communication support";
  const outreachAudience = project.audiences[0] || "external audiences";
  const scoreLabels = { service: "Service fit", audience: "Audience", evidence: "Co-occurrence", timing: "Timing", award: "Award scale" };
  panel.innerHTML = `
    <div class="detail-topline">
      <span class="funder-chip">${escapeHtml(project.funder)}</span>
      <div class="detail-score"><strong>${score}</strong><span>Priority<br>score</span></div>
    </div>
    <h2>${escapeHtml(project.title)}</h2>
    <div class="detail-reference">${escapeHtml(project.reference)} · ${escapeHtml(project.topics || "Unclassified")}</div>
    <div class="tag-row">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    <div class="detail-grid">
      <div class="detail-stat"><span>Recorded award</span><strong>${money(project.award)}</strong></div>
      <div class="detail-stat"><span>Project dates</span><strong>${escapeHtml(project.start)} – ${escapeHtml(project.end)}</strong></div>
    </div>
    <div class="detail-section">
      <h3>Why it surfaced</h3>
      <p class="evidence-caption">Extracts from the recorded title and abstract; longer passages are shortened.</p>
      ${(project.evidence.length ? project.evidence : ["No specific evidence sentence was extracted."]).map((text) => `<blockquote class="evidence-quote">${escapeHtml(text)}${text.length >= 500 ? "…" : ""}</blockquote>`).join("")}
      <details class="abstract-details"><summary>Read the full recorded abstract</summary><p>${escapeHtml(project.abstract || "No abstract was recorded.")}</p></details>
      <p class="outreach-angle"><strong>Question to explore:</strong> Could the team need support with ${escapeHtml(outreachService.toLowerCase())}${project.audiences.length ? ` for ${escapeHtml(outreachAudience.toLowerCase())}` : ""}? These text signals may describe separate activities. Confirm the connection and existing delivery arrangements before outreach.</p>
    </div>
    <div class="detail-section">
      <h3>Score breakdown <span class="score-scale">0–5 per criterion</span></h3>
      <div class="score-breakdown">${Object.entries(project.scores).map(([key, value]) => `<div class="score-line"><span>${scoreLabels[key]}</span><span class="score-track"><i style="width:${value * 20}%"></i></span><b>${value}</b></div>`).join("")}</div>
    </div>
    <div class="detail-actions">
      <button id="shortlist-button" class="primary-button">${shortlisted ? "Remove from shortlist" : "Add to shortlist"}</button>
      <a class="link-button" href="${escapeHtml(encodeURI(project.url))}" target="_blank" rel="noopener">Check UKRI record ↗</a>
    </div>`;
  $("#shortlist-button").addEventListener("click", () => toggleShortlist(project.id));
}

function toggleShortlist(id) {
  if (state.shortlist.has(id)) {
    state.shortlist.delete(id);
    showToast("Removed from shortlist");
  } else {
    state.shortlist.add(id);
    showToast("Added to shortlist");
  }
  saveStored("rr-shortlist", [...state.shortlist]);
  updateShortlistCount();
  if (state.selectedId === id) renderDetail(state.projects.find((project) => project.id === id));
  if ($("#shortlist-view").classList.contains("active")) renderShortlist();
}

function updateShortlistCount() {
  $("#shortlist-nav-count").textContent = state.shortlist.size;
}

function renderShortlist() {
  const view = $("#shortlist-view");
  const projects = state.projects.filter((project) => state.shortlist.has(project.id)).sort((a, b) => priorityScore(b) - priorityScore(a));
  view.innerHTML = `
    <div class="view-header">
      <div><span class="section-kicker">HUMAN REVIEW QUEUE</span><h2>Shortlisted projects</h2><p>Record a decision and a next step. Saved only in this browser, not shared with colleagues. Export a CSV to keep a copy.</p></div>
      <button id="export-shortlist" class="action-button" ${projects.length ? "" : "disabled"}>Export CSV</button>
    </div>
    <div class="view-card shortlist-table">
      ${projects.length ? `<div class="shortlist-row header"><span>Score</span><span>Project</span><span>Funder</span><span>Decision</span><span>Reviewer note</span><span></span></div>${projects.map((project) => {
        const review = state.reviews[project.id] || { status: "Unreviewed", note: "" };
        return `<div class="shortlist-row" data-shortlist-id="${project.id}">
          <span class="score-disc" style="--score:${priorityScore(project)}"><span>${priorityScore(project)}</span></span>
          <span class="shortlist-title"><strong>${escapeHtml(project.title)}</strong><span>${escapeHtml(project.reference)} · ${escapeHtml(project.services[0] || "General signal")}</span></span>
          <span class="funder-chip">${escapeHtml(project.funder)}</span>
          <select class="review-status" aria-label="Decision for ${escapeHtml(project.title)}">
            ${["Unreviewed", "Relevant", "Maybe", "Not relevant", "Contact planned"].map((status) => `<option ${review.status === status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
          <textarea class="review-note" aria-label="Reviewer note for ${escapeHtml(project.title)}" placeholder="Reason, contact angle or information to verify">${escapeHtml(review.note)}</textarea>
          <button class="icon-button remove-shortlist" title="Remove from shortlist" aria-label="Remove ${escapeHtml(project.title)}">×</button>
        </div>`;
      }).join("")}` : `<div class="empty-card"><div><strong>No projects shortlisted yet</strong><p>Return to Opportunities and add projects whose evidence is worth checking.</p></div></div>`}
    </div>`;

  view.querySelectorAll("[data-shortlist-id]").forEach((row) => {
    const id = row.dataset.shortlistId;
    const saveReview = () => {
      state.reviews[id] = { status: row.querySelector(".review-status").value, note: row.querySelector(".review-note").value.trim() };
      saveStored("rr-reviews", state.reviews);
    };
    row.querySelector(".review-status").addEventListener("change", saveReview);
    row.querySelector(".review-note").addEventListener("input", saveReview);
    row.querySelector(".remove-shortlist").addEventListener("click", () => toggleShortlist(id));
  });
  const exportButton = $("#export-shortlist");
  if (exportButton) exportButton.addEventListener("click", exportShortlist);
}

function exportShortlist() {
  const fields = ["priority_score", "decision", "reviewer_note", "grant_reference", "title", "funder", "award_pounds", "start_date", "end_date", "service_signals", "target_audiences", "evidence", "gtr_url", "snapshot_date", "relative_weights"];
  const csvEscape = (value) => {
    const text = String(value ?? "");
    const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = state.projects.filter((project) => state.shortlist.has(project.id)).map((project) => {
    const review = state.reviews[project.id] || { status: "Unreviewed", note: "" };
    return [priorityScore(project), review.status, review.note, project.reference, project.title, project.funder, project.award, project.start, project.end, project.services.join("; "), project.audiences.join("; "), project.evidence.join(" | "), project.url, state.payload.meta.snapshot_date, JSON.stringify(state.weights)];
  });
  const blob = new Blob([[fields.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "research-retold-prospect-shortlist.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast(`Exported ${rows.length} shortlisted projects`);
}

const weightDefinitions = {
  service: ["Service fit", "Specific communication outputs or support formats named in the project text."],
  audience: ["External audience", "Policymakers, communities, practitioners, industry, NGOs or media are named."],
  evidence: ["Signal co-occurrence", "Service, audience and general communication terms occur in the same record; this does not prove a delivery need."],
  timing: ["Project timing", "Project end date relative to the fixed July 2026 data snapshot."],
  award: ["Award scale", "Recorded total project award; this is not a communication budget."],
};

function renderWeighting() {
  const view = $("#weighting-view");
  const top = [...state.projects].sort((a, b) => priorityScore(b) - priorityScore(a) || b.award - a.award).slice(0, 6);
  view.innerHTML = `
    <div class="view-header"><div><span class="section-kicker">TRANSPARENT PRIORITISATION</span><h2>Scoring model</h2><p>Adjust the relative importance of each criterion. This is a review priority, not a purchase probability.</p></div></div>
    <div class="weight-layout">
      <section class="view-card weight-editor">
        <p>Each component runs from 0 to 5. Sliders set relative weight units (0–50); the percentage beside each slider shows its share of the total.</p>
        ${Object.entries(weightDefinitions).map(([key, [title, description]]) => `<div class="weight-row">
          <div class="weight-copy"><strong>${title}</strong><span>${description}</span></div>
          <input class="weight-slider" aria-label="Relative weight for ${title}" data-weight="${key}" type="range" min="0" max="50" step="5" value="${state.weights[key]}">
          <span class="weight-value" id="weight-value-${key}"></span>
        </div>`).join("")}
        <div class="weight-footer"><span class="weight-total">Relative weights are normalised automatically.</span><button id="reset-weights" class="secondary-button">Restore defaults</button></div>
      </section>
      <aside class="view-card ranking-preview"><h3>Current top projects</h3><p>Use this list to sense-check how the ranking responds.</p><div id="ranking-items">${renderRankingItems(top)}</div></aside>
    </div>`;

  view.querySelectorAll(".weight-slider").forEach((slider) => slider.addEventListener("input", () => {
    const key = slider.dataset.weight;
    const previous = state.weights[key];
    state.weights[key] = Number(slider.value);
    if (!Object.values(state.weights).some((value) => value > 0)) {
      state.weights[key] = previous;
      slider.value = previous;
      showToast("Keep at least one weight above zero.");
      return;
    }
    updateWeightLabels();
    saveStored("rr-weights", state.weights);
    refreshAfterWeightChange();
  }));
  $("#reset-weights").addEventListener("click", () => {
    state.weights = { ...state.payload.meta.default_weights };
    saveStored("rr-weights", state.weights);
    renderWeighting();
    refreshAfterWeightChange();
  });
  updateWeightLabels();
}

function updateWeightLabels() {
  const total = Object.values(state.weights).reduce((sum, value) => sum + value, 0);
  Object.entries(state.weights).forEach(([key, value]) => {
    const share = `${(100 * value / total).toFixed(1)}%`;
    $(`#weight-value-${key}`).textContent = share;
    $(`[data-weight="${key}"]`).setAttribute("aria-valuetext", `${value} relative units, ${share} of total`);
  });
}

function renderRankingItems(projects) {
  return projects.map((project, index) => `<div class="ranked-item"><span class="rank-number">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(project.title)}</strong><span>${escapeHtml(project.funder)} · ${escapeHtml(project.services[0] || "General signal")}</span></span><span class="rank-score">${priorityScore(project)}</span></div>`).join("");
}

function refreshAfterWeightChange() {
  const top = [...state.projects].sort((a, b) => priorityScore(b) - priorityScore(a) || b.award - a.award).slice(0, 6);
  const ranking = $("#ranking-items");
  if (ranking) ranking.innerHTML = renderRankingItems(top);
  $("#metric-candidates").textContent = state.projects.filter((project) => priorityScore(project) >= 55).length.toLocaleString("en-GB");
  applyFilters();
  if (state.selectedId) renderDetail(state.projects.find((project) => project.id === state.selectedId));
}

function renderEvidence() {
  $("#evidence-view").innerHTML = `
    <div class="view-header"><div><span class="section-kicker">DECISION CONTEXT</span><h2>Method and limitations</h2><p>The workspace converts public project text into a review queue. The final business judgement remains human.</p></div></div>
    <div class="evidence-layout">
      <article class="view-card evidence-card"><h3>What this workspace helps you do</h3><p>Find public research projects whose descriptions mention communication activities, review the supporting text, and keep a shortlist for further investigation.</p><ul><li>Search 2,259 projects recorded as active on 21 July 2026.</li><li>Filter service and audience signals across AHRC, ESRC and Innovate UK.</li><li>Adjust review priorities and retain your decisions and notes.</li><li>Export a shortlist before verifying contacts and planning outreach.</li></ul></article>
      <article class="view-card evidence-card"><h3>How projects are prioritised</h3><p>This version uses predefined keyword and phrase rules in project titles and abstracts. It is a rule-based prototype, not a trained prediction model.</p><p>Five 0–5 components are combined using relative weights: service signals (35%), audiences (25%), signal co-occurrence (20%), timing (10%) and award scale (10%) by default.</p><p><strong>Score = weighted average of the five components × 20.</strong> Scores are rounded to whole numbers. A score of 55 is a starting review threshold, not a validated sales cutoff.</p><details class="method-details"><summary>See component scoring rules</summary><ul><li><strong>Service:</strong> one, two or three-plus service categories score 3, 4 or 5. With no service category, one or two-plus general communication terms score 1 or 2; no match scores 0.</li><li><strong>Audience:</strong> one, two or three-plus audience categories score 3, 4 or 5; none scores 0.</li><li><strong>Co-occurrence:</strong> service + audience + two-plus general term patterns score 5; service + audience score 4; two-plus services, or service + two-plus general patterns, score 3; any service or audience scores 2; a general term alone scores 1; none scores 0.</li><li><strong>Timing:</strong> an end month 0–12 months after July 2026 scores 5; 13–24 scores 4; 25–48 scores 3; later, or up to 12 months earlier, scores 2. Earlier or missing dates score 1. This is a heuristic, not a verified buying window.</li><li><strong>Award:</strong> £2m+ scores 5; £1m+ scores 4; £500k+ scores 3; £100k+ scores 2; a smaller positive award scores 1; zero scores 0.</li></ul></details></article>
      <article class="view-card evidence-card"><h3>Why a text match needs review</h3><p>For example, a project might mention a policy brief and policymakers. That is a useful reason to inspect its dissemination plans, but it does not establish an unmet need for an external supplier.</p><p>The same text could describe an output already delivered, a partner’s responsibility, or an internal team’s work. A workshop may be part of the research itself. Relevant projects may also be missed when they use different wording or have short abstracts.</p><p>Service tags group text signals; they are not confirmed requests or a definitive catalogue of Research Retold’s services. Longer descriptions have more chances to match the rules.</p></article>
      <article class="view-card evidence-card"><h3>Before contacting a project team</h3><div class="limit-list"><div class="limit-item"><b>1</b><div><strong>Read the evidence in context</strong><span>Open the full abstract and confirm the activity, audience and potential fit.</span></div></div><div class="limit-item"><b>2</b><div><strong>Verify the live position</strong><span>Check project dates, output status, existing suppliers and available budget. Total project funding is not a communication budget.</span></div></div><div class="limit-item"><b>3</b><div><strong>Confirm a suitable contact</strong><span>Use the current UKRI record and organisation website to identify the right team. Record the next step in the shortlist; no messages are sent by this workspace.</span></div></div></div></article>
      <article class="view-card evidence-card"><h3>Data coverage and practical limits</h3><ul><li>This is a fixed extract, not a live UKRI feed or the whole UK research market.</li><li>Project status and timing scores refer to July 2026 and do not refresh automatically.</li><li>Lead organisation, region and investigator are missing from this extract. Yorkshire-based targeting is not yet supported.</li><li>Shortlists, notes and weights stay in this browser. They are not synchronised between devices or colleagues and can be lost if browser storage is cleared.</li></ul></article>
      <article class="view-card evidence-card"><h3>What to validate with Research Retold</h3><ul><li>Review high-, medium- and low-scoring projects to check both useful matches and missed opportunities.</li><li>Confirm which signals correspond to services the team wants to offer.</li><li>Agree practical weights and a review threshold after inspecting examples.</li><li>Track outreach and outcomes outside this prototype to assess whether the ranking improves prospecting. No conversion performance has been validated yet.</li></ul></article>
    </div>`;
}

function changeView(viewName) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.view === viewName;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  $(`#${viewName}-view`).classList.add("active");
  const headings = {
    prospects: ["Project opportunities", "Find communication signals. Review the evidence. Build your shortlist."],
    shortlist: ["Shortlist", "Qualify projects and capture the next action."],
    weighting: ["Scoring model", "Tune the criteria used to order the review queue."],
    evidence: ["Method & limits", "Understand what the score can and cannot tell you."],
  };
  $("#page-title").textContent = headings[viewName][0];
  $("#page-description").textContent = headings[viewName][1];
  if (viewName === "shortlist") renderShortlist();
  if (viewName === "weighting") renderWeighting();
  if (viewName === "evidence") renderEvidence();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function bindControls() {
  ["#search-input", "#funder-filter", "#service-filter", "#audience-filter", "#score-filter", "#sort-select"].forEach((selector) => {
    $(selector).addEventListener(selector.includes("search") ? "input" : "change", () => { state.page = 1; applyFilters(); });
  });
  $("#score-filter").addEventListener("input", () => { state.page = 1; applyFilters(); });
  $("#reset-filters").addEventListener("click", () => {
    $("#search-input").value = "";
    $("#funder-filter").value = "all";
    $("#service-filter").value = "all";
    $("#audience-filter").value = "all";
    $("#score-filter").value = 55;
    $("#sort-select").value = "score";
    state.page = 1;
    applyFilters();
  });
  $("#prev-page").addEventListener("click", () => { if (state.page > 1) { state.page--; renderList(); } });
  $("#next-page").addEventListener("click", () => { if (state.page * state.pageSize < state.filtered.length) { state.page++; renderList(); } });
  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => changeView(item.dataset.view)));
}

async function start() {
  try {
    const response = await fetch("data/projects.json");
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    state.payload = await response.json();
    state.projects = state.payload.projects;
    if (state.projects.length !== state.payload.meta.project_count) {
      throw new Error(`Loaded ${state.projects.length} projects; expected ${state.payload.meta.project_count}.`);
    }
    const savedWeights = readStored("rr-weights", {}, isRecord);
    state.weights = { ...state.payload.meta.default_weights };
    Object.keys(state.weights).forEach((key) => {
      const value = savedWeights[key];
      if (Number.isFinite(value) && value >= 0 && value <= 50 && value % 5 === 0) state.weights[key] = value;
    });
    if (!Object.values(state.weights).some((value) => value > 0)) state.weights = { ...state.payload.meta.default_weights };
    initSummary();
    bindControls();
    applyFilters();
    $(".source-status span").textContent = "Snapshot loaded";
  } catch (error) {
    $("#prospect-list").innerHTML = `<div class="empty-list"><strong>Project data could not be loaded.</strong><br>${escapeHtml(error.message)}</div>`;
    $(".source-status span").textContent = "Snapshot unavailable";
    $("#next-page").disabled = true;
  }
}

start();
