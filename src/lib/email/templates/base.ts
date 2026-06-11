/** Escape text destined for HTML so template props can't inject markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Branded, inline-styled HTML shell shared by every template (inline styles
 * because email clients ignore <style>/external CSS). `contentHtml` is trusted
 * markup the template already escaped; callers must escape any user-provided
 * text before passing it in.
 */
export function baseLayout(opts: { contentHtml: string }): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:24px 32px;background:#16a34a;color:#ffffff;font-size:20px;font-weight:700;">Thrivo</td></tr>
          <tr><td style="padding:32px;color:#18181b;font-size:15px;line-height:1.6;">${opts.contentHtml}</td></tr>
          <tr><td style="padding:20px 32px;background:#fafafa;color:#71717a;font-size:12px;line-height:1.5;">
            You're receiving this because you have a Thrivo account.<br/>Thrivo · BeOrchid LLC
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
