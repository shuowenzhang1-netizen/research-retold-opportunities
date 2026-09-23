const state = {
  payload: null,
  projects: [],
  filtered: [],
  selectedId: null,
  page: 1,
  pageSize: 10,
  weights: { service: 35, audience: 25, evidence: 20, timing: 10, award: 10 },
  shortlist: new Set(JSON.parse(localStorage.getItem("rr-shortlist") || "[]")),
  reviews: JSON.parse(localStorage.getItem("rr-reviews") || "{}"),
};

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
const compactMoney = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", notation: "compact", maximumFractionDigits: 1 }).format(value);
const shortDate = (value) => {
  const [year, month, day] = String(value || "").split("/").map(Number);
  if (!year || !month || !day) return value || "—";
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
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
  $("#metric-candidates").textContent = meta.candidate_count.toLocaleString("en-GB");
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
    if (filters.sort === "end") return String(a.end).localeCompare(String(b.end));
    return priorityScore(b) - priorityScore(a) || b.award - a.award;
  });
  state.page = Math.min(state.page, Math.max(1, Math.ceil(state.filtered.length / state.pageSize)));
  renderList();
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
      return `<button class="prospect-row ${project.id === state.selectedId ? "selected" : ""}" data-id="${project.id}">
        <span class="score-disc" style="--score:${score}"><span>${score}</span></span>
        <span class="project-main">
          <strong title="${escapeHtml(project.title)}">${escapeHtml(project.title)}</strong>
          <span class="project-meta"><span>${escapeHtml(project.reference)}</span><span>·</span><span class="signal">${escapeHtml(project.audiences[0] || "Audience not specified")}</span></span>
        </span>
        <span class="funder-chip">${escapeHtml(project.funder)}</span>
        <span class="need-cell" title="${escapeHtml(signal)}">${escapeHtml(signal)}</span>
        <span class="award-cell">${compactMoney(project.award)}</span>
        <span class="date-cell">${escapeHtml(shortDate(project.end))}</span>
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
}

function renderDetail(project) {
  const panel = $("#detail-panel");
  if (!project) return;
  const score = priorityScore(project);
  const shortlisted = state.shortlist.has(project.id);
  const tags = [...project.services, ...project.audiences].slice(0, 6);
  const outreachService = project.services[0] || "research communication support";
  const outreachAudience = project.audiences[0] || "external audiences";
  const scoreLabels = { service: "Service fit", audience: "Audience", evidence: "Evidence", timing: "Timing", award: "Award scale" };
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
      ${(project.evidence.length ? project.evidence : ["No specific evidence sentence was extracted."]).map((text) => `<blockquote class="evidence-quote">${escapeHtml(text)}</blockquote>`).join("")}
      <p class="outreach-angle"><strong>Possible opening:</strong> The project mentions ${escapeHtml(outreachService.toLowerCase())} for ${escapeHtml(outreachAudience.toLowerCase())}. Check whether delivery support is already in place before outreach.</p>
    </div>
    <div class="detail-section">
      <h3>Score breakdown</h3>
      <div class="score-breakdown">${Object.entries(project.scores).map(([key, value]) => `<div class="score-line"><span>${scoreLabels[key]}</span><span class="score-track"><i style="width:${value * 20}%"></i></span><b>${value}</b></div>`).join("")}</div>
    </div>
    <div class="detail-actions">
      <button id="shortlist-button" class="primary-button">${shortlisted ? "Remove from shortlist" : "Add to shortlist"}</button>
      <a class="link-button" href="${encodeURI(project.url)}" target="_blank" rel="noopener">GtR ↗</a>
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
  localStorage.setItem("rr-shortlist", JSON.stringify([...state.shortlist]));
  updateShortlistCount();
  renderDetail(state.projects.find((project) => project.id === id));
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
      <div><span class="section-kicker">HUMAN REVIEW QUEUE</span><h2>Shortlisted projects</h2><p>Record a decision and a contact note for each project. Changes stay in this browser.</p></div>
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
          <textarea class="review-note" placeholder="Reason, contact angle or information to verify">${escapeHtml(review.note)}</textarea>
          <button class="icon-button remove-shortlist" title="Remove from shortlist" aria-label="Remove ${escapeHtml(project.title)}">×</button>
        </div>`;
      }).join("")}` : `<div class="empty-card"><div><strong>No projects shortlisted yet</strong><p>Return to Prospects and add projects whose evidence is worth checking.</p></div></div>`}
    </div>`;

  view.querySelectorAll("[data-shortlist-id]").forEach((row) => {
    const id = row.dataset.shortlistId;
    const saveReview = () => {
      state.reviews[id] = { status: row.querySelector(".review-status").value, note: row.querySelector(".review-note").value.trim() };
      localStorage.setItem("rr-reviews", JSON.stringify(state.reviews));
    };
    row.querySelector(".review-status").addEventListener("change", saveReview);
    row.querySelector(".review-note").addEventListener("input", saveReview);
    row.querySelector(".remove-shortlist").addEventListener("click", () => toggleShortlist(id));
  });
  const exportButton = $("#export-shortlist");
  if (exportButton) exportButton.addEventListener("click", exportShortlist);
}

