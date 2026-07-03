const state = {
  activeTab: "schedule",
  activeCalculator: null,
  favoriteCalculators: [],
  scheduleLayout: [],
  scheduleDisplay: { weekend: true, notes: true },
  authToken: localStorage.getItem("authToken") || "",
  currentUser: null,
  guestMode: localStorage.getItem("guestMode") === "true",
  syncHandle: null,
  data: null,
  emptySchedule: [],
  patients: [],
  roundHistory: [],
  rotaTemplates: [],
  selectedPatientId: null,
  editingPatientId: null,
  roundStartedAt: null,
  roundElapsedMs: 0,
  timerHandle: null,
  saveIndicatorHandle: null,
  wizard: {
    index: 0,
    patient: null,
  },
};

const $ = (id) => document.getElementById(id);

const defaults = {
  males: "",
  females: "",
  helpers: "",
  familyResidents: "",
  extraWeekday: "",
};

const patientQuestions = [
  { key: "mrn", label: "MRN" },
  { key: "name", label: "Name" },
  { key: "location", label: "Location / room" },
  { key: "admissionCause", label: "Admission cause" },
  { key: "summary", label: "Summary" },
  { key: "activeIssue", label: "Active issue" },
];

const defaultFavoriteCalculators = ["abg", "crcl", "gfr"];

const defaultScheduleLayout = [
  { id: "ward", label: "Ward", time: "4PM-8AM", source: "ward", weekday: true, weekend: false },
  { id: "fAfternoon", label: "F Area", time: "4PM-12AM", source: "fAfternoon", weekday: true, weekend: true },
  { id: "mAfternoon", label: "M Area", time: "4PM-12AM", source: "mAfternoon", weekday: true, weekend: true },
  { id: "mNight", label: "M Area Night", time: "12AM-8AM", source: "mNight", weekday: true, weekend: true },
  { id: "fNight", label: "F Area Night", time: "12AM-8AM", source: "fNight", weekday: true, weekend: true },
];

const defaultScheduleDisplay = {
  weekend: true,
  notes: true,
};

const layoutSources = [
  ["ward", "Ward / service cover"],
  ["fAfternoon", "Auto resident 1"],
  ["mAfternoon", "Auto resident 2"],
  ["mNight", "Auto resident 3"],
  ["fNight", "Auto resident 4"],
  ["blank", "Blank custom column"],
];

function initDefaults() {
  $("rotaName").value = "";
  $("startDate").value = "";
  $("endDate").value = "";
  $("males").value = defaults.males;
  $("females").value = defaults.females;
  $("helpers").value = defaults.helpers;
  $("familyResidents").value = defaults.familyResidents;
  $("extraWeekday").value = defaults.extraWeekday;
  $("requests").innerHTML = "";
  resetScheduleLayout(false);
  resetScheduleDisplay(false);
}

function addRequest(data = {}) {
  const template = $("requestTemplate").content.cloneNode(true);
  const row = template.querySelector(".request-row");
  row.querySelector(".req-name").value = data.name || "";
  row.querySelector(".req-dates").value = data.avoidDates || "";
  row.querySelector(".req-shifts").value = Array.isArray(data.avoidShifts)
    ? data.avoidShifts.map((rule) => `${rule.date} ${rule.shift}`).join("\n")
    : data.avoidShifts || "";
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  $("requests").append(row);
}

function parseShiftRules(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, ...rest] = line.split(/\s+/);
      const shift = rest.join(" ").toLowerCase().includes("night") ? "Night" : "Afternoon";
      return { date, shift };
    });
}

function collectConfig() {
  const requests = [...document.querySelectorAll(".request-row")].map((row) => ({
    name: row.querySelector(".req-name").value,
    avoidDates: row.querySelector(".req-dates").value,
    avoidShifts: parseShiftRules(row.querySelector(".req-shifts").value),
  }));
  return {
    rotaName: $("rotaName").value,
    startDate: $("startDate").value,
    endDate: $("endDate").value,
    males: $("males").value,
    females: $("females").value,
    helpers: $("helpers").value,
    familyResidents: $("familyResidents").value,
    extraWeekday: $("extraWeekday").value,
    weekendDays: ["Fri", "Sat"],
    useTemplateMemory: true,
    scheduleLayout: state.scheduleLayout,
    scheduleDisplay: state.scheduleDisplay,
    requests,
  };
}

function collectTemplate() {
  const requests = [...document.querySelectorAll(".request-row")].map((row) => ({
    name: row.querySelector(".req-name").value,
    avoidDates: row.querySelector(".req-dates").value,
    avoidShifts: row.querySelector(".req-shifts").value,
  }));
  return {
    rotaName: $("rotaName").value,
    startDate: $("startDate").value,
    endDate: $("endDate").value,
    males: $("males").value,
    females: $("females").value,
    helpers: $("helpers").value,
    familyResidents: $("familyResidents").value,
    extraWeekday: $("extraWeekday").value,
    scheduleLayout: state.scheduleLayout,
    scheduleDisplay: state.scheduleDisplay,
    requests,
  };
}

function applyTemplate(template) {
  $("rotaName").value = template.rotaName || "";
  $("startDate").value = template.startDate || "";
  $("endDate").value = template.endDate || "";
  $("males").value = template.males || "";
  $("females").value = template.females || "";
  $("helpers").value = template.helpers || "";
  $("familyResidents").value = template.familyResidents || "";
  $("extraWeekday").value = template.extraWeekday || "";
  state.scheduleLayout = normalizeScheduleLayout(template.scheduleLayout);
  state.scheduleDisplay = normalizeScheduleDisplay(template.scheduleDisplay);
  renderScheduleDisplayControls();
  renderLayoutEditor();
  $("requests").innerHTML = "";
  (template.requests || []).forEach(addRequest);
}

