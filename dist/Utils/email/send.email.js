"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = void 0;
const nodemailer_1 = require("nodemailer");
let transporter;
const getTransporter = () => {
    if (transporter) {
        return transporter;
    }
    const email = process.env.NODEMAILER_EMAIL;
    const password = process.env.NODEMAILER_EMAIL_PASSWORD;
    if (!email || !password) {
        throw new Error("Nodemailer credentials are not configured");
    }
    transporter = (0, nodemailer_1.createTransport)({
        service: "gmail",
        auth: {
            user: email,
            pass: password,
        },
    });
    return transporter;
};
const sendEmail = async (data) => {
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
exports.sendEmail = sendEmail;
