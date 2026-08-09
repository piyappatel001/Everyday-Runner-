import { Resend } from "resend";
import dotenv from "dotenv";
export function getEmailConfig() {
  dotenv.config();  
  return {
    apiKey: process.env.RESEND_API_KEY,
    to: process.env.MY_PERSONAL_EMAIL,
    from: process.env.REPORT_FROM_EMAIL || "Every Day Runner <onboarding@resend.dev>"
  };
}

export function isEmailConfigured() {
  const { apiKey, to } = getEmailConfig();
  return Boolean(apiKey && to);
}

export async function sendEmail({ subject, html, text, label = "Email report" }) {
  const { apiKey, to, from } = getEmailConfig();

  if (!apiKey || !to) {
    console.warn(`${label} skipped. RESEND_API_KEY and MY_PERSONAL_EMAIL must be configured.`);
    return {
      skipped: true,
      reason: "Missing email environment variables."
    };
  }

  try {
    console.log(`${label}: sending to ${to}`);
    console.log(`${label}: subject "${subject}"`);

    const resend = new Resend(apiKey);
    const response = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text
    });

    if (response.error) {
      throw new Error(response.error.message || "Resend returned an unknown error.");
    }

    console.log(`${label}: sent to ${to}. Resend id: ${response.data?.id || "unknown"}`);

    return {
      skipped: false,
      id: response.data?.id
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${label}: failed to send. ${message}`);
    return {
      skipped: true,
      reason: message
    };
  }
}

export async function sendHtmlReport({ subject, html, text, label }) {
  return sendEmail({
    subject,
    html,
    text,
    label: label || "Email report"
  });
}
