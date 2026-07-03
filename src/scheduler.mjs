const DEFAULT_COLORS = {
  title: "#6B7280",
  scheduleHeader: "#1F4E3D",
  ward: "#17365D",
  weekday: "#2E5E2E",
  weekend: "#3B1F0F",
  red: "#C00000",
  helper: "#E8F0FE",
};

const DEFAULT_SCHEDULE_LAYOUT = [
  { id: "ward", label: "Ward", time: "4PM-8AM", source: "ward", weekday: true, weekend: false },
  { id: "fAfternoon", label: "F Area", time: "4PM-12AM", source: "fAfternoon", weekday: true, weekend: true },
  { id: "mAfternoon", label: "M Area", time: "4PM-12AM", source: "mAfternoon", weekday: true, weekend: true },
  { id: "mNight", label: "M Area Night", time: "12AM-8AM", source: "mNight", weekday: true, weekend: true },
  { id: "fNight", label: "F Area Night", time: "12AM-8AM", source: "fNight", weekday: true, weekend: true },
];

const DEFAULT_SCHEDULE_DISPLAY = {
  weekend: true,
  notes: true,
};

function normalizeScheduleLayout(layout) {
  const allowed = new Set(["ward", "fAfternoon", "mAfternoon", "mNight", "fNight", "blank"]);
  const rows = Array.isArray(layout) && layout.length ? layout : DEFAULT_SCHEDULE_LAYOUT;
  return rows.map((item, index) => ({
    id: item.id || `custom${index}`,
    label: item.label || "Shift",
    time: item.time || "",
    source: allowed.has(item.source) ? item.source : "blank",
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

export function d(y, m, day) {
  return new Date(Date.UTC(y, m - 1, day));
}

export function addDays(dt, n) {
  const out = new Date(dt);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

export function iso(dt) {
  return dt.toISOString().slice(0, 10);
}

export function dayName(dt) {
  return dt.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function fmtDate(dt) {
  return `${dt.getUTCDate()}-${dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`;
}

export function parseDateList(value = "") {
  return value
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parseNameList(value = "") {
  return value
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function asSet(list = []) {
  return new Set(list.filter(Boolean));
}

function isWeekend(dt, weekendDays = ["Fri", "Sat"]) {
  return weekendDays.includes(dayName(dt));
}

function dateRange(startIso, endIso) {
  const out = [];
  for (let cur = new Date(`${startIso}T00:00:00.000Z`); cur <= new Date(`${endIso}T00:00:00.000Z`); cur = addDays(cur, 1)) {
    out.push(new Date(cur));
  }
  return out;
}

function makeCounts(names) {
  return Object.fromEntries(names.map((name) => [name, {
    afternoon: 0,
    night: 0,
    ward: 0,
    weekday: 0,
    weekend: 0,
    total: 0,
    transfer: 0,
    femaleCover: 0,
    extraWeekend: 0,
  }]));
}

function requestBlocked(name, dt, shiftGroup, rules) {
  const key = iso(dt);
  const dn = dayName(dt);
  const avoid = rules.avoidDatesByResident[name] || new Set();
  if (avoid.has(key)) return true;
  if (rules.familyResidents.has(name) && dn === "Sun") return true;
  if (rules.familyResidents.has(name) && dn === "Sat" && shiftGroup === "Night") return true;
  const shiftAvoids = rules.avoidShiftsByResident[name] || [];
  return shiftAvoids.some((item) => item.date === key && item.shift === shiftGroup);
}

function applyAssignment(name, dt, slot, counts, helperCounts, lastNightDate, lastAnyDate, weekendDays) {
  if (helperCounts[name]) {
    helperCounts[name].total += 1;
    helperCounts[name].weekend += 1;
    return;
  }
  const weekend = isWeekend(dt, weekendDays);
  const c = counts[name];
  if (!c) return;
  c.total += 1;
  if (weekend) c.weekend += 1;
  else c.weekday += 1;
  if (slot.includes("Night")) c.night += 1;
  else c.afternoon += 1;
  lastAnyDate[name] = new Date(dt);
  if (slot.includes("Night")) lastNightDate[name] = new Date(dt);
}

function previousNightBlocked(name, dt, lastNightDate) {
  const last = lastNightDate[name];
  return last && iso(addDays(last, 1)) === iso(dt);
}

function clearCounts(counts, helperCounts) {
  for (const c of Object.values(counts)) {
    c.afternoon = 0;
    c.night = 0;
    c.ward = 0;
    c.weekday = 0;
    c.weekend = 0;
    c.total = 0;
    c.transfer = 0;
    c.femaleCover = 0;
    c.extraWeekend = 0;
  }
  for (const c of Object.values(helperCounts)) {
    c.total = 0;
    c.weekend = 0;
  }
}

function recomputeOnCallCounts(assignments, config, counts, helperCounts) {
  clearCounts(counts, helperCounts);
  for (const row of assignments) {
    applyAssignment(row.fAfternoon, row.date, "Afternoon", counts, helperCounts, {}, {}, config.weekendDays);
    applyAssignment(row.mAfternoon, row.date, "Afternoon", counts, helperCounts, {}, {}, config.weekendDays);
    applyAssignment(row.mNight, row.date, "Night", counts, helperCounts, {}, {}, config.weekendDays);
    applyAssignment(row.fNight, row.date, "Night", counts, helperCounts, {}, {}, config.weekendDays);
  }
}

function canSwapWeekendResident(assignments, index, slot, candidate, config, helperCounts) {
  const row = assignments[index];
  const shiftGroup = slot.includes("Night") ? "Night" : "Afternoon";
  const sameDay = [row.fAfternoon, row.mAfternoon, row.mNight, row.fNight].filter((name) => name !== row[slot]);
  if (sameDay.includes(candidate)) return false;
  if (requestBlocked(candidate, row.date, shiftGroup, config)) return false;
  const previous = assignments[index - 1];
  if (previous && [previous.mNight, previous.fNight].includes(candidate)) return false;
  if (shiftGroup === "Night") {
    const next = assignments[index + 1];
    if (next && [next.fAfternoon, next.mAfternoon, next.mNight, next.fNight].includes(candidate)) return false;
  }
  return !helperCounts[candidate];
}

function repairWeekendBalance(assignments, config, counts, helperCounts) {
  recomputeOnCallCounts(assignments, config, counts, helperCounts);
  const helpers = new Set(config.helperNames);
  let changed = true;
  while (changed) {
    changed = false;
    const over = Object.keys(counts).filter((name) => counts[name].weekend > 2).sort((a, b) => counts[b].weekend - counts[a].weekend);
    const under = Object.keys(counts).filter((name) => counts[name].weekend < 2).sort((a, b) => counts[a].weekend - counts[b].weekend || counts[a].total - counts[b].total);
    if (!over.length || !under.length) break;
    for (const overName of over) {
      let repaired = false;
      for (const row of assignments) {
        if (!row.weekend) continue;
        for (const slot of ["fAfternoon", "mAfternoon", "mNight", "fNight"]) {
          if (row[slot] !== overName) continue;
          const index = assignments.indexOf(row);
          const candidate = under.find((name) => !helpers.has(name) && canSwapWeekendResident(assignments, index, slot, name, config, helperCounts));
          if (!candidate) continue;
          row[slot] = candidate;
          recomputeOnCallCounts(assignments, config, counts, helperCounts);
          changed = true;
          repaired = true;
          break;
        }
        if (repaired) break;
      }
      if (changed) break;
    }
  }
}

export function normalizeConfig(raw) {
  const males = parseNameList(raw.males);
  const females = parseNameList(raw.females);
  const helpers = parseNameList(raw.helpers).map((name) => ({ name, gender: "H" }));
  const helperNames = helpers.map((h) => h.name);
  const extraWeekday = asSet(parseNameList(raw.extraWeekday));
  const familyResidents = asSet(parseNameList(raw.familyResidents));
  const weekendDays = raw.weekendDays?.length ? raw.weekendDays : ["Fri", "Sat"];

  const avoidDatesByResident = {};
  const avoidShiftsByResident = {};
  for (const req of raw.requests || []) {
    const name = req.name?.trim();
    if (!name) continue;
    if (!avoidDatesByResident[name]) avoidDatesByResident[name] = new Set();
    if (!avoidShiftsByResident[name]) avoidShiftsByResident[name] = [];
    for (const date of parseDateList(req.avoidDates)) avoidDatesByResident[name].add(date);
    for (const item of req.avoidShifts || []) {
      if (item.date && item.shift) avoidShiftsByResident[name].push({ date: item.date, shift: item.shift });
    }
  }

  return {
    rotaName: raw.rotaName || "ROTA",
    startDate: raw.startDate,
    endDate: raw.endDate,
    males,
    females,
    residents: [
      ...males.map((name) => ({ name, gender: "M" })),
      ...females.map((name) => ({ name, gender: "F" })),
    ],
    helpers,
    helperNames,
    extraWeekday,
    familyResidents,
    weekendDays,
    scheduleLayout: normalizeScheduleLayout(raw.scheduleLayout),
    scheduleDisplay: normalizeScheduleDisplay(raw.scheduleDisplay),
    useTemplateMemory: raw.useTemplateMemory !== false,
    avoidDatesByResident,
    avoidShiftsByResident,
  };
}

function templateMemoryOverrides(config) {
  return {};
}

export function buildEmptySchedule(config) {
  const dates = dateRange(config.startDate, config.endDate);
  return dates.map((dt) => ({
    date: dt,
    displayDate: fmtDate(dt),
    day: dayName(dt),
    weekend: isWeekend(dt, config.weekendDays),
    ward: isWeekend(dt, config.weekendDays) ? "" : "ER Team",
    fAfternoon: "",
    mAfternoon: "",
    mNight: "",
    fNight: "",
    notes: "",
  }));
}

export function generateSchedule(rawConfig) {
  const config = normalizeConfig(rawConfig);
  const names = config.residents.map((r) => r.name);
  const byName = Object.fromEntries([...config.residents, ...config.helpers].map((r) => [r.name, r]));
  const counts = makeCounts(names);
  const helperCounts = Object.fromEntries(config.helperNames.map((name) => [name, { total: 0, weekend: 0 }]));
  const lastNightDate = Object.fromEntries(names.map((name) => [name, null]));
  const lastAnyDate = Object.fromEntries(names.map((name) => [name, null]));
  const assignments = [];
  const dates = dateRange(config.startDate, config.endDate);
  const memoryOverrides = templateMemoryOverrides(config);
  const helperQueue = [];
  for (const helper of config.helperNames) helperQueue.push(helper, helper);

  function chooseResident(dt, slot, used, preferredGender = null, mustGender = null) {
    const weekend = isWeekend(dt, config.weekendDays);
    const shiftGroup = slot.includes("Night") ? "Night" : "Afternoon";
    let candidates = names.filter((name) => !used.has(name));
    if (mustGender) candidates = candidates.filter((name) => byName[name]?.gender === mustGender);
    let filtered = candidates.filter((name) => !requestBlocked(name, dt, shiftGroup, config) && !previousNightBlocked(name, dt, lastNightDate));
    if (!filtered.length) filtered = candidates.filter((name) => !requestBlocked(name, dt, shiftGroup, config));
    if (!filtered.length) filtered = candidates;
    if (weekend) {
      const underWeekend = filtered.filter((name) => counts[name].weekend < 2);
      if (underWeekend.length) filtered = underWeekend;
    }
    filtered.sort((a, b) => {
      const ca = counts[a], cb = counts[b];
      const chiefA = !weekend && config.extraWeekday.has(a) && ca.weekday < 7 ? -12 : 0;
      const chiefB = !weekend && config.extraWeekday.has(b) && cb.weekday < 7 ? -12 : 0;
      const prefA = preferredGender && byName[a]?.gender !== preferredGender ? 2 : 0;
      const prefB = preferredGender && byName[b]?.gender !== preferredGender ? 2 : 0;
      const crowdA = lastAnyDate[a] && iso(addDays(lastAnyDate[a], 1)) === iso(dt) ? 2 : 0;
      const crowdB = lastAnyDate[b] && iso(addDays(lastAnyDate[b], 1)) === iso(dt) ? 2 : 0;
      const scoreA = ca.total * 8 + (weekend ? ca.weekend * 12 : ca.weekday * 4) + chiefA + prefA + crowdA;
      const scoreB = cb.total * 8 + (weekend ? cb.weekend * 12 : cb.weekday * 4) + chiefB + prefB + crowdB;
      return scoreA - scoreB || a.localeCompare(b);
    });
    return filtered[0] || "";
  }

  for (const [index, dt] of dates.entries()) {
    const weekend = isWeekend(dt, config.weekendDays);
    const row = {
      date: dt,
      displayDate: fmtDate(dt),
      day: dayName(dt),
      weekend,
      ward: weekend ? "" : "ER Team",
      fAfternoon: "",
      mAfternoon: "",
      mNight: "",
      fNight: "",
      notes: "",
    };
    if (memoryOverrides[iso(dt)]) {
      [row.fAfternoon, row.mAfternoon, row.mNight, row.fNight] = memoryOverrides[iso(dt)];
      row.notes = row.weekend && [row.fAfternoon, row.mAfternoon, row.mNight, row.fNight].some((name) => helperCounts[name])
        ? "Weekend helper pattern matched to saved template"
        : "";
      applyAssignment(row.fAfternoon, dt, "Afternoon", counts, helperCounts, lastNightDate, lastAnyDate, config.weekendDays);
      applyAssignment(row.mAfternoon, dt, "Afternoon", counts, helperCounts, lastNightDate, lastAnyDate, config.weekendDays);
      applyAssignment(row.mNight, dt, "Night", counts, helperCounts, lastNightDate, lastAnyDate, config.weekendDays);
      applyAssignment(row.fNight, dt, "Night", counts, helperCounts, lastNightDate, lastAnyDate, config.weekendDays);
      assignments.push(row);
      continue;
    }
    const used = new Set();
    if (weekend && helperQueue.length) {
      const helper = helperQueue.shift();
      row.fAfternoon = helper;
      used.add(helper);
      applyAssignment(helper, dt, "Afternoon", counts, helperCounts, lastNightDate, lastAnyDate, config.weekendDays);
      row.notes = "Weekend helper duty";
    } else {
      const fA = chooseResident(dt, "F Afternoon", used, null, null);
      row.fAfternoon = fA;
      used.add(fA);
      applyAssignment(fA, dt, "Afternoon", counts, helperCounts, lastNightDate, lastAnyDate, config.weekendDays);
    }
    const mA = chooseResident(dt, "M Afternoon", used, weekend ? byName[row.fAfternoon]?.gender : null, null);
    row.mAfternoon = mA;
    used.add(mA);
    applyAssignment(mA, dt, "Afternoon", counts, helperCounts, lastNightDate, lastAnyDate, config.weekendDays);
    const mN = chooseResident(dt, "M Night", used, weekend ? byName[row.mAfternoon]?.gender : null, null);
    row.mNight = mN;
    used.add(mN);
    applyAssignment(mN, dt, "Night", counts, helperCounts, lastNightDate, lastAnyDate, config.weekendDays);
    const fN = chooseResident(dt, "F Night", used, weekend ? byName[row.mNight]?.gender : null, null);
    row.fNight = fN;
    used.add(fN);
    applyAssignment(fN, dt, "Night", counts, helperCounts, lastNightDate, lastAnyDate, config.weekendDays);
    assignments.push(row);
  }

  repairWeekendBalance(assignments, config, counts, helperCounts);
  const referralRows = buildReferralRows(assignments, config, counts);
  const audit = auditSchedule(assignments, config, counts, helperCounts, referralRows);
  return { config, assignments, counts, helperCounts, referralRows, audit, colors: DEFAULT_COLORS };
}

function buildReferralRows(assignments, config, counts) {
  const females = config.females;
  const males = config.males;
  const rows = [];
  for (const row of assignments) {
    const onToday = new Set([row.fAfternoon, row.mAfternoon, row.mNight, row.fNight].filter((name) => counts[name]));
    const previous = assignments.find((item) => iso(item.date) === iso(addDays(row.date, -1)));
    const prevNight = new Set(previous ? [previous.mNight, previous.fNight].filter((name) => counts[name]) : []);
    const afternoon = [row.fAfternoon, row.mAfternoon].filter((name) => counts[name]);
    let transfer = afternoon.find((name) => config.males.includes(name));
    if (!transfer) transfer = males.find((name) => !onToday.has(name) && !prevNight.has(name)) || "Ward on call resident";
    const unavailable = new Set([...onToday, ...prevNight, transfer]);
    const cover = females.find((name) => !unavailable.has(name) && !requestBlocked(name, row.date, "Afternoon", config)) || "Ward on call resident";
    if (counts[transfer]) counts[transfer].transfer += 1;
    if (counts[cover]) counts[cover].femaleCover += 1;
    rows.push({
      date: row.date,
      displayDate: row.displayDate,
      day: row.day,
      transfer,
      cover,
      rule: "Male afternoon/daytime resident transfers; female resident covers when conflict-free",
      notes: cover === "Ward on call resident" ? "No conflict-free female cover available" : "",
    });
  }
  return rows;
}

function auditSchedule(assignments, config, counts, helperCounts, referralRows) {
  const issues = [];
  const helpers = new Set(config.helperNames);
  let prevNight = new Set();
  const weekendCounts = {};
  for (const row of assignments) {
    const names = [row.fAfternoon, row.mAfternoon, row.mNight, row.fNight].filter(Boolean);
    if (names.length !== 4) issues.push(`${row.displayDate}: coverage is not 4`);
    if (new Set(names).size !== names.length) issues.push(`${row.displayDate}: duplicate resident`);
    if (!row.weekend && row.ward !== "ER Team") issues.push(`${row.displayDate}: weekday ward not ER Team`);
    if (row.weekend && row.ward) issues.push(`${row.displayDate}: weekend ward should be blank`);
    const regular = names.filter((name) => !helpers.has(name));
    for (const name of regular) {
      if (prevNight.has(name)) issues.push(`${row.displayDate}: ${name} assigned after night shift`);
      if (row.day === "Sun" && config.familyResidents.has(name)) issues.push(`${row.displayDate}: ${name} assigned on Sunday`);
    }
    for (const name of [row.mNight, row.fNight]) {
      if (row.day === "Sat" && config.familyResidents.has(name)) issues.push(`${row.displayDate}: ${name} assigned Saturday night`);
    }
    if (row.weekend) {
      for (const name of regular) weekendCounts[name] = (weekendCounts[name] || 0) + 1;
    }
    prevNight = new Set([row.mNight, row.fNight].filter((name) => name && !helpers.has(name)));
  }
  for (const [name, total] of Object.entries(weekendCounts)) {
    if (total > 2) {
      issues.push(`${name}: ${total} weekend duties`);
      if (counts[name]) counts[name].extraWeekend = total - 2;
    }
  }
  if (referralRows.length !== assignments.length || referralRows.some((row) => !row.transfer || !row.cover)) {
    issues.push("Referral schedule does not cover every day");
  }
  return { issues, weekendCounts, ok: issues.length === 0 };
}
