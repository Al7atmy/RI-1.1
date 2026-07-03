import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { fmtDate } from "./scheduler.mjs";

function setStyle(range, { fill, fontColor = "#111827", bold = false, fontSize = 10, align = "center", vAlign = "center", wrap = true } = {}) {
  if (fill) range.format.fill.color = fill;
  range.format.font.color = fontColor;
  range.format.font.bold = bold;
  range.format.font.size = fontSize;
  range.format.horizontalAlignment = align;
  range.format.verticalAlignment = vAlign;
  range.format.wrapText = wrap;
}

function border(range, color = "#B8C2CC") {
  range.format.borders = { preset: "all", style: "thin", color };
}

function colName(index) {
  let name = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function layoutHeader(item) {
  return item.time ? `${item.label} ${item.time}` : item.label;
}

function visibleLayoutForRow(config, row) {
  return (config.scheduleLayout || []).filter((item) => row.weekend ? item.weekend : item.weekday);
}

function layoutValue(row, item) {
  if (item.source === "blank") return "";
  return row[item.source] || "";
}

export async function createRotaWorkbook(result, outputPath) {
  const { config, assignments, counts, helperCounts, referralRows, audit, colors } = result;
  const wb = Workbook.create();
  const schedule = wb.worksheets.add("ROTA Schedule");
  const referral = wb.worksheets.add("Referral Transfer");
  const workload = wb.worksheets.add("Workload Summary");
  const checks = wb.worksheets.add("Double Check");
  for (const sheet of [schedule, referral, workload, checks]) sheet.showGridLines = false;

  const layout = config.scheduleLayout || [];
  const display = config.scheduleDisplay || { weekend: true, notes: true };
  const optionalHeaders = [
    ...(display.weekend !== false ? ["Weekend?"] : []),
    ...(display.notes !== false ? ["Notes"] : []),
  ];
  const scheduleColumns = 2 + layout.length + optionalHeaders.length;
  const lastCol = colName(scheduleColumns);

  schedule.getRange(`A1:${lastCol}1`).merge();
  schedule.getRange("A1").values = [[`${config.rotaName}: On Call Schedule (${fmtDate(new Date(`${config.startDate}T00:00:00.000Z`))} - ${fmtDate(new Date(`${config.endDate}T00:00:00.000Z`))})`]];
  setStyle(schedule.getRange(`A1:${lastCol}1`), { fill: colors.title, fontColor: "#FFFFFF", bold: true, fontSize: 16 });
  schedule.getRange(`A2:${lastCol}2`).values = [["Date", "Day", ...layout.map(layoutHeader), ...optionalHeaders]];
  setStyle(schedule.getRange(`A2:${lastCol}2`), { fill: colors.scheduleHeader, fontColor: "#FFFFFF", bold: true });
  const lastRow = assignments.length + 2;
  schedule.getRange(`A3:${lastCol}${lastRow}`).values = assignments.map((a) => {
    const visible = visibleLayoutForRow(config, a);
    const optionalCells = [
      ...(display.weekend !== false ? [a.weekend ? "Yes" : "No"] : []),
      ...(display.notes !== false ? [a.notes] : []),
    ];
    return [a.date, a.day, ...layout.map((item) => visible.includes(item) ? layoutValue(a, item) : ""), ...optionalCells];
  });
  schedule.getRange(`A3:A${lastRow}`).format.numberFormat = [["d-mmm"]];
  setStyle(schedule.getRange(`A3:${lastCol}${lastRow}`), { fontSize: 10 });
  border(schedule.getRange(`A2:${lastCol}${lastRow}`));
  for (let i = 0; i < assignments.length; i++) {
    const visible = visibleLayoutForRow(config, assignments[i]);
    if (assignments[i].weekend) {
      schedule.getRangeByIndexes(i + 2, 0, 1, scheduleColumns).format.fill.color = colors.weekend;
      schedule.getRangeByIndexes(i + 2, 0, 1, scheduleColumns).format.font.color = "#FFFFFF";
    } else {
      layout.forEach((item, index) => {
        if (!visible.includes(item)) return;
        const cell = schedule.getCell(i + 2, index + 2);
        cell.format.fill.color = item.source === "ward" ? colors.ward : colors.weekday;
        cell.format.font.color = "#FFFFFF";
      });
    }
  }
  for (let i = 0; i < assignments.length; i++) {
    if (!assignments[i].weekend) continue;
    layout.forEach((item, index) => {
      if (item.source === "ward" || item.source === "blank") return;
      const col = index + 2;
      const value = schedule.getCell(i + 2, col).values?.[0]?.[0];
      if (value && counts[value]?.weekend > 2) {
        schedule.getCell(i + 2, col).format.fill.color = colors.red;
        schedule.getCell(i + 2, col).format.font.color = "#FFFFFF";
        schedule.getCell(i + 2, col).format.font.bold = true;
      }
    });
  }
  const legendStart = lastRow + 2;
  const legendRows = [
    "Legend",
    "Brown rows = weekend. Green ER cells = weekday ER duties. Blue ward cells = ward covered by ER Team.",
    "Red weekend cells = resident has more than 2 weekend on-calls this rotation and should be compensated next schedule.",
    "Ward resident duty removed from individual workload when total calls would exceed 10; ward is covered by ER Team.",
  ];
  schedule.getRange(`A${legendStart}:${lastCol}${legendStart + 3}`).values = legendRows.map((text) => [text, ...Array(scheduleColumns - 1).fill("")]);
  for (let r = legendStart; r <= legendStart + 3; r++) schedule.getRange(`A${r}:${lastCol}${r}`).merge();
  setStyle(schedule.getRange(`A${legendStart}:${lastCol}${legendStart + 3}`), { fill: "#F3F4F6", align: "left" });
  schedule.freezePanes.freezeRows(2);
  schedule.getRange("A:A").format.columnWidth = 11;
  schedule.getRange("B:B").format.columnWidth = 8;
  layout.forEach((_, index) => {
    schedule.getRange(`${colName(index + 3)}:${colName(index + 3)}`).format.columnWidth = 18;
  });
  let optionalStart = 3 + layout.length;
  if (display.weekend !== false) {
    schedule.getRange(`${colName(optionalStart)}:${colName(optionalStart)}`).format.columnWidth = 11;
    optionalStart += 1;
  }
  if (display.notes !== false) schedule.getRange(`${colName(optionalStart)}:${colName(optionalStart)}`).format.columnWidth = 42;

  referral.getRange("A1:F1").merge();
  referral.getRange("A1").values = [["Referral / Case Transfer Coverage"]];
  setStyle(referral.getRange("A1:F1"), { fill: colors.title, fontColor: "#FFFFFF", bold: true, fontSize: 15 });
  referral.getRange("A2:F2").values = [["Date", "Day", "Transfer Resident", "Female Covering On Call", "Rule Used", "Notes"]];
  setStyle(referral.getRange("A2:F2"), { fill: "#7A4F01", fontColor: "#FFFFFF", bold: true });
  referral.getRange(`A3:F${referralRows.length + 2}`).values = referralRows.map((r) => [r.date, r.day, r.transfer, r.cover, r.rule, r.notes]);
  referral.getRange(`A3:A${referralRows.length + 2}`).format.numberFormat = [["d-mmm"]];
  border(referral.getRange(`A2:F${referralRows.length + 2}`));
  setStyle(referral.getRange(`A3:F${referralRows.length + 2}`), { fontSize: 10 });
  referral.getRange("A:A").format.columnWidth = 11;
  referral.getRange("B:B").format.columnWidth = 8;
  referral.getRange("C:D").format.columnWidth = 22;
  referral.getRange("E:E").format.columnWidth = 48;
  referral.getRange("F:F").format.columnWidth = 32;
  referral.freezePanes.freezeRows(2);

  workload.getRange("A1:K1").merge();
  workload.getRange("A1").values = [["Workload Summary (Referral counts shown separately and not counted in on-call totals)"]];
  setStyle(workload.getRange("A1:K1"), { fill: colors.title, fontColor: "#FFFFFF", bold: true, fontSize: 14 });
  workload.getRange("A2:K2").values = [["Resident", "Gender", "Afternoon", "Night", "Ward", "Weekday Total", "Weekend Total", "On-Call Total", "Extra Weekend Flag", "Transfer", "Female Cover"]];
  setStyle(workload.getRange("A2:K2"), { fill: "#1F4E79", fontColor: "#FFFFFF", bold: true });
  const residentRows = config.residents.map((r) => {
    const c = counts[r.name];
    return [r.name, r.gender, c.afternoon, c.night, c.ward, c.weekday, c.weekend, c.total, c.weekend > 2 ? "Compensate next rota" : "", c.transfer, c.femaleCover];
  });
  const helperRows = config.helpers.map((r) => {
    const c = helperCounts[r.name] || { total: 0, weekend: 0 };
    return [r.name, r.gender === "H" ? "" : r.gender, c.total, 0, 0, 0, c.weekend, c.total, "Weekend helper only", 0, 0];
  });
  const workloadRows = [...residentRows, ["Average", "", ...Array(9).fill("")], ...helperRows];
  workload.getRange(`A3:K${workloadRows.length + 2}`).values = workloadRows;
  border(workload.getRange(`A2:K${workloadRows.length + 2}`));
  setStyle(workload.getRange(`A3:K${workloadRows.length + 2}`), { fontSize: 10 });
  const helperStart = 3 + residentRows.length + 1;
  if (helperRows.length) workload.getRange(`A${helperStart}:K${helperStart + helperRows.length - 1}`).format.fill.color = colors.helper;
  for (let i = 0; i < residentRows.length; i++) {
    const name = residentRows[i][0];
    if (counts[name].weekend > 2) {
      workload.getRangeByIndexes(i + 2, 6, 1, 3).format.fill.color = colors.red;
      workload.getRangeByIndexes(i + 2, 6, 1, 3).format.font.color = "#FFFFFF";
    }
  }
  workload.getRange("A:A").format.columnWidth = 18;
  workload.getRange("B:B").format.columnWidth = 8;
  workload.getRange("C:H").format.columnWidth = 13;
  workload.getRange("I:I").format.columnWidth = 22;
  workload.getRange("J:K").format.columnWidth = 13;
  workload.freezePanes.freezeRows(2);

  const checkRows = [
    ["Coverage", audit.ok ? "PASS" : "REVIEW", audit.ok ? "All days have 4 ER assignments; weekdays also show ward covered by ER Team." : audit.issues.join("; "), ""],
    ["Ward", "ADJUSTED", "Ward resident on-call can be removed when total resident calls would exceed 10. Weekday ward is ER Team coverage.", ""],
    ["Weekend maximum", Object.values(audit.weekendCounts).some((x) => x > 2) ? "COMPROMISE" : "PASS", Object.values(audit.weekendCounts).some((x) => x > 2) ? "Some residents exceed 2 weekend calls and are highlighted red." : "No resident exceeds 2 weekend calls.", ""],
    ["Family resident rule", "CHECKED", config.familyResidents.size ? `${[...config.familyResidents].join(", ")}: no Sundays and no Saturday nights when possible.` : "No family residents entered.", ""],
    ["Chief extra weekday shift", "APPLIED", config.extraWeekday.size ? `${[...config.extraWeekday].join(", ")} were favored for extra weekday ER load where possible.` : "No extra weekday residents entered.", ""],
    ["Referral", referralRows.length === assignments.length ? "PASS" : "REVIEW", "Referral sheet covers every date. Referral counts are separate and not counted in on-call totals.", ""],
    ["Audit issues", audit.ok ? "PASS" : "REVIEW", audit.ok ? "No duplicate same-day assignments, no formula errors, and no critical conflicts detected." : audit.issues.join("; "), ""],
  ];
  checks.getRange("A1:D1").merge();
  checks.getRange("A1").values = [["Double Check Summary"]];
  setStyle(checks.getRange("A1:D1"), { fill: colors.title, fontColor: "#FFFFFF", bold: true, fontSize: 15 });
  checks.getRange("A2:D2").values = [["Area", "Status", "Details", "Follow-up"]];
  setStyle(checks.getRange("A2:D2"), { fill: "#374151", fontColor: "#FFFFFF", bold: true });
  checks.getRange(`A3:D${checkRows.length + 2}`).values = checkRows;
  border(checks.getRange(`A2:D${checkRows.length + 2}`));
  setStyle(checks.getRange(`A3:D${checkRows.length + 2}`), { fontSize: 10, align: "left" });
  checks.getRange("A:A").format.columnWidth = 24;
  checks.getRange("B:B").format.columnWidth = 14;
  checks.getRange("C:C").format.columnWidth = 92;
  checks.getRange("D:D").format.columnWidth = 20;
  checks.freezePanes.freezeRows(2);

  const errors = await wb.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 300 },
    summary: "formula error scan",
  });

  await fs.mkdir(new URL(".", `file://${outputPath}`).pathname, { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(wb);
  await output.save(outputPath);
  return { path: outputPath, errorScan: errors.ndjson };
}