function hasSavedAppData(appData = {}) {
  return Object.keys(appData || {}).some((key) => {
    const value = appData[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
  });
}

function loadRotaTemplates() {
  try {
    state.rotaTemplates = JSON.parse(localStorage.getItem("rotaTemplates") || "[]");
  } catch {
    state.rotaTemplates = [];
  }
  renderTemplateSelect();
}

function saveRotaTemplates() {
  localStorage.setItem("rotaTemplates", JSON.stringify(state.rotaTemplates));
  renderTemplateSelect();
  syncUserData();
}

function renderTemplateSelect() {
  const select = $("templateSelect");
  if (!state.rotaTemplates.length) {
    select.innerHTML = `<option value="">No saved templates</option>`;
    return;
  }
  select.innerHTML = state.rotaTemplates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`)
    .join("");
}

function saveCurrentTemplate() {
  const name = ($("rotaName").value || "Rota template").trim();
  const existing = state.rotaTemplates.find((template) => template.name.toLowerCase() === name.toLowerCase());
  const template = {
    id: existing?.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name,
    savedAt: new Date().toISOString(),
    data: collectTemplate(),
  };
  if (existing) {
    Object.assign(existing, template);
  } else {
    state.rotaTemplates.unshift(template);
  }
  saveRotaTemplates();
  $("templateSelect").value = template.id;
  $("statusText").textContent = `${name} template saved.`;
}

function selectedTemplate() {
  return state.rotaTemplates.find((template) => template.id === $("templateSelect").value);
}

function loadSelectedTemplate() {
  const template = selectedTemplate();
  if (!template) return;
  applyTemplate(template.data);
  $("statusText").textContent = `${template.name} template loaded.`;
  refreshEmpty();
}

function deleteSelectedTemplate() {
  const template = selectedTemplate();
  if (!template || !confirm(`Delete ${template.name} template?`)) return;
  state.rotaTemplates = state.rotaTemplates.filter((item) => item.id !== template.id);
  saveRotaTemplates();
  $("statusText").textContent = `${template.name} template deleted.`;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || "Request failed");
  }
  return response.json();
}

async function getJson(url) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || "Request failed");
  }
  return response.json();
}

function authHeaders() {
  return state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {};
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3200);
}

function setAuthMessage(message, type = "") {
  $("authMessage").textContent = message;
  $("authMessage").className = `auth-message ${type}`;
}

function collectUserData() {
  return {
    residentRoundsPatients: JSON.parse(localStorage.getItem("residentRoundsPatients") || "[]"),
    residentRoundsHistory: JSON.parse(localStorage.getItem("residentRoundsHistory") || "[]"),
    residentRoundsElapsedMs: localStorage.getItem("residentRoundsElapsedMs") || "0",
    rotaTemplates: JSON.parse(localStorage.getItem("rotaTemplates") || "[]"),
    calculatorFavorites: JSON.parse(localStorage.getItem("calculatorFavorites") || "[]"),
    scheduleLayout: state.scheduleLayout,
    scheduleDisplay: state.scheduleDisplay,
  };
}

function applyUserData(appData = {}) {
  localStorage.setItem("residentRoundsPatients", JSON.stringify(appData.residentRoundsPatients || []));
  localStorage.setItem("residentRoundsHistory", JSON.stringify(appData.residentRoundsHistory || []));
  localStorage.setItem("residentRoundsElapsedMs", String(appData.residentRoundsElapsedMs || "0"));
  localStorage.setItem("rotaTemplates", JSON.stringify(appData.rotaTemplates || []));
  localStorage.setItem("calculatorFavorites", JSON.stringify(appData.calculatorFavorites || defaultFavoriteCalculators));
  state.scheduleLayout = normalizeScheduleLayout(appData.scheduleLayout);
  state.scheduleDisplay = normalizeScheduleDisplay(appData.scheduleDisplay);
  renderScheduleDisplayControls();
  renderLayoutEditor();
  loadRotaTemplates();
  loadCalculatorFavorites();
  loadRounds();
}

function syncUserData() {
  if (state.guestMode || !state.authToken || !state.currentUser) return;
  if (state.syncHandle) clearTimeout(state.syncHandle);
  state.syncHandle = setTimeout(() => {
    postJson("/api/save-data", { appData: collectUserData() }).catch(() => {});
  }, 700);
}

function showLoggedInApp() {
  $("loginView").classList.add("hidden");
  $("homeView").classList.remove("hidden");
  $("adminToolCard").classList.toggle("hidden", state.currentUser?.role !== "admin");
}

async function guestLogin() {
  try {
    const data = await postJson("/api/guest-login", {});
    state.guestMode = true;
    state.currentUser = data.user;
    state.authToken = data.token;
    localStorage.setItem("authToken", data.token);
    localStorage.setItem("guestMode", "true");
    if (hasSavedAppData(data.appData)) applyUserData(data.appData);
    showLoggedInApp();
    showToast("Guest mode: work stays on this device only.");
  } catch (error) {
    setAuthMessage(error.message, "error");
  }
}

async function login() {
  setAuthMessage("");
  try {
    const data = await postJson("/api/login", {
      username: $("authUsername").value,
      password: $("authPassword").value,
    });
    state.authToken = data.token;
    state.currentUser = data.user;
    state.guestMode = false;
    localStorage.setItem("authToken", data.token);
    localStorage.removeItem("guestMode");
    applyUserData(data.appData);
    showLoggedInApp();
    showToast(`Welcome ${data.user.username}`);
  } catch (error) {
    setAuthMessage(error.message, "error");
  }
}

async function signup() {
  setAuthMessage("");
  try {
    const data = await postJson("/api/signup", {
      username: $("authUsername").value,
      password: $("authPassword").value,
    });
    setAuthMessage(data.message || "Request has been sent. Please contact Dr Othman.", "success");
    showToast("Request has been sent. Please contact Dr Othman.");
  } catch (error) {
    setAuthMessage(error.message, "error");
  }
}

async function restoreSession() {
  if (state.guestMode) {
    try {
      const data = await getJson("/api/me");
      state.currentUser = data.user;
      showLoggedInApp();
    } catch {
      await guestLogin();
    }
    return;
  }
  if (!state.authToken) return;
  try {
    const data = await getJson("/api/me");
    state.currentUser = data.user;
    applyUserData(data.appData);
    showLoggedInApp();
  } catch {
    localStorage.removeItem("authToken");
    state.authToken = "";
  }
}

function logout() {
  localStorage.removeItem("authToken");
  localStorage.removeItem("guestMode");
  state.authToken = "";
  state.currentUser = null;
  state.guestMode = false;
  document.querySelectorAll(".app-view, .home-view").forEach((view) => view.classList.add("hidden"));
  $("loginView").classList.remove("hidden");
}

function render() {
  if (state.activeTab === "schedule") return renderSchedule();
  if (state.activeTab === "referral") return renderReferral();
  if (state.activeTab === "workload") return renderWorkload();
  return renderChecks();
}

function openView(viewId) {
  document.querySelectorAll(".app-view, .home-view").forEach((view) => view.classList.add("hidden"));
  $(viewId).classList.remove("hidden");
  if (viewId === "roundsView") renderRounds();
  if (viewId === "calculatorView") {
    state.activeCalculator = null;
    renderCalculator();
  }
  if (viewId === "adminView") renderAdminUsers();
  if (viewId === "schedulerView") render();
}

function setHtml(html) {
  $("sheetWrap").innerHTML = html;
}

function normalizeScheduleLayout(layout) {
  const sourceIds = new Set(layoutSources.map(([id]) => id));
  const rows = Array.isArray(layout) && layout.length ? layout : defaultScheduleLayout;
  return rows.map((item, index) => ({
    id: item.id || `custom${index}`,
    label: item.label || "Shift",
    time: item.time || "",
    source: sourceIds.has(item.source) ? item.source : "blank",
    weekday: item.weekday !== false,
    weekend: item.weekend !== false,
  }));
}

function normalizeScheduleDisplay(display) {
  return {
    weekend: display?.weekend !== false,
    notes: display?.notes !== false,
  };
}

function resetScheduleDisplay(renderNow = true) {
  state.scheduleDisplay = { ...defaultScheduleDisplay };
  if (renderNow) {
    renderScheduleDisplayControls();
    render();
    syncUserData();
  }
}

function resetScheduleLayout(renderNow = true) {
  state.scheduleLayout = defaultScheduleLayout.map((item) => ({ ...item }));
  state.scheduleDisplay = { ...defaultScheduleDisplay };
  if (renderNow) {
    renderScheduleDisplayControls();
    renderLayoutEditor();
    render();
    syncUserData();
  }
}

function addLayoutShift() {
  state.scheduleLayout.push({
    id: `custom${Date.now()}`,
    label: "New Shift",
    time: "12 hours",
    source: "blank",
    weekday: true,
    weekend: true,
  });
  renderLayoutEditor();
  render();
  syncUserData();
}

window.residentToolsAddLayoutShift = addLayoutShift;

function renderLayoutEditor() {
  const wrap = $("layoutRows");
  if (!wrap) return;
  wrap.innerHTML = state.scheduleLayout.map((item, index) => `
    <div class="layout-row" data-layout-index="${index}">
      <input class="layout-label" value="${escapeHtml(item.label)}" aria-label="Shift label" />
      <input class="layout-time" value="${escapeHtml(item.time)}" aria-label="Shift time" />
      <select class="layout-source" aria-label="Source assignment">
        ${layoutSources.map(([value, label]) => `<option value="${value}" ${item.source === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
      <label class="mini-check"><input class="layout-weekday" type="checkbox" ${item.weekday ? "checked" : ""} />Weekday</label>
      <label class="mini-check"><input class="layout-weekend" type="checkbox" ${item.weekend ? "checked" : ""} />Weekend</label>
      <button class="remove layout-remove" type="button">Remove</button>
    </div>
  `).join("");
  wrap.querySelectorAll(".layout-row").forEach((row) => {
    const index = Number(row.dataset.layoutIndex);
    row.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("input", () => updateLayoutRow(row, index));
      input.addEventListener("change", () => updateLayoutRow(row, index));
    });
    row.querySelector(".layout-remove").addEventListener("click", () => {
      state.scheduleLayout.splice(index, 1);
      renderLayoutEditor();
      render();
      syncUserData();
    });
  });
}

function renderScheduleDisplayControls() {
  const weekend = $("showWeekendColumn");
  const notes = $("showNotesColumn");
  if (weekend) weekend.checked = state.scheduleDisplay.weekend;
  if (notes) notes.checked = state.scheduleDisplay.notes;
}

function updateScheduleDisplay() {
  state.scheduleDisplay = {
    weekend: $("showWeekendColumn")?.checked !== false,
    notes: $("showNotesColumn")?.checked !== false,
  };
  render();
  syncUserData();
}

function updateLayoutRow(row, index) {
  state.scheduleLayout[index] = {
    ...state.scheduleLayout[index],
    label: row.querySelector(".layout-label").value,
    time: row.querySelector(".layout-time").value,
    source: row.querySelector(".layout-source").value,
    weekday: row.querySelector(".layout-weekday").checked,
    weekend: row.querySelector(".layout-weekend").checked,
  };
  render();
  syncUserData();
}

function visibleLayoutForRow(row) {
  return state.scheduleLayout.filter((item) => row.weekend ? item.weekend : item.weekday);
}

