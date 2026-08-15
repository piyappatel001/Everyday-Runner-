import axios from "axios";
import * as cheerio from "cheerio";
import { fileURLToPath } from "node:url";
import { sendHtmlReport } from "../services/email_service.js";

const IPO_WATCH_GMP_URL = "https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/";

export async function scanIpoWatch() {
  try {
    const { data } = await axios.get(IPO_WATCH_GMP_URL, {
      timeout: 20000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; EveryDayRunner/1.0; +https://github.com/actions)"
      }
    });

    const $ = cheerio.load(data);
    const table = findLikelyLiveTrackingTable($);
    const rows = extractRowsFromTable($, table);

    const filteredRows = rows
      .filter((row) => !/sme/i.test(`${row.title} ${row.type}`))
      .map((row) => ({
        ...row,
        estimatedGainPercent:
          row.pageGainPercent ?? calculateGainPercent(row.gmp, row.cutOffPrice)
      }))
      .filter((row) => row.estimatedGainPercent > 10);
    const lastDayIpos = filteredRows.filter((row) => row.isLastDayToday);

    console.log(`IPO scanner found ${filteredRows.length} matching row(s).`);
    if (lastDayIpos.length > 0) {
      console.log(`IPO scanner found ${lastDayIpos.length} last-day IPO alert(s).`);
    }

    return {
      count: filteredRows.length,
      rows: filteredRows,
      lastDayIpos,
      html: renderIpoReport(filteredRows)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`IPO scanner failed: ${message}`);
    return {
      count: 0,
      rows: [],
      html: `<p>IPO scanner failed safely: ${escapeHtml(message)}</p>`
    };
  }
}

function buildIpoEmailSubject(result) {
  if (result.lastDayIpos?.length > 0) {
    return `Don't miss this - last day for this: ${result.lastDayIpos
      .map((ipo) => ipo.title)
      .join(", ")}`;
  }

  return `IPO Scanner Report - ${new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata"
  })}`;
}

function renderStandaloneIpoEmail(result) {
  const generatedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium"
  });

  return `
    <main style="font-family: Arial, sans-serif; line-height: 1.5; color: #202124;">
      <h1 style="margin-bottom: 4px;">IPO Scanner Report</h1>
      <p style="margin-top: 0; color: #5f6368;">Generated at ${generatedAt} IST</p>
      <p>Matching IPO count: <strong>${result.count}</strong></p>
      ${result.html}
    </main>
  `;
}

function findLikelyLiveTrackingTable($) {
  const tables = $("table").toArray();

  const scoredTables = tables.map((table) => {
    const text = $(table).text().replace(/\s+/g, " ").toLowerCase();
    let score = 0;

    if (text.includes("gmp")) score += 4;
    if (text.includes("ipo")) score += 3;
    if (text.includes("price")) score += 2;
    if (text.includes("cut")) score += 2;
    if (text.includes("listing")) score += 1;

    return { table, score };
  });

  scoredTables.sort((a, b) => b.score - a.score);

  if (!scoredTables[0] || scoredTables[0].score === 0) {
    throw new Error("Could not find a live IPO tracking table.");
  }

  return scoredTables[0].table;
}

function extractRowsFromTable($, table) {
  const headerCells = $(table)
    .find("tr")
    .first()
    .find("th,td")
    .map((_, cell) => normalizeText($(cell).text()))
    .get();

  const titleIndex = findColumnIndex(headerCells, ["ipo", "company", "name"], 0);
  const gmpIndex = findColumnIndex(headerCells, ["gmp", "premium"], 1);
  const priceIndex = findColumnIndex(headerCells, ["cut", "price", "issue"], 3);
  const listingIndex = findColumnIndex(headerCells, ["listing", "estimated", "estimate"], -1);
  const typeIndex = findColumnIndex(headerCells, ["type", "board", "category"], 6);
  const dateIndex = findColumnIndex(headerCells, ["date", "open", "close"], 5);

  return $(table)
    .find("tr")
    .slice(1)
    .map((_, row) => {
      const cells = $(row)
        .find("td")
        .map((__, cell) => normalizeText($(cell).text()))
        .get();

      if (cells.length === 0) return null;

      const title = cells[titleIndex] || cells[0] || "";
      const gmp = parseMoney(cells[gmpIndex] || findCellByPattern(cells, /gmp|₹|rs\.?/i));
      const cutOffPrice = parseMoney(
        cells[priceIndex] || findCellByPattern(cells, /cut|price|₹|rs\.?/i)
      );
      const estimatedListingCell =
        (listingIndex >= 0 ? cells[listingIndex] : "") ||
        cells.find((cell) => /\([+-]?\d+(\.\d+)?%\)/.test(cell)) ||
        cells.find((cell) => /[+-]?\d+(\.\d+)?\s*%/.test(cell)) ||
        "";
      const estimatedListingPrice = parseMoney(estimatedListingCell);
      const pageGainPercent = parsePercent(estimatedListingCell);
      const type = cells[typeIndex] || "";
      const ipoDateRange = cells[dateIndex] || "";
      const isLastDayToday = isDateRangeEndingTodayInIst(ipoDateRange);

      if (!title || gmp <= 0 || cutOffPrice <= 0) return null;

      return {
        title,
        type,
        ipoDateRange,
        isLastDayToday,
        gmp,
        cutOffPrice,
        estimatedListingPrice,
        pageGainPercent
      };
    })
    .get()
    .filter(Boolean);
}

