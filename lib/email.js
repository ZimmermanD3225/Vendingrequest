// Email sending with two modes:
//  (1) RESEND_API_KEY set  → send via Resend.
//  (2) No API key          → print the link to the server console so local
//                            dev works with zero config. Great for testing.

const apiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.EMAIL_FROM || 'Vending Request <onboarding@resend.dev>';

let resendClient = null;
if (apiKey) {
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(apiKey);
  } catch (err) {
    console.error('resend package missing or failed to load:', err.message);
  }
}

function emailEnabled() {
  return Boolean(resendClient);
}

async function sendVerificationEmail({ to, verifyUrl, businessName }) {
  const greeting = businessName ? `Hi ${businessName},` : 'Welcome!';
  const subject = 'Verify your Vending Request account';
  const html = renderVerifyHtml({ greeting, verifyUrl });
  const text = [
    greeting,
    '',
    'Thanks for signing up for Vending Request.',
    'Click the link below to verify your email and activate your account:',
    '',
    verifyUrl,
    '',
    'This link expires in 24 hours.',
    '',
    "If you didn't sign up, you can ignore this email.",
  ].join('\n');

  if (!resendClient) {
    console.log('─'.repeat(72));
    console.log('[email] RESEND_API_KEY not set — email not sent.');
    console.log(`[email] Verification link for ${to}:`);
    console.log(`  ${verifyUrl}`);
    console.log('─'.repeat(72));
    return { dev: true };
  }

  try {
    const result = await resendClient.emails.send({
      from: fromAddress,
      to,
      subject,
      html,
      text,
    });
    if (result.error) throw result.error;
    return { id: result.data && result.data.id };
  } catch (err) {
    console.error('[email] Resend send failed:', err);
    // Fall back to console so the flow isn't blocked for the user.
    console.log(`[email] Fallback verification link for ${to}: ${verifyUrl}`);
    return { error: String(err.message || err) };
  }
}

function renderVerifyHtml({ greeting, verifyUrl }) {
  // Table-based layout for email client compatibility (Outlook etc).
  // No external assets, all inline styles.
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #ececec;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px 32px;">
          <div style="display:inline-block;width:28px;height:28px;border-radius:7px;background:#0a0a0a;position:relative;">
            <div style="position:absolute;top:8px;left:8px;width:12px;height:12px;background:#ffffff;border-radius:2px;"></div>
          </div>
          <div style="font-size:14px;color:#737373;margin-top:8px;letter-spacing:-0.01em;">Vending Request</div>
        </td></tr>
        <tr><td style="padding:16px 32px 0 32px;">
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;letter-spacing:-0.025em;font-weight:600;">Verify your email</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#404040;">${greeting}</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#404040;">
            Thanks for signing up for Vending Request. Click the button below to verify your email address and activate your account.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:8px 32px 24px 32px;">
          <a href="${verifyUrl}"
             style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:15px;font-weight:500;border-radius:9px;letter-spacing:-0.005em;">
            Verify your email
          </a>
        </td></tr>
        <tr><td style="padding:0 32px 12px 32px;">
          <p style="margin:0;font-size:13px;color:#737373;line-height:1.55;">
            Or paste this link into your browser:
          </p>
          <p style="margin:4px 0 0;font-size:12px;color:#737373;line-height:1.55;word-break:break-all;">
            <a href="${verifyUrl}" style="color:#737373;">${verifyUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px 32px 32px;border-top:1px solid #ececec;">
          <p style="margin:0 0 6px;font-size:12px;color:#a3a3a3;line-height:1.55;">
            This link expires in 24 hours.
          </p>
          <p style="margin:0;font-size:12px;color:#a3a3a3;line-height:1.55;">
            If you didn't sign up for Vending Request, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendPasswordResetEmail({ to, resetUrl, businessName }) {
  const greeting = businessName ? `Hi ${businessName},` : 'Hi,';
  const subject = 'Reset your Vending Request password';
  const html = renderResetHtml({ greeting, resetUrl });
  const text = [
    greeting,
    '',
    'We received a request to reset your Vending Request password.',
    'Click the link below to set a new password:',
    '',
    resetUrl,
    '',
    'This link expires in 1 hour.',
    '',
    "If you didn't request this, you can safely ignore this email.",
  ].join('\n');

  if (!resendClient) {
    console.log('─'.repeat(72));
    console.log('[email] RESEND_API_KEY not set — email not sent.');
    console.log(`[email] Password reset link for ${to}:`);
    console.log(`  ${resetUrl}`);
    console.log('─'.repeat(72));
    return { dev: true };
  }

  try {
    const result = await resendClient.emails.send({
      from: fromAddress,
      to,
      subject,
      html,
      text,
    });
    if (result.error) throw result.error;
    return { id: result.data && result.data.id };
  } catch (err) {
    console.error('[email] Resend send failed:', err);
    console.log(`[email] Fallback reset link for ${to}: ${resetUrl}`);
    return { error: String(err.message || err) };
  }
}

function renderResetHtml({ greeting, resetUrl }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #ececec;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px 32px;">
          <div style="display:inline-block;width:28px;height:28px;border-radius:7px;background:#0a0a0a;position:relative;">
            <div style="position:absolute;top:8px;left:8px;width:12px;height:12px;background:#ffffff;border-radius:2px;"></div>
          </div>
          <div style="font-size:14px;color:#737373;margin-top:8px;letter-spacing:-0.01em;">Vending Request</div>
        </td></tr>
        <tr><td style="padding:16px 32px 0 32px;">
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;letter-spacing:-0.025em;font-weight:600;">Reset your password</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#404040;">${greeting}</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#404040;">
            We received a request to reset your password. Click the button below to choose a new one.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:8px 32px 24px 32px;">
          <a href="${resetUrl}"
             style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:15px;font-weight:500;border-radius:9px;letter-spacing:-0.005em;">
            Reset password
          </a>
        </td></tr>
        <tr><td style="padding:0 32px 12px 32px;">
          <p style="margin:0;font-size:13px;color:#737373;line-height:1.55;">
            Or paste this link into your browser:
          </p>
          <p style="margin:4px 0 0;font-size:12px;color:#737373;line-height:1.55;word-break:break-all;">
            <a href="${resetUrl}" style="color:#737373;">${resetUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px 32px 32px;border-top:1px solid #ececec;">
          <p style="margin:0 0 6px;font-size:12px;color:#a3a3a3;line-height:1.55;">
            This link expires in 1 hour.
          </p>
          <p style="margin:0;font-size:12px;color:#a3a3a3;line-height:1.55;">
            If you didn't request a password reset, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, emailEnabled };