function layoutHeader(item) {
  return item.time ? `${escapeHtml(item.label)} ${escapeHtml(item.time)}` : escapeHtml(item.label);
}

function layoutValue(row, item) {
  if (item.source === "blank") return "";
  return row[item.source] || "";
}

function renderSchedule() {
  const rows = state.data?.schedule || state.emptySchedule;
  const title = $("rotaName").value || "ROTA";
  const extraColumns = (state.scheduleDisplay.weekend ? 1 : 0) + (state.scheduleDisplay.notes ? 1 : 0);
  const colspan = 2 + state.scheduleLayout.length + extraColumns;
  const optionalHeaders = [
    state.scheduleDisplay.weekend ? "<th>Weekend?</th>" : "",
    state.scheduleDisplay.notes ? "<th>Notes</th>" : "",
  ].join("");
  setHtml(`
    <table>
      <tr><th class="sheet-title" colspan="${colspan}">${escapeHtml(title)}: On Call Schedule</th></tr>
      <tr class="head"><th>Date</th><th>Day</th>${state.scheduleLayout.map((item) => `<th>${layoutHeader(item)}</th>`).join("")}${optionalHeaders}</tr>
      ${rows.map((row) => {
        const visible = visibleLayoutForRow(row);
        const cells = state.scheduleLayout.map((item) => visible.includes(item)
          ? `<td class="${row.weekend ? "" : item.source === "ward" ? "ward" : "weekday-cell"}">${escapeHtml(layoutValue(row, item))}</td>`
          : `<td class="muted-cell"></td>`);
        const optionalCells = [
          state.scheduleDisplay.weekend ? `<td>${row.weekend ? "Yes" : "No"}</td>` : "",
          state.scheduleDisplay.notes ? `<td>${escapeHtml(row.notes || "")}</td>` : "",
        ].join("");
        return `
        <tr class="${row.weekend ? "weekend-row" : ""}">
          <td>${row.date}</td><td>${row.day}</td>${cells.join("")}${optionalCells}
        </tr>
      `; }).join("")}
    </table>
  `);
}

function renderReferral() {
  const rows = state.data?.referral || [];
  setHtml(`
    <table>
      <tr><th class="sheet-title" colspan="6">Referral / Case Transfer Coverage</th></tr>
      <tr class="ref-head"><th>Date</th><th>Day</th><th>Transfer Resident</th><th>Female Covering On Call</th><th>Rule Used</th><th>Notes</th></tr>
      ${rows.map((row) => `<tr><td>${row.date}</td><td>${row.day}</td><td>${row.transfer}</td><td>${row.cover}</td><td>${row.rule}</td><td>${row.notes || ""}</td></tr>`).join("")}
    </table>
  `);
}

function renderWorkload() {
  const rows = state.data?.workload || [];
  setHtml(`
    <table>
      <tr><th class="sheet-title" colspan="11">Workload Summary</th></tr>
      <tr class="work-head"><th>Resident</th><th>Gender</th><th>Afternoon</th><th>Night</th><th>Ward</th><th>Weekday Total</th><th>Weekend Total</th><th>On-Call Total</th><th>Extra Weekend Flag</th><th>Transfer</th><th>Female Cover</th></tr>
      ${rows.map((row) => `<tr class="${row.helper ? "helper-row" : ""}">
        <td>${row.resident}</td><td>${row.gender || ""}</td><td>${row.afternoon}</td><td>${row.night}</td><td>${row.ward}</td>
        <td>${row.weekday}</td><td class="${row.weekend > 2 ? "red" : ""}">${row.weekend}</td><td>${row.total}</td>
        <td class="${row.weekend > 2 ? "red" : ""}">${row.weekend > 2 ? "Compensate next rota" : row.helper ? "Weekend helper only" : ""}</td>
        <td>${row.transfer}</td><td>${row.femaleCover}</td>
      </tr>`).join("")}
    </table>
  `);
}

function renderChecks() {
  const audit = state.data?.audit;
  const rows = audit ? [
    ["Coverage", audit.ok ? "PASS" : "REVIEW", audit.ok ? "All days covered with no critical conflict detected." : audit.issues.join("; ")],
    ["Weekend maximum", Object.values(audit.weekendCounts || {}).some((x) => x > 2) ? "REVIEW" : "PASS", "Regular resident weekend count checked."],
    ["Referral", "PASS", "Referral coverage generated for every day."],
    ["Audit issues", audit.ok ? "PASS" : "REVIEW", audit.ok ? "No duplicate same-day assignments or post-night next-day conflicts detected." : audit.issues.join("; ")],
  ] : [["Ready", "WAITING", "Generate schedule to run the double check."]];
  setHtml(`
    <table>
      <tr><th class="sheet-title" colspan="4">Double Check Summary</th></tr>
      <tr class="work-head"><th>Area</th><th>Status</th><th>Details</th><th>Follow-up</th></tr>
      ${rows.map((row) => `<tr><td>${row[0]}</td><td class="${row[1] === "PASS" ? "pass" : row[1] === "WAITING" ? "adjusted" : "review"}">${row[1]}</td><td>${row[2]}</td><td></td></tr>`).join("")}
    </table>
  `);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]);
}

function saveRounds() {
  localStorage.setItem("residentRoundsPatients", JSON.stringify(state.patients));
  localStorage.setItem("residentRoundsElapsedMs", String(state.roundElapsedMs));
  showSavedIndicator();
  syncUserData();
}

function loadRounds() {
  try {
    state.patients = JSON.parse(localStorage.getItem("residentRoundsPatients") || "[]");
    state.roundHistory = JSON.parse(localStorage.getItem("residentRoundsHistory") || "[]");
    state.roundElapsedMs = Number(localStorage.getItem("residentRoundsElapsedMs") || "0");
  } catch {
    state.patients = [];
    state.roundHistory = [];
    state.roundElapsedMs = 0;
  }
  renderTimer();
}

function saveRoundHistory() {
  localStorage.setItem("residentRoundsHistory", JSON.stringify(state.roundHistory));
  showSavedIndicator();
  syncUserData();
}

function showSavedIndicator() {
  const indicator = $("saveIndicator");
  if (!indicator) return;
  indicator.textContent = "Saved";
  indicator.classList.add("saved");
  if (state.saveIndicatorHandle) clearTimeout(state.saveIndicatorHandle);
  state.saveIndicatorHandle = setTimeout(() => indicator.classList.remove("saved"), 900);
}

function openPatientWizard() {
  state.wizard = {
    index: 0,
    patient: {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      mrn: "",
      name: "",
      location: "",
      admissionCause: "",
      summary: "",
      activeIssue: "",
      plan: { medication: "", consultation: "", imaging: "", discharge: "Not decided" },
      checks: { note: false, labs: false, medication: false, consultation: false, imaging: false },
      createdAt: new Date().toISOString(),
    },
  };
  $("patientWizard").classList.remove("hidden");
  renderWizardQuestion();
}

function renderWizardQuestion() {
  const question = patientQuestions[state.wizard.index];
  $("wizardTitle").textContent = `Patient ${state.wizard.index + 1} of ${patientQuestions.length}`;
  $("wizardQuestion").textContent = question.label;
  $("wizardInput").value = state.wizard.patient[question.key] || "";
  $("wizardInput").placeholder = question.label;
  $("wizardInput").focus();
  $("wizardNextBtn").textContent = state.wizard.index === patientQuestions.length - 1 ? "Finish" : "Next";
}

function wizardNext(skip = false) {
  const question = patientQuestions[state.wizard.index];
  if (!skip) state.wizard.patient[question.key] = $("wizardInput").value.trim();
  state.wizard.index += 1;
  if (state.wizard.index >= patientQuestions.length) {
    state.patients.push(state.wizard.patient);
    state.selectedPatientId = state.wizard.patient.id;
    saveRounds();
    $("patientWizard").classList.add("hidden");
    renderRounds();
    return;
  }
  renderWizardQuestion();
}

function renderRounds() {
  renderPatientList();
  renderRoundHistory();
  renderSelectedPatient();
  renderTimer();
}

function renderPatientList() {
  const list = $("patientList");
  if (!state.patients.length) {
    list.innerHTML = `<div class="empty-state small">No patients yet. Add the first patient.</div>`;
    return;
  }
  list.innerHTML = state.patients.map((patient) => {
    const done = Object.values(patient.checks).filter(Boolean).length;
    return `
      <button class="patient-item ${patient.id === state.selectedPatientId ? "selected" : ""}" data-patient-id="${patient.id}">
        <strong>${escapeHtml(patient.name || "Unnamed patient")}</strong>
        <span>${escapeHtml(patient.mrn || "No MRN")} · ${escapeHtml(patient.location || "No room")}</span>
        <small>${done}/5 tasks checked</small>
      </button>
    `;
  }).join("");
  list.querySelectorAll(".patient-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPatientId = button.dataset.patientId;
      renderRounds();
    });
  });
}

