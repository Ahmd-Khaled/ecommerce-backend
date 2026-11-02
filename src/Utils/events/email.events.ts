import { EventEmitter } from "node:events";
import type Mail from "nodemailer/lib/mailer";

import {
  emailHtmlTemplate,
  type EmailEventName,
} from "../email/verify.email.template";

import { sendEmail } from "../email/send.email";

type IEmail = Mail.Options & {
  otp?: number | string;
  username?: string;
  expiresInMinutes?: number;
};

const emailSubjects: Record<EmailEventName, string> = {
  confirmEmail: "Confirm Your Email",
  resetPassword: "Reset Your Password",
};

export const emailEvent = new EventEmitter();

const sendOTPEmail = async (
  data: IEmail,
  event: EmailEventName
): Promise<void> => {
  const subject = emailSubjects[event];

  try {
    const {
      otp,
      username,
      expiresInMinutes = 10,
      ...mailOptions
    } = data;

    const html = emailHtmlTemplate({
      event,
      name: username ?? "",
      code: String(otp ?? ""),
      subject,
      expiresInMinutes,
    });

    await sendEmail({
      ...mailOptions,
      subject,
      html,
    });
  } catch (error) {
    console.error(`Error sending ${subject} email:`, error);
  }
};

emailEvent.on("confirmEmail", (data: IEmail) => {
  void sendOTPEmail(data, "confirmEmail");
});

emailEvent.on("resetPassword", (data: IEmail) => {
  void sendOTPEmail(data, "resetPassword");
});