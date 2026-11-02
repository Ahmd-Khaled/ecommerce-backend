"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailEvent = void 0;
const node_events_1 = require("node:events");
const verify_email_template_1 = require("../email/verify.email.template");
const send_email_1 = require("../email/send.email");
const emailSubjects = {
    confirmEmail: "Confirm Your Email",
    resetPassword: "Reset Your Password",
};
exports.emailEvent = new node_events_1.EventEmitter();
const sendOTPEmail = async (data, event) => {
    const subject = emailSubjects[event];
    try {
        const { otp, username, expiresInMinutes = 10, ...mailOptions } = data;
        const html = (0, verify_email_template_1.emailHtmlTemplate)({
            event,
            name: username ?? "",
            code: String(otp ?? ""),
            subject,
            expiresInMinutes,
        });
        await (0, send_email_1.sendEmail)({
            ...mailOptions,
            subject,
            html,
        });
    }
    catch (error) {
        console.error(`Error sending ${subject} email:`, error);
    }
};
exports.emailEvent.on("confirmEmail", (data) => {
    void sendOTPEmail(data, "confirmEmail");
});
exports.emailEvent.on("resetPassword", (data) => {
    void sendOTPEmail(data, "resetPassword");
});