function selectedPatient() {
  return state.patients.find((patient) => patient.id === state.selectedPatientId) || state.patients[0] || null;
}

function renderRoundHistory() {
  const list = $("roundHistoryList");
  if (!state.roundHistory.length) {
    list.innerHTML = `<div class="empty-state small">No saved rounds yet.</div>`;
    return;
  }
  list.innerHTML = state.roundHistory.map((round) => `
    <button class="history-item" data-history-id="${round.id}">
      <strong>${escapeHtml(round.label)}</strong>
      <span>${round.patients.length} patients · ${escapeHtml(round.elapsedText)}</span>
    </button>
  `).join("");
  list.querySelectorAll(".history-item").forEach((button) => {
    button.addEventListener("click", () => {
      const round = state.roundHistory.find((item) => item.id === button.dataset.historyId);
      if (round) showRoundSummary(round, false);
    });
  });
}

function renderSelectedPatient() {
  const patient = selectedPatient();
  if (patient && !state.selectedPatientId) state.selectedPatientId = patient.id;
  const view = $("roundPatientView");
  if (!patient) {
    view.innerHTML = `<div class="empty-state">Select a patient to view details and add the plan.</div>`;
    return;
  }
  view.innerHTML = `
    <div class="patient-detail">
      <div class="patient-header">
        <div>
          <h2>${escapeHtml(patient.name || "Unnamed patient")}</h2>
          <p>${escapeHtml(patient.mrn || "No MRN")} · ${escapeHtml(patient.location || "No room")}</p>
        </div>
        <div class="patient-header-actions">
          <button class="ghost" id="editPatientBtn" type="button">Edit</button>
          <button class="remove" id="deletePatientBtn" type="button">Delete</button>
        </div>
      </div>

      <div class="info-grid">
        <div><span>Admission cause</span><strong>${escapeHtml(patient.admissionCause || "-")}</strong></div>
        <div><span>Active issue</span><strong>${escapeHtml(patient.activeIssue || "-")}</strong></div>
        <div class="wide"><span>Summary</span><strong>${escapeHtml(patient.summary || "-")}</strong></div>
      </div>

      <div class="check-grid">
        ${["note", "labs", "medication", "consultation", "imaging"].map((key) => `
          <label class="check-card">
            <input type="checkbox" data-check="${key}" ${patient.checks[key] ? "checked" : ""} />
            <span>${key[0].toUpperCase() + key.slice(1)}</span>
          </label>
        `).join("")}
      </div>

      <div class="plan-grid">
        <label>Medication plan<textarea data-plan="medication">${escapeHtml(patient.plan.medication || "")}</textarea></label>
        <label>Consultation plan<textarea data-plan="consultation">${escapeHtml(patient.plan.consultation || "")}</textarea></label>
        <label>Imaging plan<textarea data-plan="imaging">${escapeHtml(patient.plan.imaging || "")}</textarea></label>
        <label>Discharge status
          <select data-plan="discharge">
            ${["Not decided", "Not for discharge", "For discharge today", "For discharge tomorrow"].map((option) => `<option ${patient.plan.discharge === option ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </label>
      </div>
    </div>
  `;
  view.querySelectorAll("[data-check]").forEach((input) => {
    input.addEventListener("change", () => {
      patient.checks[input.dataset.check] = input.checked;
      saveRounds();
      renderPatientList();
    });
  });
  view.querySelectorAll("[data-plan]").forEach((input) => {
    input.addEventListener("input", () => {
      patient.plan[input.dataset.plan] = input.value;
      saveRounds();
    });
  });
  $("editPatientBtn").addEventListener("click", () => openEditPatient(patient.id));
  $("deletePatientBtn").addEventListener("click", () => {
    state.patients = state.patients.filter((item) => item.id !== patient.id);
    state.selectedPatientId = state.patients[0]?.id || null;
    saveRounds();
    renderRounds();
  });
}

function openEditPatient(patientId) {
  const patient = state.patients.find((item) => item.id === patientId);
  if (!patient) return;
  state.editingPatientId = patientId;
  $("editMrn").value = patient.mrn || "";
  $("editName").value = patient.name || "";
  $("editLocation").value = patient.location || "";
  $("editAdmissionCause").value = patient.admissionCause || "";
  $("editSummary").value = patient.summary || "";
  $("editActiveIssue").value = patient.activeIssue || "";
  $("editPatientModal").classList.remove("hidden");
  $("editMrn").focus();
}

function closeEditPatient() {
  state.editingPatientId = null;
  $("editPatientModal").classList.add("hidden");
}

function savePatientInfo() {
  const patient = state.patients.find((item) => item.id === state.editingPatientId);
  if (!patient) return closeEditPatient();
  patient.mrn = $("editMrn").value.trim();
  patient.name = $("editName").value.trim();
  patient.location = $("editLocation").value.trim();
  patient.admissionCause = $("editAdmissionCause").value.trim();
  patient.summary = $("editSummary").value.trim();
  patient.activeIssue = $("editActiveIssue").value.trim();
  saveRounds();
  closeEditPatient();
  renderRounds();
}

function startRound() {
  if (!state.roundStartedAt) state.roundStartedAt = Date.now();
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = setInterval(renderTimer, 1000);
  renderTimer();
}

function endRound() {
  if (state.roundStartedAt) {
    state.roundElapsedMs += Date.now() - state.roundStartedAt;
  }
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = null;
  state.roundStartedAt = null;
  saveRounds();
  renderTimer();
}

function renderTimer() {
  const elapsed = state.roundElapsedMs + (state.roundStartedAt ? Date.now() - state.roundStartedAt : 0);
  const total = Math.floor(elapsed / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  $("roundTimer").textContent = `${h}:${m}:${s}`;
}

function timerText(ms = state.roundElapsedMs + (state.roundStartedAt ? Date.now() - state.roundStartedAt : 0)) {
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function todayLabel(date = new Date()) {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function snapshotPatients() {
  return state.patients.map((patient) => JSON.parse(JSON.stringify(patient)));
}

function doneAll() {
  endRound();
  const now = new Date();
  const round = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    label: `Round ${todayLabel(now)}`,
    date: now.toISOString(),
    elapsedMs: state.roundElapsedMs,
    elapsedText: timerText(state.roundElapsedMs),
    patients: snapshotPatients(),
  };
  state.roundHistory.unshift(round);
  saveRoundHistory();
  renderRoundHistory();
  showRoundSummary(round, true);
}

function patientPlanHtml(patient) {
  const checks = Object.entries(patient.checks || {})
    .map(([key, value]) => `${value ? "[x]" : "[ ]"} ${key[0].toUpperCase() + key.slice(1)}`)
    .join(" | ");
  return `
    <article class="summary-patient">
      <h3>${escapeHtml(patient.name || "Unnamed patient")}</h3>
      <p>${escapeHtml(patient.mrn || "No MRN")} · ${escapeHtml(patient.location || "No room")}</p>
      <dl>
        <dt>Admission</dt><dd>${escapeHtml(patient.admissionCause || "-")}</dd>
        <dt>Active issue</dt><dd>${escapeHtml(patient.activeIssue || "-")}</dd>
        <dt>Medication</dt><dd>${escapeHtml(patient.plan?.medication || "-")}</dd>
        <dt>Consultation</dt><dd>${escapeHtml(patient.plan?.consultation || "-")}</dd>
        <dt>Imaging</dt><dd>${escapeHtml(patient.plan?.imaging || "-")}</dd>
        <dt>Discharge</dt><dd>${escapeHtml(patient.plan?.discharge || "Not decided")}</dd>
        <dt>Checks</dt><dd>${checks}</dd>
      </dl>
    </article>
  `;
}

function showRoundSummary(round, justSaved) {
  $("summaryTitle").textContent = justSaved ? "Round Closed and Saved" : round.label;
  $("roundSummaryContent").innerHTML = `
    <div class="summary-meta">
      <strong>${escapeHtml(round.label)}</strong>
      <span>${round.patients.length} patients</span>
      <span>Time ${escapeHtml(round.elapsedText)}</span>
    </div>
    ${round.patients.length ? round.patients.map(patientPlanHtml).join("") : `<div class="empty-state small">No patients in this round.</div>`}
  `;
  $("roundSummaryModal").classList.remove("hidden");
}

const calcDefinitions = {
  abg: {
    title: "Blood Gas Analyzer",
    note: "Enter ABG/VBG chemistry values. Anion gap uses Na - (Cl + HCO3).",
    fields: [
      ["pH", "pH", "7.25"],
      ["paco2", "PaCO2 / PCO2 mmHg", "30"],
      ["hco3", "HCO3 mmol/L", "14"],
      ["na", "Na mmol/L", "140"],
      ["k", "K mmol/L optional", ""],
      ["cl", "Cl mmol/L", "104"],
      ["albumin", "Albumin g/dL optional", "4"],
      ["lactate", "Lactate mmol/L optional", ""],
    ],
    calculate: calculateAbg,
  },
  abcd2: {
    title: "ABCD2 Score",
    note: "TIA early stroke-risk score.",
    fields: [
      ["age60", "Age >= 60 years", "select", [["0", "No"], ["1", "Yes"]]],
      ["bp", "Initial BP >= 140 systolic or >= 90 diastolic", "select", [["0", "No"], ["1", "Yes"]]],
      ["clinical", "Clinical features", "select", [["0", "Other symptoms"], ["1", "Speech disturbance without weakness"], ["2", "Unilateral weakness"]]],
      ["duration", "TIA duration", "select", [["0", "< 10 minutes"], ["1", "10-59 minutes"], ["2", ">= 60 minutes"]]],
      ["diabetes", "Diabetes", "select", [["0", "No"], ["1", "Yes"]]],
    ],
    calculate: calculateAbcd2,
  },
  ganzoni: {
    title: "Ganzoni Iron Deficit",
    note: "Iron deficit = weight x (target Hb - actual Hb) x 2.4 + iron stores.",
    fields: [
      ["weight", "Weight kg", "70"],
      ["hb", "Current Hb g/dL", "8"],
      ["targetHb", "Target Hb g/dL", "13"],
      ["stores", "Iron stores mg", "500"],
    ],
    calculate: calculateGanzoni,
  },
  tsat: {
    title: "TSAT Calculator",
    note: "TSAT = serum iron / TIBC x 100.",
    fields: [
      ["iron", "Serum iron", "50"],
      ["tibc", "TIBC", "300"],
    ],
    calculate: calculateTsat,
  },
  nihss: {
    title: "NIHSS Score",
    note: "Total range 0-42. Select the score for each NIHSS item.",
    fields: [
      ["loc", "1a LOC", "select", [["0", "0 Alert"], ["1", "1 Not alert, arousable"], ["2", "2 Repeated/painful stimulation"], ["3", "3 Unresponsive"]]],
      ["questions", "1b LOC questions", "select", [["0", "0 Both correct"], ["1", "1 One correct"], ["2", "2 Neither correct"]]],
      ["commands", "1c LOC commands", "select", [["0", "0 Both correct"], ["1", "1 One correct"], ["2", "2 Neither correct"]]],
      ["gaze", "2 Best gaze", "select", [["0", "0 Normal"], ["1", "1 Partial gaze palsy"], ["2", "2 Forced deviation/total palsy"]]],
      ["visual", "3 Visual", "select", [["0", "0 No loss"], ["1", "1 Partial hemianopia"], ["2", "2 Complete hemianopia"], ["3", "3 Bilateral blindness"]]],
      ["facial", "4 Facial palsy", "select", [["0", "0 Normal"], ["1", "1 Minor"], ["2", "2 Partial"], ["3", "3 Complete"]]],
      ["leftArm", "5a Left arm motor", "select", motorOptions()],
      ["rightArm", "5b Right arm motor", "select", motorOptions()],
      ["leftLeg", "6a Left leg motor", "select", motorOptions()],
      ["rightLeg", "6b Right leg motor", "select", motorOptions()],
      ["ataxia", "7 Limb ataxia", "select", [["0", "0 Absent"], ["1", "1 One limb"], ["2", "2 Two limbs"]]],
      ["sensory", "8 Sensory", "select", [["0", "0 Normal"], ["1", "1 Mild-moderate loss"], ["2", "2 Severe-total loss"]]],
      ["language", "9 Best language", "select", [["0", "0 No aphasia"], ["1", "1 Mild-moderate"], ["2", "2 Severe"], ["3", "3 Mute/global"]]],
      ["dysarthria", "10 Dysarthria", "select", [["0", "0 Normal"], ["1", "1 Mild-moderate"], ["2", "2 Severe"]]],
      ["extinction", "11 Extinction/inattention", "select", [["0", "0 None"], ["1", "1 One modality"], ["2", "2 Profound"]]],
    ],
    calculate: calculateNihss,
  },
  wellsDvt: {
    title: "Wells Score for DVT",
    note: "Two-level Wells DVT: >=2 DVT likely, <2 DVT unlikely.",
    fields: [
      ["cancer", "Active cancer", "check", "1"],
      ["paralysis", "Paralysis/paresis/recent leg immobilization", "check", "1"],
      ["bedridden", "Bedridden >3 days or major surgery within 12 weeks", "check", "1"],
      ["tenderness", "Localized tenderness along deep venous system", "check", "1"],
      ["swollenLeg", "Entire leg swollen", "check", "1"],
      ["calf", "Calf swelling >3 cm vs other leg", "check", "1"],
      ["edema", "Pitting edema limited to symptomatic leg", "check", "1"],
      ["collateral", "Collateral superficial veins", "check", "1"],
      ["previous", "Previously documented DVT", "check", "1"],
      ["alternative", "Alternative diagnosis at least as likely", "check", "-2"],
    ],
    calculate: calculateWellsDvt,
  },
  wellsPe: {
    title: "Wells Score for PE",
    note: "Two-level interpretation: >4 PE likely, <=4 PE unlikely.",
    fields: [
      ["dvtSigns", "Clinical signs/symptoms of DVT", "check", "3"],
      ["peMostLikely", "PE more likely than alternative diagnosis", "check", "3"],
      ["tachy", "Heart rate >100", "check", "1.5"],
      ["immob", "Immobilization/surgery in previous 4 weeks", "check", "1.5"],
      ["previous", "Previous DVT/PE", "check", "1.5"],
      ["hemoptysis", "Hemoptysis", "check", "1"],
      ["malignancy", "Malignancy current/recent/palliative", "check", "1"],
    ],
    calculate: calculateWellsPe,
  },
  gfr: {
    title: "eGFR Calculator",
    note: "2021 CKD-EPI creatinine equation without race coefficient.",
    fields: [
      ["age", "Age years", "40"],
      ["sex", "Sex", "select", [["male", "Male"], ["female", "Female"]]],
      ["scr", "Serum creatinine mg/dL", "1"],
    ],
    calculate: calculateGfr,
  },
  crcl: {
    title: "Creatinine Clearance",
    note: "Cockcroft-Gault CrCl for adult medication dosing support.",
    fields: [
      ["age", "Age years", "40"],
      ["sex", "Sex", "select", [["male", "Male"], ["female", "Female"]]],
      ["weight", "Actual weight kg", "70"],
      ["height", "Height cm optional for IBW/AdjBW", ""],
      ["scr", "Serum creatinine mg/dL", "1"],
      ["weightMode", "Weight to use", "select", [["actual", "Actual body weight"], ["ideal", "Ideal body weight"], ["adjusted", "Adjusted body weight"]]],
    ],
    calculate: calculateCrcl,
  },
  vanco: {
    title: "Vancomycin Basic Helper",
    note: "Basic initial dose estimate. AUC/level monitoring and local policy should guide final dosing.",
    fields: [
      ["age", "Age years", "40"],
      ["sex", "Sex", "select", [["male", "Male"], ["female", "Female"]]],
      ["weight", "Weight kg", "70"],
      ["scr", "Serum creatinine mg/dL", "1"],
      ["severity", "Loading dose target", "select", [["serious", "Serious infection 25 mg/kg"], ["standard", "Standard 20 mg/kg"]]],
    ],
    calculate: calculateVancomycin,
  },
  heparin: {
    title: "Heparin Infusion Helper",
    note: "Initial UFH math only. Use hospital nomogram, aPTT/anti-Xa monitoring, and contraindication review.",
    fields: [
      ["weight", "Weight kg", "70"],
      ["protocol", "Protocol", "select", [["vte", "VTE/PE: bolus 80 u/kg, infusion 18 u/kg/hr"], ["low", "Low intensity/ACS: bolus 60 u/kg, infusion 12 u/kg/hr"]]],
      ["concentration", "Infusion concentration units/mL optional", "100"],
    ],
    calculate: calculateHeparin,
  },
  insulin: {
    title: "Insulin Correction Helper",
    note: "Correction estimate using 1800 rule for rapid insulin or 1500 rule for regular insulin.",
    fields: [
      ["tdd", "Total daily insulin dose units", "40"],
      ["type", "Insulin type", "select", [["rapid", "Rapid acting: 1800 rule"], ["regular", "Regular insulin: 1500 rule"]]],
      ["current", "Current glucose mg/dL", "220"],
      ["target", "Target glucose mg/dL", "140"],
      ["carbs", "Carbohydrates grams optional", ""],
      ["icr", "Insulin carb ratio g/unit optional", ""],
    ],
    calculate: calculateInsulin,
  },
};

function motorOptions() {
  return [["0", "0 No drift"], ["1", "1 Drift"], ["2", "2 Some effort against gravity"], ["3", "3 No effort against gravity"], ["4", "4 No movement"]];
}

function renderCalculator() {
  if (!state.activeCalculator) return renderCalculatorList();
  const def = calcDefinitions[state.activeCalculator];
  const isFavorite = state.favoriteCalculators.includes(state.activeCalculator);
  $("calculatorContent").innerHTML = `
    <div class="calc-card">
      <div class="calc-heading">
        <div>
          <button id="backToCalcListBtn" class="ghost calc-back" type="button">Back</button>
          <h2>${def.title}</h2>
          <p>${def.note}</p>
        </div>
        <button id="favoriteCalcBtn" class="favorite-corner ${isFavorite ? "active" : ""}" type="button" aria-label="Favorite calculator">${isFavorite ? "★" : "☆"}</button>
      </div>
      <div class="calc-form">
        ${def.fields.map(renderCalcField).join("")}
      </div>
      <div id="calcResult" class="calc-result"></div>
    </div>
  `;
  document.querySelectorAll(".calc-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.calculator === state.activeCalculator);
  });
  $("backToCalcListBtn").addEventListener("click", () => {
    state.activeCalculator = null;
    renderCalculator();
  });
  $("calculatorContent").querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", runCalculator);
    input.addEventListener("change", runCalculator);
  });
  $("favoriteCalcBtn").addEventListener("click", toggleCurrentCalculatorFavorite);
  $("calculatorContent").querySelectorAll("[data-favorite-calculator]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCalculator = button.dataset.favoriteCalculator;
      renderCalculator();
    });
  });
  runCalculator();
}

function calculatorKeys() {
  return Object.keys(calcDefinitions);
}

function renderCalculatorList() {
  const favorites = state.favoriteCalculators.filter((key) => calcDefinitions[key]);
  const others = calculatorKeys().filter((key) => !favorites.includes(key));
  $("calculatorContent").innerHTML = `
    ${favorites.length ? renderCalculatorGroup("Favorites", favorites, true) : ""}
    ${renderCalculatorGroup("All Calculators", others, false)}
  `;
  document.querySelectorAll(".calc-tab").forEach((button) => button.classList.remove("active"));
  $("calculatorContent").querySelectorAll("[data-open-calculator]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCalculator = button.dataset.openCalculator;
      renderCalculator();
    });
  });
  $("calculatorContent").querySelectorAll("[data-toggle-favorite]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCalculatorFavorite(button.dataset.toggleFavorite, false);
      renderCalculator();
    });
  });
}

function renderCalculatorGroup(title, keys, favoriteGroup) {
  return `
    <section class="calc-list-section">
      <div class="section-title">
        <h2>${title}</h2>
        ${favoriteGroup ? `<span class="favorite-label">★</span>` : ""}
      </div>
      <div class="calc-list">
        ${keys.map(renderCalculatorChoice).join("")}
      </div>
    </section>
  `;
}

function renderCalculatorChoice(key) {
  const def = calcDefinitions[key];
  const isFavorite = state.favoriteCalculators.includes(key);
  return `
    <button class="calc-choice" type="button" data-open-calculator="${key}">
      <span class="calc-choice-text">
        <strong>${escapeHtml(def.title)}</strong>
        <small>${escapeHtml(def.note)}</small>
      </span>
      <span class="favorite-corner ${isFavorite ? "active" : ""}" data-toggle-favorite="${key}" aria-label="Favorite calculator">${isFavorite ? "★" : "☆"}</span>
    </button>
  `;
}

function loadCalculatorFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem("calculatorFavorites") || "null");
    state.favoriteCalculators = Array.isArray(saved) && saved.length ? saved.filter((key) => calcDefinitions[key]) : defaultFavoriteCalculators;
  } catch {
    state.favoriteCalculators = defaultFavoriteCalculators;
  }
}

function saveCalculatorFavorites() {
  localStorage.setItem("calculatorFavorites", JSON.stringify(state.favoriteCalculators));
  syncUserData();
}

function toggleCurrentCalculatorFavorite() {
  toggleCalculatorFavorite(state.activeCalculator, true);
}

function toggleCalculatorFavorite(key, rerenderCurrent) {
  if (!key) return;
  if (state.favoriteCalculators.includes(key)) {
    state.favoriteCalculators = state.favoriteCalculators.filter((item) => item !== key);
  } else {
    state.favoriteCalculators = [key, ...state.favoriteCalculators].slice(0, 6);
  }
  saveCalculatorFavorites();
  if (rerenderCurrent) renderCalculator();
}

function renderCalcField(field) {
  const [key, label, type, options] = field;
  if (type === "select") {
    return `<label>${label}<select data-calc="${key}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></label>`;
  }
  if (type === "check") {
    return `<label class="calc-check"><input type="checkbox" data-calc="${key}" value="${options}" /><span>${label}</span></label>`;
  }
  return `<label>${label}<input data-calc="${key}" inputmode="decimal" placeholder="${escapeHtml(type)}" /></label>`;
}

