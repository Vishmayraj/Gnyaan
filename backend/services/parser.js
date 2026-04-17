const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const xlsx = require("xlsx");

let PDFLoader;
try {
  ({ PDFLoader } = require("@langchain/community/document_loaders/fs/pdf"));
  console.log("[parser] LangChain PDFLoader loaded ✅");
} catch (_) {
  console.warn("[parser] LangChain PDFLoader not found – using pdf-parse fallback");
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
async function parseDocument(filePath, mimeType) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[parser] File not found: ${filePath}`);
  }

  let rawChunks;

  switch (mimeType) {
    case "application/pdf":
      rawChunks = await parsePDF(filePath);
      break;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/msword":
      rawChunks = await parseDocx(filePath);
      break;
    case "text/plain":
      rawChunks = parseTxt(filePath);
      break;
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel":
      rawChunks = parseExcel(filePath);
      break;
    case "text/csv":
      rawChunks = parseCSV(filePath);
      break;
    default:
      throw new Error(`[parser] Unsupported MIME type: ${mimeType}`);
  }

  return rawChunks
    .map((chunk, i) => ({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        charCount: chunk.text.length,
      },
    }))
    .filter(chunk => chunk.text.trim().length > 30);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PDF
// ─────────────────────────────────────────────────────────────────────────────
async function parsePDF(filePath) {
  // ── pdf-parse fallback (now default for full document parsing) ───────────
  console.log("[parser] Using pdf-parse to parse whole document");
  const buffer = await fs.promises.readFile(filePath);
  const data = await pdf(buffer, { normalizeWhitespace: false });
  const totalPages = data.numpages;

  console.log(`[parser] pdf-parse chars: ${data.text.length}, pages: ${totalPages}`);

  const rawPages = data.text.includes("\f")
    ? data.text.split(/\f/)
    : data.text.split(/\n{3,}/);

  console.log(`[parser] split into ${rawPages.length} sections`);

  return buildChunksFromPages(
    rawPages.map((text, i) => ({ text, pageNum: i + 1 })),
    { filePath, pageCount: totalPages, docTitle: null }
  );
}

/**
 * buildChunksFromPages — shared builder for both PDF paths.
 */
function buildChunksFromPages(pages, { filePath, pageCount, docTitle }) {
  const chunks = [];
  const seenPrefixes = new Set();
  let currentSection = null;

  for (const { text: rawPage, pageNum } of pages) {
    if (!rawPage.trim()) continue;

    const cleaned = cleanProse(removeHeaderFooter(rawPage));
    if (!cleaned) continue;

    const heading = extractHeading(cleaned);
    if (heading) currentSection = heading;

    const { tables, prose } = splitTablesFromProse(cleaned);

    // ── table chunks ─────────────────────────────────────────────────────────
    for (const tableText of tables) {
      const clean = cleanProse(tableText);
      if (!clean || clean.length < 30) continue;

      // ✅ FIX 2: pageNum included in prefix to avoid false duplicate detection
      const prefix = `p${pageNum}_table_${clean.slice(0, 60)}`;
      if (seenPrefixes.has(prefix)) continue;
      seenPrefixes.add(prefix);

      chunks.push({
        text: clean,
        metadata: {
          source: filePath,
          fileType: "pdf",
          pageCount,
          contentType: "table",
          section: currentSection,
          ...(docTitle ? { documentTitle: docTitle } : {}),
        },
      });
    }

    // ── prose chunk ──────────────────────────────────────────────────────────
    const cleanedProse = cleanProse(prose);
    if (!cleanedProse || cleanedProse.length < 30) continue;

    // ✅ FIX 3: pageNum included in prefix to avoid false duplicate detection
    const prefix = `p${pageNum}_${cleanedProse.slice(0, 60)}`;
    if (seenPrefixes.has(prefix)) continue;
    seenPrefixes.add(prefix);

    chunks.push({
      text: cleanedProse,
      metadata: {
        source: filePath,
        fileType: "pdf",
        pageCount,
        contentType: "text",
        section: currentSection,
        ...(docTitle ? { documentTitle: docTitle } : {}),
      },
    });
  }

  console.log(`[parser] Total blocks extracted: ${chunks.length}`);
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TABLE DETECTION  (fixed — stricter rules)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * isTableRow — a line is a table row only if:
 *   1. Has 3+ columns separated by 2+ spaces / tabs  (strong signal)
 *   2. Has exactly 2 columns AND at least one is numeric/currency/date
 */
function isTableRow(line) {
  const s = line.trim();
  if (s.length < 5 || s.length > 400) return false;

  const cols = s.split(/\t|\s{2,}/).map(c => c.trim()).filter(Boolean);

  // Rule 1: 3+ columns → strong signal
  if (cols.length >= 3) return true;

  // Rule 2: 2 columns but one must be clearly numeric/date/currency
  if (cols.length === 2) {
    const hasNumeric = cols.some(c =>
      /^\$?[\d,]+(\.\d+)?$/.test(c) ||
      /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(c) ||
      /^\d+%$/.test(c)
    );
    return hasNumeric;
  }

  return false;
}

/**
 * splitTablesFromProse — groups 2+ consecutive table rows into table blocks.
 * Single isolated table-like lines stay in prose (avoids false positives).
 */
function splitTablesFromProse(pageText) {
  const lines = String(pageText).split("\n");
  const tables = [];
  const proseLines = [];
  let currentTable = [];

  const flushTable = () => {
    if (currentTable.length >= 2) {
      tables.push(currentTable.join("\n"));
    } else {
      proseLines.push(...currentTable); // not enough rows → treat as prose
    }
    currentTable = [];
  };

  for (const line of lines) {
    if (isTableRow(line)) {
      currentTable.push(line);
    } else {
      flushTable();
      proseLines.push(line);
    }
  }
  flushTable();

  return { tables, prose: proseLines.join("\n") };
}

// ─────────────────────────────────────────────────────────────────────────────
//  HEADING EXTRACTION  (fixed — pattern-based, not "any short line")
// ─────────────────────────────────────────────────────────────────────────────

// Lines that match these are NEVER headings
const HEADING_NOISE = /^(page\s+\d|effective date|policy\s*#|previous version|most recent|approved by|version\s+\d|initial version|last update|triagelogic|llc$|inc\.$|ltd\.$)/i;

// Lines that match these ARE headings
const HEADING_PATTERNS = [
  /^(I{1,3}|IV|V|VI{0,3}|IX|X{1,3})\.\s+\w/,       // Roman: I. Welcome
  /^[A-Z][A-Z\s\-]{4,60}$/,                           // ALL CAPS: "GENERAL POLICY"
  /^\d+\.\s+[A-Z][a-z]/,                              // Numbered: "1. General Policy"
  /^(Chapter|Section|Part)\s+\d+/i,                   // Chapter / Section
  /^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,5}$(?!\s*[,;:])/,  // Title Case, no trailing punct
];

function extractHeading(text) {
  const lines = String(text)
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, 10); // only check first 10 lines

  for (const line of lines) {
    if (HEADING_NOISE.test(line)) continue;
    if (line.length > 100) continue;
    if (line.endsWith(",") || line.endsWith(";")) continue;
    if ((line.match(/,/g) || []).length > 2) continue; // comma-heavy = prose

    for (const pattern of HEADING_PATTERNS) {
      if (pattern.test(line)) return line;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOCX
// ─────────────────────────────────────────────────────────────────────────────
async function parseDocx(filePath) {
  const { value: html } = await mammoth.convertToHtml(
    { path: filePath },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "table => table",
        "tr    => tr",
        "td    => td",
      ],
    }
  );

  const sections = extractDocxSections(html);
  const chunks = [];

  sections.forEach((section, idx) => {
    section.tables.forEach(tableText => {
      if (tableText.trim().length < 30) return;
      chunks.push({
        text: tableText,
        metadata: {
          source: filePath,
          fileType: "docx",
          section: section.heading,
          sectionIndex: idx,
          contentType: "table",
        },
      });
    });

    if (section.body.trim().length > 30) {
      chunks.push({
        text: section.body.trim(),
        metadata: {
          source: filePath,
          fileType: "docx",
          section: section.heading,
          sectionIndex: idx,
          contentType: section.heading ? "heading+body" : "text",
        },
      });
    }
  });

  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TXT
// ─────────────────────────────────────────────────────────────────────────────
function parseTxt(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 30)
    .map(text => ({
      text: normalizeUnicode(text),
      metadata: { source: filePath, fileType: "txt", contentType: "text" },
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXCEL / CSV
// ─────────────────────────────────────────────────────────────────────────────
function parseExcel(filePath) {
  return buildExcelChunks(xlsx.readFile(filePath), filePath, "xlsx");
}

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return buildExcelChunks(xlsx.read(raw, { type: "string" }), filePath, "csv");
}

function buildExcelChunks(workbook, filePath, fileType) {
  const chunks = [];
  const BATCH = 20;

  workbook.SheetNames.forEach(sheetName => {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
    });
    if (rows.length < 2) return;

    const headers = rows[0].map(h => String(h).trim());

    for (let start = 1; start < rows.length; start += BATCH) {
      const lines = rows
        .slice(start, start + BATCH)
        .filter(row => row.some(cell => String(cell).trim()))
        .map(row =>
          headers
            .map((h, i) => `${h}: ${String(row[i] ?? "").trim()}`)
            .filter(pair => !pair.endsWith(": "))
            .join(" | ")
        )
        .filter(Boolean);

      if (!lines.length) continue;

      chunks.push({
        text: lines.join("\n"),
        metadata: {
          source: filePath,
          fileType,
          sheetName,
          rowRange: `rows ${start}–${Math.min(start + BATCH - 1, rows.length - 1)}`,
          contentType: "table",
        },
      });
    }
  });

  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function cleanProse(text) {
  return normalizeUnicode(String(text))
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeUnicode(text) {
  return String(text).normalize("NFC");
}

// ✅ FIX 1: URL headers, date+URL combos, and page numbers like "1/30" removed
function removeHeaderFooter(text) {
  return String(text)
    .replace(/Page\s+\d+\s+(of\s+\d+)?/gi, "")
    .replace(/^\s*\d+\s*$/gm, "")
    .replace(/^https?:\/\/\S+$/gm, "")                         // full URL lines
    .replace(/^\d{1,2}\/\d{1,2}\/\d{4}https?:\/\/\S+$/gm, "") // date+URL lines like "6/30/2021https://..."
    .replace(/\d+\/\d+\s*$/gm, "")                             // page indicators like "1/30"
    .trim();
}

function extractDocxSections(html) {
  const sections = [];
  let current = { heading: null, body: "", tables: [] };
  const parts = html.split(/(<h[1-3][^>]*>.*?<\/h[1-3]>)/s);

  parts.forEach(part => {
    const headingMatch = part.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/s);
    if (headingMatch) {
      if (current.body.trim() || current.tables.length) sections.push({ ...current });
      current = { heading: stripHtmlTags(headingMatch[1]).trim(), body: "", tables: [] };
    } else {
      [...part.matchAll(/<table>(.*?)<\/table>/gs)].forEach(m => {
        current.tables.push(parseHtmlTable(m[1]));
      });
      const proseHtml = part.replace(/<table>.*?<\/table>/gs, "");
      current.body += cleanProse(stripHtmlTags(proseHtml)) + "\n";
    }
  });

  if (current.body.trim() || current.tables.length) sections.push(current);
  return sections;
}

function parseHtmlTable(tableHtml) {
  return [...tableHtml.matchAll(/<tr>(.*?)<\/tr>/gs)]
    .map(r =>
      [...r[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)]
        .map(c => stripHtmlTags(c[1]).trim())
        .join(" | ")
    )
    .filter(Boolean)
    .join("\n");
}

function stripHtmlTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

module.exports = { parseDocument };
