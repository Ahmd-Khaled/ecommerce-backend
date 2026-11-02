
export type EmailEventName = "confirmEmail" | "resetPassword";

interface IEmailHtmlTemplate {
  event: EmailEventName;
  code: string;
  name: string;
  subject: string;
  expiresInMinutes?: number;
  appName?: string;
  supportEmail?: string;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (value: string): string => {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
};

export const emailHtmlTemplate = ({
  event,
  code,
  name,
  subject,
  expiresInMinutes = 10,
  appName = "Your Store",
  supportEmail,
}: IEmailHtmlTemplate): string => {
  const safeCode = escapeHtml(code);
  const safeName = escapeHtml(name);
  const safeSubject = escapeHtml(subject);
  const safeAppName = escapeHtml(appName);
  const currentYear = new Date().getFullYear();
  const content = event === "resetPassword"
    ? {
      preheader: "Use this code to reset your password. It expires after 10 minutes.",
      instructions: "We received a request to reset your password. Enter the code below on the password reset page to choose a new password.",
      codeLabel: "Your Password Reset Code",
      expiration: `This password reset code expires after ${expiresInMinutes} minutes.`,
      securityNotice: "If you didn't request a password reset, please ignore this email. Your password will remain unchanged.",
    }
    : {
      preheader: "Confirm your email address using the verification code below.",
      instructions: "To confirm your email address, enter the code below on the email confirmation page.",
      codeLabel: "Your Email Confirmation Code",
      expiration: `This email confirmation code expires after ${expiresInMinutes} minutes.`,
      securityNotice: "If you didn't request email confirmation, you can safely ignore this email.",
    };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />

  <title>${safeSubject}</title>
</head>

<body style="
  margin: 0;
  padding: 0;
  background-color: #f3f4f6;
  font-family: Arial, Helvetica, sans-serif;
  color: #111827;
">

  <!-- Preheader -->
  <div style="
    display: none;
    max-height: 0;
    overflow: hidden;
    opacity: 0;
  ">
    ${content.preheader}
  </div>

  <table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    role="presentation"
    style="
      background-color: #f3f4f6;
      padding: 40px 15px;
    "
  >
    <tr>
      <td align="center">

        <!-- Main Container -->
        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          role="presentation"
          style="
            max-width: 560px;
            background-color: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid #e5e7eb;
          "
        >

          <!-- Brand Header -->
          <tr>
            <td align="center" style="
              background-color: #111827;
              padding: 32px 20px;
            ">

              <h1 style="
                margin: 0;
                color: #ffffff;
                font-size: 25px;
                font-weight: 700;
                letter-spacing: 0.5px;
              ">
                ${safeAppName}
              </h1>

              <p style="
                margin: 10px 0 0;
                color: #d1d5db;
                font-size: 13px;
              ">
                Secure Shopping Experience
              </p>

            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px 30px 30px;">

              <h2 style="
                margin: 0 0 20px;
                color: #111827;
                font-size: 23px;
                font-weight: 700;
                text-align: center;
              ">
                ${safeSubject}
              </h2>

              <p style="
                margin: 0 0 15px;
                color: #374151;
                font-size: 16px;
                line-height: 1.7;
              ">
                Hello <strong>${safeName}</strong>,
              </p>

              <p style="
                margin: 0 0 25px;
                color: #6b7280;
                font-size: 15px;
                line-height: 1.8;
              ">
                ${content.instructions}
              </p>

              <!-- OTP Section -->
              <table
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                role="presentation"
                style="
                  background-color: #f9fafb;
                  border: 1px solid #e5e7eb;
                  border-radius: 12px;
                "
              >
                <tr>
                  <td align="center" style="padding: 25px 15px;">

                    <p style="
                      margin: 0 0 18px;
                      color: #6b7280;
                      font-size: 12px;
                      font-weight: 700;
                      letter-spacing: 2px;
                      text-transform: uppercase;
                    ">
                      ${content.codeLabel}
                    </p>

                    <div style="
                      display: inline-block;
                      padding: 16px 24px;
                      background-color: #ffffff;
                      border: 1px dashed #9ca3af;
                      border-radius: 10px;
                    ">

                      <span style="
                        color: #111827;
                        font-size: 34px;
                        font-weight: 700;
                        letter-spacing: 10px;
                        font-family: Arial, Helvetica, sans-serif;
                      ">
                        ${safeCode}
                      </span>

                    </div>

                    <p style="
                      margin: 18px 0 0;
                      color: #6b7280;
                      font-size: 12px;
                    ">
                      Copy the code above and paste it into the password reset page.
                    </p>

                  </td>
                </tr>
              </table>

              <!-- Expiration Notice -->
              <table
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                role="presentation"
                style="margin-top: 25px;"
              >
                <tr>
                  <td style="
                    background-color: #fffbeb;
                    border-left: 4px solid #f59e0b;
                    padding: 14px 16px;
                    border-radius: 4px;
                  ">

                    <p style="
                      margin: 0;
                      color: #92400e;
                      font-size: 13px;
                      line-height: 1.7;
                    ">
                      <strong>Important:</strong>
                      ${content.expiration}
                      Please do not share it with anyone.
                    </p>

                  </td>
                </tr>
              </table>

              <!-- Security Notice -->
              <p style="
                margin: 25px 0 0;
                color: #6b7280;
                font-size: 13px;
                line-height: 1.8;
              ">
                ${content.securityNotice}
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="
              background-color: #f9fafb;
              border-top: 1px solid #e5e7eb;
              padding: 25px 20px;
            ">

              <p style="
                margin: 0 0 10px;
                color: #6b7280;
                font-size: 13px;
              ">
                Thank you for choosing
                <strong>${safeAppName}</strong>.
              </p>

              ${supportEmail
      ? `
                    <p style="
                      margin: 0 0 12px;
                      font-size: 12px;
                      color: #9ca3af;
                    ">
                      Need help?
                      <a
                        href="mailto:${encodeURIComponent(supportEmail)}"
                        style="color: #2563eb; text-decoration: none;"
                      >
                        Contact Support
                      </a>
                    </p>
                  `
      : ""
    }

              <p style="
                margin: 0;
                color: #9ca3af;
                font-size: 12px;
              ">
                &copy; ${currentYear} ${safeAppName}.
                All rights reserved.
              </p>

              <p style="
                margin: 8px 0 0;
                color: #9ca3af;
                font-size: 11px;
              ">
                This is an automated email. Please do not reply.
              </p>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;
};