function calcValues() {
  const values = {};
  $("calculatorContent").querySelectorAll("[data-calc]").forEach((input) => {
    values[input.dataset.calc] = input.type === "checkbox" ? (input.checked ? Number(input.value) : 0) : input.value;
  });
  return values;
}

function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function runCalculator() {
  const result = calcDefinitions[state.activeCalculator].calculate(calcValues());
  $("calcResult").innerHTML = result;
}

function resultHtml(title, rows, badge = "") {
  return `
    <div class="result-title">
      <strong>${title}</strong>
      ${badge ? `<span>${badge}</span>` : ""}
    </div>
    <dl>${rows.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join("")}</dl>
  `;
}

function calculateAbg(v) {
  const pH = num(v.pH);
  const paco2 = num(v.paco2);
  const hco3 = num(v.hco3);
  const na = num(v.na);
  const k = num(v.k);
  const cl = num(v.cl);
  const albumin = num(v.albumin);
  const lactate = num(v.lactate);
  if ([pH, paco2, hco3, na, cl].some((x) => x === null)) return `<div class="empty-state small">Enter pH, PaCO2, HCO3, Na, and Cl.</div>`;
  const ag = na - (cl + hco3);
  const agK = k === null ? null : na + k - (cl + hco3);
  const correctedAg = albumin === null ? ag : ag + 2.5 * (4 - albumin);
  const delta = hco3 < 24 ? (correctedAg - 12) / (24 - hco3) : null;
  const winterLow = 1.5 * hco3 + 8 - 2;
  const winterHigh = 1.5 * hco3 + 8 + 2;
  const primary = pH < 7.35 ? "Acidemia" : pH > 7.45 ? "Alkalemia" : "Near-normal pH";
  let metabolic = "No clear metabolic acidosis by HCO3";
  if (hco3 < 22) metabolic = correctedAg > 12 ? "Metabolic acidosis: HAGMA" : "Metabolic acidosis: NAGMA";
  if (hco3 > 26) metabolic = "Metabolic alkalosis pattern";
  const respiratory = paco2 < 35 ? "Respiratory alkalosis pattern" : paco2 > 45 ? "Respiratory acidosis pattern" : "PaCO2 in usual range";
  let deltaText = "Not applicable unless metabolic acidosis is present";
  if (delta !== null && Number.isFinite(delta)) {
    if (delta < 0.4) deltaText = `${delta.toFixed(2)}: NAGMA pattern`;
    else if (delta < 0.8) deltaText = `${delta.toFixed(2)}: mixed HAGMA + NAGMA`;
    else if (delta <= 2) deltaText = `${delta.toFixed(2)}: pure HAGMA pattern`;
    else deltaText = `${delta.toFixed(2)}: HAGMA + metabolic alkalosis`;
  }
  let compensation = "Winter formula applies for metabolic acidosis";
  if (hco3 < 22) {
    compensation = `Expected PaCO2 ${winterLow.toFixed(1)}-${winterHigh.toFixed(1)} mmHg; actual ${paco2}`;
    if (paco2 < winterLow) compensation += " (additional respiratory alkalosis)";
    if (paco2 > winterHigh) compensation += " (additional respiratory acidosis)";
  }
  return resultHtml(primary, [
    ["Main pattern", `${metabolic}; ${respiratory}`],
    ["Anion gap", ag.toFixed(1)],
    ["Anion gap with K", agK === null ? "K not entered" : agK.toFixed(1)],
    ["Albumin-corrected AG", correctedAg.toFixed(1)],
    ["Delta delta", deltaText],
    ["Compensation", compensation],
    ["Lactate", lactate === null ? "Not entered" : lactate.toFixed(1)],
  ], correctedAg > 12 && hco3 < 22 ? "HAGMA" : hco3 < 22 ? "NAGMA" : "");
}

