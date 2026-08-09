# Every day Runner

Modular Node.js cron project designed to run for free on GitHub Actions.

## Structure

```text
every-day-runner/
  package.json
  .env.example
  cron/
    run_all.js
    services/
      email_service.js
    scripts/
      ipo_scanner.js
      linkedin_job_fetcher.js
      shared_notifier.js
  .github/
    workflows/
      cron.yml
```

## Local Setup

```bash
npm install
cp .env.example .env
npm start
```

On Windows PowerShell, set variables for a quick local test:

```powershell
$env:RESEND_API_KEY="re_xxx"
$env:MY_PERSONAL_EMAIL="you@example.com"
$env:REPORT_FROM_EMAIL="Every Day Runner <onboarding@resend.dev>"
npm start
```

## GitHub Repository Secrets

Open your GitHub repository, then go to:

`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

Add:

- `RESEND_API_KEY`: your Resend API key
- `MY_PERSONAL_EMAIL`: report destination email
- `REPORT_FROM_EMAIL`: sender address verified in Resend, or `Every Day Runner <onboarding@resend.dev>` for early testing
Optional:

- `JOB_KEYWORD`: defaults to `Node.js Developer`
- `JOB_RSS_URL`: RSS feed URL for job results
- `RUN_MODE`: `sequential` or `parallel`

## GitHub Actions Schedule

The workflow runs at:

- 9:00 AM IST = 3:30 AM UTC
- 6:00 PM IST = 12:30 PM UTC

Cron notation:

```yaml
- cron: "30 3 * * *"
- cron: "30 12 * * *"
```

## Run Cron Manually

You can manually trigger the cron any time from GitHub:

1. Open the `Actions` tab.
2. Select `Every Day Runner Cron`.
3. Click `Run workflow`.
4. Choose `sequential` or `parallel`.
5. Click `Run workflow`.

This uses the `workflow_dispatch` trigger in `.github/workflows/cron.yml`.


## Add Another Script

1. Create `cron/scripts/my_new_script.js`.
2. Export a function named `runMyNewScript`.
3. Import it in `cron/run_all.js`.
4. Add it to the `tasks` array.

Each task should catch its own risky network/layout logic and return a result object. That keeps one failing website from breaking the whole daily run.

Use `cron/services/email_service.js` for email from any script. It centralizes Resend config, recipient handling, send logs, and safe error handling.