function exportShortlist() {
  const fields = ["priority_score", "decision", "reviewer_note", "grant_reference", "title", "funder", "award_pounds", "start_date", "end_date", "service_signals", "target_audiences", "evidence", "gtr_url"];
  const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = state.projects.filter((project) => state.shortlist.has(project.id)).map((project) => {
    const review = state.reviews[project.id] || { status: "Unreviewed", note: "" };
    return [priorityScore(project), review.status, review.note, project.reference, project.title, project.funder, project.award, project.start, project.end, project.services.join("; "), project.audiences.join("; "), project.evidence.join(" | "), project.url];
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
  evidence: ["Evidence strength", "Several distinct, explicit signals appear together in the abstract."],
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
        <p>The five component scores run from 0 to 5. Weight changes recalculate every project immediately.</p>
        ${Object.entries(weightDefinitions).map(([key, [title, description]]) => `<div class="weight-row">
          <div class="weight-copy"><strong>${title}</strong><span>${description}</span></div>
          <input class="weight-slider" data-weight="${key}" type="range" min="0" max="50" step="5" value="${state.weights[key]}">
          <span class="weight-value" id="weight-value-${key}">${state.weights[key]}%</span>
        </div>`).join("")}
        <div class="weight-footer"><span class="weight-total">Relative weights are normalised automatically.</span><button id="reset-weights" class="secondary-button">Restore defaults</button></div>
      <aside class="view-card ranking-preview"><h3>Current top prospects</h3><p>Use this list to sense-check how the ranking responds.</p><div id="ranking-items">${renderRankingItems(top)}</div></aside>
    </div>`;

  view.querySelectorAll(".weight-slider").forEach((slider) => slider.addEventListener("input", () => {
    state.weights[slider.dataset.weight] = Number(slider.value);
    $(`#weight-value-${slider.dataset.weight}`).textContent = `${slider.value}%`;
    localStorage.setItem("rr-weights", JSON.stringify(state.weights));
    refreshAfterWeightChange();
  }));
  $("#reset-weights").addEventListener("click", () => {
    state.weights = { ...state.payload.meta.default_weights };
    localStorage.setItem("rr-weights", JSON.stringify(state.weights));
    renderWeighting();
    refreshAfterWeightChange();
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
      <article class="view-card evidence-card"><h3>What the client asked for</h3><p>The first meeting focused on identifying projects that could become potential clients, ranking them, and retaining the project's own language for personalised outreach.</p><ul><li>Reduce manual browsing of Gateway to Research.</li><li>Prioritise projects using business-relevant criteria.</li><li>Show the passage that triggered the recommendation.</li><li>Track human decisions and later outreach outcomes.</li></ul></article>
      <article class="view-card evidence-card"><h3>How to interpret the score</h3><p>A higher score means that more of the selected signals are visible in the public record. It is a configurable review priority, not a probability of becoming a client.</p><div class="limit-list"><div class="limit-item"><b>1</b><div><strong>Inspect the evidence</strong><span>Confirm that the words describe a genuine communication activity.</span></div></div><div class="limit-item"><b>2</b><div><strong>Check delivery status</strong><span>The project may already have a supplier or internal team.</span></div></div><div class="limit-item"><b>3</b><div><strong>Research the contact</strong><span>Organisation and investigator fields require a new data extraction.</span></div></div></div></article>
      <article class="view-card evidence-card wide"><h3>Why several retrieval methods are needed</h3><p>The dissertation's cancer check is retained here as a quality-control example. Model membership and keyword matching produced overlapping but different candidate sets, so every shortlist needs project-level review.</p><div class="method-strip"><div class="method-stat"><strong>18</strong><span>Projects in the shared model core</span></div><div class="method-stat"><strong>58</strong><span>NMF extension projects</span></div><div class="method-stat"><strong>43</strong><span>Extensions without cancer vocabulary</span></div><div class="method-stat"><strong>18</strong><span>Keyword projects outside the model union</span></div></div></article>
      <article class="view-card evidence-card"><h3>Current data gaps</h3><ul><li>Lead organisation, region and investigator are not populated in the frozen extract.</li><li>Location cannot yet support the Yorkshire preference discussed in the meeting.</li><li>Project status is the status recorded in the July 2026 snapshot.</li><li>Award value is the total project award, not a communication budget.</li></ul></article>
      <article class="view-card evidence-card"><h3>Client validation for the next version</h3><ul><li>Review a sample of high, medium and low priority projects.</li><li>Confirm which services and audiences indicate a real opportunity.</li><li>Set the weights used for day-to-day outreach.</li><li>Record contact, response and conversion outcomes to improve ranking.</li></ul></article>
    </div>`;
}

function changeView(viewName) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
  $(`#${viewName}-view`).classList.add("active");
  const headings = {
    prospects: ["Project opportunities", "Review active projects with visible communication needs."],
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
    state.weights = { ...state.payload.meta.default_weights, ...JSON.parse(localStorage.getItem("rr-weights") || "{}") };
    initSummary();
    bindControls();
    applyFilters();
    if (state.filtered[0]) selectProject(state.filtered[0].id);
  } catch (error) {
    $("#prospect-list").innerHTML = `<div class="empty-list"><strong>Project data could not be loaded.</strong><br>${escapeHtml(error.message)}</div>`;
  }
}

start();
