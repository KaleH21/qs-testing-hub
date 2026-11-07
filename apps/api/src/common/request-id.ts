import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SAFE_ID = /^[\w-]{1,128}$/;

/** Giữ X-Request-Id client gửi nếu hợp lệ, không thì sinh mới (docs/05 §1) */
export function genRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}
