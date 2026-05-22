import { io, type Socket } from 'socket.io-client';

export interface SubmissionUpdatedPayload {
  submissionId: string;
  formId?: string;
  currentLevel?: number;
  status?: string;
  action?: string;
  orgId?: string;
}

export interface WorkflowChangedPayload {
  formId: string;
  submissionId?: string;
  currentLevel?: number;
  status?: string;
  action?: string;
  orgId?: string;
}

let _socket: Socket | null = null;

/**
 * Lazily construct and return the shared Socket.IO client. Connects to the
 * same origin as the page (Vite dev proxy / IIS in prod both forward
 * /socket.io to the backend). Auto-reconnect is on by default.
 */
export function getSocket(): Socket {
  if (_socket) return _socket;

  _socket = io({
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });

  _socket.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log('[socket] connected', _socket?.id);
  });
  _socket.on('disconnect', (reason) => {
    // eslint-disable-next-line no-console
    console.log('[socket] disconnected', reason);
  });

  return _socket;
}

/** Subscribe to `submission-updated`. Returns an unsubscribe function. */
export function onSubmissionUpdated(
  handler: (payload: SubmissionUpdatedPayload) => void
): () => void {
  const s = getSocket();
  s.on('submission-updated', handler);
  return () => s.off('submission-updated', handler);
}

/** Subscribe to `workflow-changed`. Returns an unsubscribe function. */
export function onWorkflowChanged(
  handler: (payload: WorkflowChangedPayload) => void
): () => void {
  const s = getSocket();
  s.on('workflow-changed', handler);
  return () => s.off('workflow-changed', handler);
}