function calculateAbcd2(v) {
  const score = ["age60", "bp", "clinical", "duration", "diabetes"].reduce((sum, key) => sum + Number(v[key] || 0), 0);
  const risk = score <= 3 ? "Low risk: 2-day 1.0%, 7-day 1.2%" : score <= 5 ? "Moderate risk: 2-day 4.1%, 7-day 5.9%" : "High risk: 2-day 8.1%, 7-day 11.7%";
  return resultHtml(`ABCD2 = ${score}/7`, [["Interpretation", risk]]);
}

function calculateGanzoni(v) {
  const weight = num(v.weight);
  const hb = num(v.hb);
  const target = num(v.targetHb);
  const stores = num(v.stores) ?? 500;
  if ([weight, hb, target].some((x) => x === null)) return `<div class="empty-state small">Enter weight, current Hb, and target Hb.</div>`;
  const deficit = Math.max(0, weight * (target - hb) * 2.4 + stores);
  return resultHtml(`Iron deficit ${Math.round(deficit)} mg`, [
    ["Formula", `${weight} x (${target} - ${hb}) x 2.4 + ${stores}`],
    ["Rounded practical dose", `${Math.ceil(deficit / 100) * 100} mg`],
  ]);
}

function calculateTsat(v) {
  const iron = num(v.iron);
  const tibc = num(v.tibc);
  if ([iron, tibc].some((x) => x === null) || tibc === 0) return `<div class="empty-state small">Enter serum iron and TIBC in the same unit.</div>`;
  const tsat = (iron / tibc) * 100;
  const label = tsat < 20 ? "Low TSAT pattern" : tsat > 50 ? "High TSAT pattern" : "Usual range pattern";
  return resultHtml(`TSAT ${tsat.toFixed(1)}%`, [["Interpretation", label]]);
}