function findColumnIndex(headers, keywords, fallbackIndex = 0) {
  const index = headers.findIndex((header) =>
    keywords.some((keyword) => header.toLowerCase().includes(keyword))
  );

  return index >= 0 ? index : fallbackIndex;
}

function findCellByPattern(cells, pattern) {
  return cells.find((cell) => pattern.test(cell)) || "";
}

function parseMoney(value) {
  const match = String(value).replaceAll(",", "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parsePercent(value) {
  const match = String(value).match(/([+-]?\d+(\.\d+)?)\s*%/);
  return match ? Number(Number(match[1]).toFixed(2)) : null;
}

function calculateGainPercent(gmp, cutOffPrice) {
  return cutOffPrice > 0 ? Number(((gmp / cutOffPrice) * 100).toFixed(2)) : 0;
}

function isDateRangeEndingTodayInIst(dateRange) {
  const endDate = parseIpoEndDate(dateRange);
  if (!endDate) return false;

  const nowInIst = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata"
    })
  );

  return (
    endDate.getFullYear() === nowInIst.getFullYear() &&
    endDate.getMonth() === nowInIst.getMonth() &&
    endDate.getDate() === nowInIst.getDate()
  );
}

function parseIpoEndDate(dateRange) {
  const text = normalizeText(dateRange).replace(/,/g, "");
  if (!text) return null;

  const months = {
    january: 0,
    jan: 0,
    february: 1,
    feb: 1,
    march: 2,
    mar: 2,
    april: 3,
    apr: 3,
    may: 4,
    june: 5,
    jun: 5,
    july: 6,
    jul: 6,
    august: 7,
    aug: 7,
    september: 8,
    sep: 8,
    sept: 8,
    october: 9,
    oct: 9,
    november: 10,
    nov: 10,
    december: 11,
    dec: 11
  };

  const endPart = text.split(/\s*[-–]\s*/).pop();
  const directMatch = endPart.match(/(\d{1,2})\s+([A-Za-z]+)/);
  const fallbackMatch = text.match(/(?:^|\s)(\d{1,2})\s+([A-Za-z]+)\s*$/);
  const match = directMatch || fallbackMatch;

  if (!match) return null;

  const day = Number(match[1]);
  const month = months[match[2].toLowerCase()];
  if (!day || month === undefined) return null;

  const year = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata"
    })
  ).getFullYear();

  return new Date(year, month, day);
}

function normalizeText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function renderIpoReport(rows) {
  if (rows.length === 0) {
    return "<p>No non-SME IPO rows found with estimated listing gain above 20%.</p>";
  }

  const tableRows = rows
    .map(
      (row) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(row.title)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(row.type || "-")}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(row.ipoDateRange || "-")}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${row.gmp}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${row.cutOffPrice}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${row.estimatedListingPrice || "-"}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${row.estimatedGainPercent}%</strong></td>
        </tr>
      `
    )
    .join("");

  return `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th align="left" style="padding: 8px; border-bottom: 2px solid #ddd;">IPO</th>
          <th align="left" style="padding: 8px; border-bottom: 2px solid #ddd;">Type</th>
          <th align="left" style="padding: 8px; border-bottom: 2px solid #ddd;">IPO Dates</th>
          <th align="left" style="padding: 8px; border-bottom: 2px solid #ddd;">GMP</th>
          <th align="left" style="padding: 8px; border-bottom: 2px solid #ddd;">Cut-off Price</th>
          <th align="left" style="padding: 8px; border-bottom: 2px solid #ddd;">Estimated Listing</th>
          <th align="left" style="padding: 8px; border-bottom: 2px solid #ddd;">Estimated Gain</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await scanIpoWatch();
  console.log(JSON.stringify(result, null, 2));

  console.log("Sending IPO email report if Resend secrets are configured.");
  await sendHtmlReport({
    subject: buildIpoEmailSubject(result),
    html: renderStandaloneIpoEmail(result),
    label: "IPO email report"
  });
}
