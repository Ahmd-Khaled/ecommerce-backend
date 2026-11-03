import { Queue, Worker, UnrecoverableError, type ConnectionOptions } from "bullmq";
import { ApplicationException } from "../response/error.response";
import { sendEmail } from "./send.email";
import { emailHtmlTemplate, type EmailEventName } from "./verify.email.template";

export interface EmailJobData {
  to: string;
  username: string;
  otp: string | number;
  expiresAt: number;
}

const QUEUE_NAME = "otp-email";
const subjects: Record<EmailEventName, string> = {
  confirmEmail: "Confirm Your Email",
  resetPassword: "Reset Your Password",
};

let queue: Queue<EmailJobData, void, EmailEventName> | undefined;
let worker: Worker<EmailJobData, void, EmailEventName> | undefined;

const connection = (consumer: boolean): ConnectionOptions => {
  const url = new URL(process.env.REDIS_URL || "redis://127.0.0.1:6379");
  if (!["redis:", "rediss:"].includes(url.protocol)) {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: consumer ? null : 1,
    enableOfflineQueue: consumer,
    connectTimeout: 5000,
  };
};

const getQueue = () => {
  if (!queue) {
    queue = new Queue<EmailJobData, void, EmailEventName>(QUEUE_NAME, {
      connection: connection(false),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 60 * 60, count: 1000 },
      },
    });
    queue.on("error", () => console.error("Email queue Redis connection error"));
  }
  return queue;
};

export const enqueueEmail = async (event: EmailEventName, data: EmailJobData): Promise<void> => {
  try {
    await getQueue().add(event, data);
  } catch {
    throw new ApplicationException("Email queue is unavailable. Please request a new code shortly.", 503);
  }
};

// SMTP failures must propagate to BullMQ so attempts and backoff are applied.
export const deliverEmail = async (event: EmailEventName, data: EmailJobData): Promise<void> => {
  if (!Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) {
    throw new UnrecoverableError("Email verification code has expired");
  }
  const subject = subjects[event];
  await sendEmail({
    to: data.to,
    subject,
    html: emailHtmlTemplate({
      event,
      name: data.username,
      code: String(data.otp),
      subject,
      expiresInMinutes: Math.max(1, Math.ceil((data.expiresAt - Date.now()) / 60000)),
    }),
  });
};

export const startEmailQueue = async (): Promise<void> => {
  await getQueue().waitUntilReady();
  if (!worker) {
    worker = new Worker<EmailJobData, void, EmailEventName>(
      QUEUE_NAME,
      job => deliverEmail(job.name, job.data),
      { connection: connection(true), concurrency: 3 },
    );
    worker.on("error", () => console.error("Email worker Redis connection error"));
    worker.on("failed", job => {
      console.error(`Email job ${job?.id} failed (attempt ${job?.attemptsMade})`);
    });
  }
  await worker.waitUntilReady();
};

export const closeEmailQueue = async (): Promise<void> => {
  await worker?.close();
  await queue?.close();
  worker = undefined;
  queue = undefined;
};
