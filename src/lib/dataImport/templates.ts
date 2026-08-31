import * as XLSX from "xlsx";
import { EXECUTION_PASSENGER_TYPES } from "./executionImportConfig";
import type { ImportSpec } from "./specs";

const EXECUTION_TEMPLATE_DATA_ROWS = 500;

function defaultExample(spec: ImportSpec): any[] {
  return spec.fields.map((f) => {
    if (f.example !== undefined) return f.example;
    if (f.type === "date") return "";
    if (f.type === "number" || f.type === "integer") return f.default ?? 0;
    if (f.type === "boolean") return f.default ? "نعم" : "لا";
    if (f.default !== undefined) return f.default;
    return "";
  });
}

function dobFormula(row: number) {
  return `IFERROR(IF(LEN(B${row})<>14,"",IF(OR(LEFT(B${row},1)="2",LEFT(B${row},1)="3"),DATE(IF(LEFT(B${row},1)="2",1900,2000)+VALUE(MID(B${row},2,2)),VALUE(MID(B${row},4,2)),VALUE(MID(B${row},6,2))),"")),"")`;
}

function passengerTypeFormula(row: number) {
  return `IFERROR(IF(C${row}="","",IF(DATEDIF(C${row},TODAY(),"Y")<2,"طفل تحت ٢",IF(DATEDIF(C${row},TODAY(),"Y")<8,"طفل تحت ٨",IF(DATEDIF(C${row},TODAY(),"Y")<18,"طفل تحت18",IF(MOD(VALUE(MID(B${row},13,1)),2)=1,"ذكر بالغ","سيدات بالغ"))))),"")`;
}

async function downloadExecutionTemplate(spec: ImportSpec) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "Nagy El Araby Traveling ERP";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  (workbook.calcProperties as { forceFullCalc?: boolean }).forceFullCalc = true;

  const worksheet = workbook.addWorksheet("التنفيذات", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });
  const headers = spec.fields.map((f) => f.label);
  worksheet.addRow(headers);
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  worksheet.properties.defaultRowHeight = 20;

  const widths = [24, 18, 16, 18, 18, 18, 24, 18, 18, 20, 18, 18, 16, 34, 34];
  worksheet.columns.forEach((column, index) => {
    column.width = widths[index] || 20;
    column.alignment = { vertical: "middle", horizontal: "right", wrapText: true };
  });

  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFB7C9E2" } },
      bottom: { style: "thin", color: { argb: "FFB7C9E2" } },
      left: { style: "thin", color: { argb: "FFB7C9E2" } },
      right: { style: "thin", color: { argb: "FFB7C9E2" } },
    };
  });

  worksheet.getCell("B1").note = "أدخل الرقم القومي المصري 14 رقمًا. تاريخ الميلاد ونوع المسافر يتم حسابهما تلقائيًا.";
  worksheet.getCell("N1").note = "يمكن إدخال أكثر من خدمة في نفس الخانة باستخدام علامة +، مثال: موافقة أمنية + تذكرة طيران";
  worksheet.getCell("O1").note = "يمكن إدخال أكثر من خدمة في نفس الخانة باستخدام علامة +، مثال: موافقة أمنية + تذكرة طيران";

  const passengerList = `"${EXECUTION_PASSENGER_TYPES.join(",")}"`;
  const lastRow = EXECUTION_TEMPLATE_DATA_ROWS + 1;
  for (let row = 2; row <= lastRow; row++) {
    const nationalIdCell = worksheet.getCell(row, 2);
    nationalIdCell.numFmt = "@";
    nationalIdCell.dataValidation = {
      type: "custom",
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "الرقم القومي غير صحيح",
      error: "أدخل الرقم القومي في صورة 14 رقمًا بدون مسافات.",
      formulae: [`OR(B${row}="",AND(LEN(B${row})=14,ISNUMBER(VALUE(B${row}))))`],
    };

    const dobCell = worksheet.getCell(row, 3);
    dobCell.value = { formula: dobFormula(row) };
    dobCell.numFmt = "dd/mm/yyyy";

    const passengerTypeCell = worksheet.getCell(row, 4);
    passengerTypeCell.value = { formula: passengerTypeFormula(row) };
    passengerTypeCell.dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "نوع المسافر غير صحيح",
      error: "اختر نوعًا من القيم المحددة فقط.",
      formulae: [passengerList],
    };

    worksheet.getCell(row, 13).numFmt = "dd/mm/yyyy";
  }

  worksheet.addConditionalFormatting({
    ref: `D2:D${lastRow}`,
    rules: [
      {
        type: "expression",
        priority: 1,
        formulae: ['D2="طفل تحت18"'],
        style: {
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } },
          font: { color: { argb: "FF1F4E78" } },
        },
      },
    ],
  });

  const instructions = workbook.addWorksheet("تعليمات", { views: [{ rightToLeft: true }] });
  instructions.columns = [{ width: 105 }];
  const instructionRows = [
    "تعليمات نموذج استيراد التنفيذات",
    "1) كل صف يمثل تنفيذًا واحدًا لمسافر واحد.",
    "2) أدخل الرقم القومي المصري 14 رقمًا؛ تاريخ الميلاد ونوع المسافر سيظهران تلقائيًا.",
    `3) نوع المسافر محصور في: ${EXECUTION_PASSENGER_TYPES.join("، ")}.`,
    "4) اكتب أكثر من خدمة للوكيل أو للشركة في نفس الخانة مفصولة بعلامة +. ويمكن أيضًا استخدام الفاصلة أو سطر جديد.",
    "5) خدمات الشيت تُحفظ داخل التنفيذ كخدمات منفصلة. لأنها لا تحتوي على سعر أو شركة موردة، لا يتم إنشاء مديونية مالية تلقائيًا منها وقت الاستيراد.",
    "6) بعد الاستيراد يمكن فتح التنفيذ واستكمال التسعير/الشركة للخدمات التي تحتاج قيدًا ماليًا.",
  ];
  instructionRows.forEach((text, index) => {
    const row = instructions.addRow([text]);
    row.height = index === 0 ? 28 : 24;
    row.getCell(1).alignment = { horizontal: "right", vertical: "middle", wrapText: true };
    if (index === 0) {
      row.getCell(1).font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } };
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer as any);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `نموذج_${spec.id}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadTemplate(spec: ImportSpec) {
  if (spec.id === "executions") {
    void downloadExecutionTemplate(spec);
    return;
  }

  const headers = spec.fields.map((f) => f.label + (f.required ? " *" : ""));
  const exampleRows = spec.exampleRows?.length
    ? spec.exampleRows.map((row) => spec.fields.map((f) => row[f.key] ?? f.example ?? f.default ?? ""))
    : [defaultExample(spec)];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
  (ws as any)["!cols"] = headers.map((h) => ({ wch: Math.max(18, Math.min(34, h.length + 6)) }));
  const wb = XLSX.utils.book_new();
  (wb as any).Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, spec.label.slice(0, 28));
  XLSX.writeFile(wb, `نموذج_${spec.id}.xlsx`);
}
