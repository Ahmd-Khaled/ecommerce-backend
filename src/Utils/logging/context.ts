import { AsyncLocalStorage } from 'node:async_hooks';

export type Actor =
  | { type: 'anonymous' | 'system' }
  | { type: 'user' | 'admin'; id: string; identityModel: 'User' | 'Admin'; role: string };

export interface LogContext {
  requestId: string;
  actor: Actor;
  errorCode?: string;
}

export const logContext = new AsyncLocalStorage<LogContext>();

/** Call only after the existing authentication policy has verified credentials. */
export const setVerifiedActor = (actor: Actor): void => {
  const context = logContext.getStore();
  if (context) context.actor = actor;
};