function calculateNihss(v) {
  const score = Object.values(v).reduce((sum, value) => sum + Number(value || 0), 0);
  const severity = score === 0 ? "No stroke symptoms by scale" : score <= 4 ? "Minor" : score <= 15 ? "Moderate" : score <= 20 ? "Moderate to severe" : "Severe";
  return resultHtml(`NIHSS = ${score}/42`, [["Severity", severity]]);
}

function calculateWellsDvt(v) {
  const score = Object.values(v).reduce((sum, value) => sum + Number(value || 0), 0);
  return resultHtml(`Wells DVT = ${score}`, [["Two-level result", score >= 2 ? "DVT likely" : "DVT unlikely"], ["Three-level guide", score >= 3 ? "High probability" : score >= 1 ? "Moderate probability" : "Low probability"]]);
}

function calculateWellsPe(v) {
  const score = Object.values(v).reduce((sum, value) => sum + Number(value || 0), 0);
  return resultHtml(`Wells PE = ${score}`, [["Two-level result", score > 4 ? "PE likely" : "PE unlikely"], ["Three-level guide", score > 6 ? "High probability" : score >= 2 ? "Moderate probability" : "Low probability"]]);
}

function calculateGfr(v) {
  const age = num(v.age);
  const scr = num(v.scr);
  const female = v.sex === "female";
  if ([age, scr].some((x) => x === null) || scr <= 0) return `<div class="empty-state small">Enter age, sex, and serum creatinine.</div>`;
  const k = female ? 0.7 : 0.9;
  const alpha = female ? -0.241 : -0.302;
  const ratio = scr / k;
  const gfr = 142 * Math.pow(Math.min(ratio, 1), alpha) * Math.pow(Math.max(ratio, 1), -1.209) * Math.pow(0.9938, age) * (female ? 1.012 : 1);
  const stage = gfr >= 90 ? "G1 if kidney damage present" : gfr >= 60 ? "G2" : gfr >= 45 ? "G3a" : gfr >= 30 ? "G3b" : gfr >= 15 ? "G4" : "G5";
  return resultHtml(`eGFR ${gfr.toFixed(0)} mL/min/1.73m2`, [["CKD-EPI 2021 stage band", stage]]);
}

function estimateWeights(sex, actualKg, heightCm) {
  if (!heightCm) return { actual: actualKg, ideal: actualKg, adjusted: actualKg, note: "Height not entered; using actual weight for all modes." };
  const inches = heightCm / 2.54;
  const overFiveFeet = Math.max(0, inches - 60);
  const ideal = (sex === "female" ? 45.5 : 50) + 2.3 * overFiveFeet;
  const adjusted = actualKg > ideal ? ideal + 0.4 * (actualKg - ideal) : actualKg;
  return { actual: actualKg, ideal, adjusted, note: "" };
}

function calculateCrcl(v) {
  const age = num(v.age);
  const weight = num(v.weight);
  const height = num(v.height);
  const scr = num(v.scr);
  const female = v.sex === "female";
  if ([age, weight, scr].some((x) => x === null) || scr <= 0) return `<div class="empty-state small">Enter age, sex, weight, and serum creatinine.</div>`;
  const weights = estimateWeights(v.sex, weight, height);
  const dosingWeight = weights[v.weightMode] || weights.actual;
  const crcl = ((140 - age) * dosingWeight * (female ? 0.85 : 1)) / (72 * scr);
  return resultHtml(`CrCl ${crcl.toFixed(0)} mL/min`, [
    ["Formula", "Cockcroft-Gault"],
    ["Weight used", `${dosingWeight.toFixed(1)} kg (${v.weightMode})`],
    ["IBW", height === null ? "Height not entered" : `${weights.ideal.toFixed(1)} kg`],
    ["AdjBW", height === null ? "Height not entered" : `${weights.adjusted.toFixed(1)} kg`],
    ["Note", weights.note || "Use clinical judgment in obesity, cachexia, AKI, pregnancy, or unstable creatinine."],
  ]);
}

function calculateVancomycin(v) {
  const age = num(v.age);
  const weight = num(v.weight);
  const scr = num(v.scr);
  if ([age, weight, scr].some((x) => x === null) || scr <= 0) return `<div class="empty-state small">Enter age, sex, weight, and serum creatinine.</div>`;
  const crcl = ((140 - age) * weight * (v.sex === "female" ? 0.85 : 1)) / (72 * scr);
  const loadMgKg = v.severity === "serious" ? 25 : 20;
  const loading = Math.min(3000, Math.round((weight * loadMgKg) / 250) * 250);
  const maintLow = Math.round((weight * 15) / 250) * 250;
  const maintHigh = Math.round((weight * 20) / 250) * 250;
  const interval = crcl >= 50 ? "q8-12h usually" : crcl >= 20 ? "q24h usually" : "dose by level / extended interval";
  return resultHtml(`Load about ${loading} mg`, [
    ["CrCl estimate", `${crcl.toFixed(0)} mL/min by Cockcroft-Gault using actual weight`],
    ["Maintenance estimate", `${maintLow}-${maintHigh} mg per dose`],
    ["Suggested interval band", interval],
    ["Safety note", "Use AUC/level monitoring, renal trend, infection severity, and local antimicrobial policy."],
  ]);
}

function calculateHeparin(v) {
  const weight = num(v.weight);
  const concentration = num(v.concentration);
  if (weight === null) return `<div class="empty-state small">Enter weight.</div>`;
  const vte = v.protocol === "vte";
  const bolusPerKg = vte ? 80 : 60;
  const infusionPerKg = vte ? 18 : 12;
  const maxBolus = vte ? null : 4000;
  const maxInfusion = vte ? null : 1000;
  const bolus = maxBolus ? Math.min(maxBolus, Math.round(weight * bolusPerKg)) : Math.round(weight * bolusPerKg);
  const hourly = maxInfusion ? Math.min(maxInfusion, Math.round(weight * infusionPerKg)) : Math.round(weight * infusionPerKg);
  return resultHtml(`Start ${hourly} units/hr`, [
    ["Bolus", `${bolus} units`],
    ["Infusion", `${hourly} units/hr`],
    ["Pump rate", concentration && concentration > 0 ? `${(hourly / concentration).toFixed(1)} mL/hr` : "Enter concentration to calculate mL/hr"],
    ["Protocol math", `${bolusPerKg} units/kg bolus, ${infusionPerKg} units/kg/hr infusion${maxBolus ? " with low-intensity caps" : ""}`],
    ["Safety note", "Check bleeding risk, platelet count, baseline coagulation, renal/liver issues, and hospital nomogram."],
  ]);
}

