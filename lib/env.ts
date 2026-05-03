function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. See README.md for setup.`
    );
  }
  return value;
}

function optional(key: string): string | null {
  const value = process.env[key];
  return value && value.length > 0 ? value : null;
}

export const env = {
  googleServiceAccountEmail: () => required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  googleServiceAccountPrivateKey: () =>
    required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  googleSheetId: () => required("GOOGLE_SHEET_ID"),
  googleDriveRootFolderId: () => required("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
  ironSessionPassword: () => required("IRON_SESSION_PASSWORD"),
  appUrl: () => process.env.APP_URL ?? "http://localhost:3000",
  // Optional — when present, nameplate OCR is enabled. When absent, the
  // OCR endpoint returns a no-op result so the app silently degrades to
  // manual entry.
  anthropicApiKey: () => optional("ANTHROPIC_API_KEY"),
  // Optional — HighLevel API token for sending the customer report
  // email. When absent, /api/dispatches/send-report saves the request
  // but no actual email goes out (placeholder behavior).
  highlevelApiToken: () => optional("HIGHLEVEL_API_TOKEN"),
  highlevelLocationId: () => optional("HIGHLEVEL_LOCATION_ID"),
  highlevelReportTemplateId: () => optional("HIGHLEVEL_REPORT_TEMPLATE_ID"),
};
