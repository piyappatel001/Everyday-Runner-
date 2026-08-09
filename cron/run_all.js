import { scanIpoWatch } from "./scripts/ipo_scanner.js";
import { fetchLinkedInJobsBlueprint } from "./scripts/linkedin_job_fetcher.js";
import { sendHtmlReport } from "./services/email_service.js";

const modeArgIndex = process.argv.findIndex((arg) => arg === "--mode");
const modeArg = modeArgIndex >= 0 ? process.argv[modeArgIndex + 1] : null;
const runMode = (modeArg || process.env.RUN_MODE || "sequential").toLowerCase();

const tasks = [
  {
    name: "IPO Watch Scanner",
    run: scanIpoWatch
  },
  {
    name: "LinkedIn Job Fetcher Blueprint",
    run: fetchLinkedInJobsBlueprint
  }
];

async function runTask(task) {
  try {
    const startedAt = new Date();
    const result = await task.run();

    return {
      name: task.name,
      ok: true,
      startedAt,
      finishedAt: new Date(),
      result
    };
  } catch (error) {
    return {
      name: task.name,
      ok: false,
      startedAt: new Date(),
      finishedAt: new Date(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runSequentially() {
  const results = [];

  for (const task of tasks) {
    results.push(await runTask(task));
  }

  return results;
}

async function runInParallel() {
  return Promise.all(tasks.map(runTask));
}

function renderReport(results) {
  const generatedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium"
  });

  const sections = results
    .map((item) => {
      const body = item.ok
        ? item.result?.html || `<pre>${escapeHtml(JSON.stringify(item.result, null, 2))}</pre>`
        : `<p><strong>Task failed:</strong> ${escapeHtml(item.error)}</p>`;

      return `
        <section style="margin: 0 0 24px; padding: 16px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="margin: 0 0 8px;">${escapeHtml(item.name)}</h2>
          <p style="margin: 0 0 12px; color: ${item.ok ? "#137333" : "#b3261e"};">
            Status: ${item.ok ? "Success" : "Failed"}
          </p>
          ${body}
        </section>
      `;
    })
    .join("");

  return `
    <main style="font-family: Arial, sans-serif; line-height: 1.5; color: #202124;">
      <h1 style="margin-bottom: 4px;">Every Day Runner Report</h1>
      <p style="margin-top: 0; color: #5f6368;">Generated at ${generatedAt} IST</p>
      ${sections}
    </main>
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

async function main() {
  try {
    const results = runMode === "parallel" ? await runInParallel() : await runSequentially();
    const html = renderReport(results);
    const lastDayIpos = results.flatMap((item) => item.result?.lastDayIpos || []);
    const ipoResult = results.find((item) => item.name === "IPO Watch Scanner");
    const ipoCount = ipoResult?.result?.count ?? 0;
    console.log(`Cron IPO result count: ${ipoCount}`);

    if (lastDayIpos.length > 0) {
      console.log(`Cron last-day IPO alerts: ${lastDayIpos.map((ipo) => ipo.title).join(", ")}`);
    }

    const subject =
      lastDayIpos.length > 0
        ? `Don't miss this - last day for this: ${lastDayIpos
            .map((ipo) => ipo.title)
            .join(", ")}`
        : `Every Day Runner Report - ${new Date().toLocaleDateString("en-IN", {
            timeZone: "Asia/Kolkata"
          })}`;

    await sendHtmlReport({
      subject,
      html,
      label: "Cron email report"
    });

    const failedCount = results.filter((result) => !result.ok).length;
    if (failedCount > 0) {
      console.warn(`${failedCount} task(s) failed, but the workflow completed and sent the report.`);
    }
  } catch (error) {
    console.error("Global runner failure:", error);
    process.exitCode = 1;
  }
}

await main();