function calculateInsulin(v) {
  const tdd = num(v.tdd);
  const current = num(v.current);
  const target = num(v.target);
  const carbs = num(v.carbs);
  const icr = num(v.icr);
  if ([tdd, current, target].some((x) => x === null) || tdd <= 0) return `<div class="empty-state small">Enter total daily dose, current glucose, and target glucose.</div>`;
  const rule = v.type === "regular" ? 1500 : 1800;
  const factor = rule / tdd;
  const correction = Math.max(0, (current - target) / factor);
  const meal = carbs !== null && icr !== null && icr > 0 ? carbs / icr : null;
  const total = correction + (meal || 0);
  return resultHtml(`${total.toFixed(1)} units estimated`, [
    ["Correction factor", `1 unit lowers glucose about ${factor.toFixed(0)} mg/dL (${rule} rule)`],
    ["Correction dose", `${correction.toFixed(1)} units`],
    ["Carb dose", meal === null ? "Not calculated" : `${meal.toFixed(1)} units`],
    ["Rounding", `${Math.round(total * 2) / 2} units to nearest 0.5`],
    ["Safety note", "Consider insulin on board, oral intake, hypoglycemia risk, pregnancy, DKA/HHS protocols, and local policy."],
  ]);
}

async function refreshEmpty() {
  if (!$("startDate").value || !$("endDate").value) {
    state.emptySchedule = [];
    state.data = null;
    $("downloadLink").classList.add("hidden");
    $("statusText").textContent = "Enter start and end dates, then refresh empty schedule.";
    render();
    return;
  }
  const data = await postJson("/api/empty", collectConfig());
  state.emptySchedule = data.schedule;
  state.data = null;
  $("downloadLink").classList.add("hidden");
  $("statusText").textContent = "Empty schedule ready.";
  render();
}

async function renderAdminUsers() {
  const list = $("adminUserList");
  if (state.currentUser?.role !== "admin") {
    list.innerHTML = `<div class="empty-state">Admin access only.</div>`;
    return;
  }
  list.innerHTML = `<div class="empty-state small">Loading users...</div>`;
  try {
    const data = await getJson("/api/admin/users");
    const pending = data.users.filter((user) => user.status === "pending");
    const approved = data.users.filter((user) => user.status === "approved");
    const removed = data.users.filter((user) => !["pending", "approved"].includes(user.status));
    list.innerHTML = `
      ${renderAdminUserSection("Pending Requests", pending)}
      ${renderAdminUserSection("Approved Users", approved)}
      ${removed.length ? renderAdminUserSection("Removed / Rejected", removed) : ""}
    `;
    list.querySelectorAll("[data-approve-user]").forEach((button) => {
      button.addEventListener("click", async () => {
        await postJson("/api/admin/approve", { userId: button.dataset.approveUser });
        showToast("User approved");
        renderAdminUsers();
      });
    });
    list.querySelectorAll("[data-reject-user]").forEach((button) => {
      button.addEventListener("click", async () => {
        await postJson("/api/admin/reject", { userId: button.dataset.rejectUser });
        showToast(button.textContent.includes("Remove") ? "Access removed" : "User rejected");
        renderAdminUsers();
      });
    });
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderAdminUserSection(title, users) {
  return `
    <section class="admin-section">
      <h2>${title}</h2>
      ${users.length ? users.map(renderAdminUser).join("") : `<div class="empty-state small">No users here.</div>`}
    </section>
  `;
}

function renderAdminUser(user) {
  return `
      <article class="admin-user">
        <div>
          <strong>${escapeHtml(user.username)}</strong>
          <span>${escapeHtml(user.role)} | ${escapeHtml(user.status)} | ${new Date(user.createdAt).toLocaleString()}</span>
        </div>
        <div class="admin-actions">
          ${adminActionsFor(user)}
        </div>
      </article>
    `;
}

function adminActionsFor(user) {
  if (user.role === "admin") return `<span class="admin-badge">Admin</span>`;
  if (user.status === "pending") {
    return `
      <button class="primary" data-approve-user="${user.id}" type="button">Approve</button>
      <button class="remove" data-reject-user="${user.id}" type="button">Reject</button>
    `;
  }
  if (user.status === "approved") return `<button class="remove" data-reject-user="${user.id}" type="button">Remove Access</button>`;
  return `<button class="primary" data-approve-user="${user.id}" type="button">Restore Access</button>`;
}

async function generate() {
  $("statusText").textContent = "Generating schedule and Excel workbook...";
  $("generateBtn").disabled = true;
  try {
    state.data = await postJson("/api/generate", collectConfig());
    $("downloadLink").href = state.data.downloadUrl;
    $("downloadLink").classList.remove("hidden");
    $("statusText").textContent = state.data.audit.ok ? "Schedule generated. Double check passed." : "Schedule generated with items to review.";
    render();
  } catch (error) {
    $("statusText").textContent = error.message;
  } finally {
    $("generateBtn").disabled = false;
  }
}

async function review() {
  $("aiBox").classList.remove("hidden");
  $("aiBox").textContent = "Reviewing rules...";
  try {
    const data = await postJson("/api/ai-review", collectConfig());
    $("aiBox").innerHTML = `<strong>AI / local review</strong><br>${escapeHtml(data.ai)}<br><br>${data.messages.map(escapeHtml).join("<br>")}`;
  } catch (error) {
    $("aiBox").textContent = error.message;
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    btn.classList.add("active");
    state.activeTab = btn.dataset.tab;
    render();
  });
});

document.querySelectorAll(".calc-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.activeCalculator = btn.dataset.calculator;
    renderCalculator();
  });
});

$("addRequest").addEventListener("click", () => addRequest());
$("loginBtn").addEventListener("click", login);
$("signupBtn").addEventListener("click", signup);
$("guestLoginBtn").addEventListener("click", guestLogin);
$("logoutBtn").addEventListener("click", logout);
$("refreshUsersBtn").addEventListener("click", renderAdminUsers);
$("emptyBtn").addEventListener("click", refreshEmpty);
$("resetLayoutBtn").addEventListener("click", () => resetScheduleLayout(true));
$("showWeekendColumn").addEventListener("change", updateScheduleDisplay);
$("showNotesColumn").addEventListener("change", updateScheduleDisplay);
$("saveTemplateBtn").addEventListener("click", saveCurrentTemplate);
$("loadTemplateBtn").addEventListener("click", loadSelectedTemplate);
$("deleteTemplateBtn").addEventListener("click", deleteSelectedTemplate);
$("generateBtn").addEventListener("click", generate);
$("reviewBtn").addEventListener("click", review);
$("addPatientBtn").addEventListener("click", openPatientWizard);
$("closeWizardBtn").addEventListener("click", () => $("patientWizard").classList.add("hidden"));
$("wizardNextBtn").addEventListener("click", () => wizardNext(false));
$("wizardSkipBtn").addEventListener("click", () => wizardNext(true));
$("wizardInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") wizardNext(false);
});
$("startRoundBtn").addEventListener("click", startRound);
$("endRoundBtn").addEventListener("click", endRound);
$("doneAllBtn").addEventListener("click", doneAll);
$("closeSummaryBtn").addEventListener("click", () => $("roundSummaryModal").classList.add("hidden"));
$("closeEditPatientBtn").addEventListener("click", closeEditPatient);
$("savePatientInfoBtn").addEventListener("click", savePatientInfo);
$("clearRoundsBtn").addEventListener("click", () => {
  if (!confirm("Clear all patients?")) return;
  state.patients = [];
  state.selectedPatientId = null;
  state.roundElapsedMs = 0;
  state.roundStartedAt = null;
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = null;
  saveRounds();
  renderRounds();
});
$("clearHistoryBtn").addEventListener("click", () => {
  if (!confirm("Clear round history?")) return;
  state.roundHistory = [];
  saveRoundHistory();
  renderRoundHistory();
});
document.querySelectorAll("[data-open-view]").forEach((button) => {
  button.addEventListener("click", () => openView(button.dataset.openView));
});

initDefaults();
renderScheduleDisplayControls();
renderLayoutEditor();
loadRotaTemplates();
loadCalculatorFavorites();
loadRounds();
render();
restoreSession();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}
