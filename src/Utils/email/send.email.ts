import { createTransport, type Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

let transporter: Transporter | undefined;

const getTransporter = (): Transporter => {
  if (transporter) {
    return transporter;
  }

  const email = process.env.NODEMAILER_EMAIL;
  const password = process.env.NODEMAILER_EMAIL_PASSWORD;

  if (!email || !password) {
    throw new Error("Nodemailer credentials are not configured");
  }

  transporter = createTransport({
    service: "gmail",
    auth: {
      user: email,
      pass: password,
    },
  });

  return transporter;
};

export const sendEmail = async (data: Mail.Options) => {
  const email = process.env.NODEMAILER_EMAIL;

  if (!email) {
    throw new Error("NODEMAILER_EMAIL is not configured");
  }

  const info = await getTransporter().sendMail({
    ...data,
    from: `"E-Commerce" <${email}>`,
  });

  console.log("Email sent: %s", info.messageId);

  return info;
};