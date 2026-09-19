/**
 * Vercel serverless entry point.
 *
 * This catch-all function serves the whole API: `/api/bootstrap`,
 * `/api/reports/:id`, and so on all land here and are dispatched by the route
 * table in `_lib/routes.ts`. The same router backs `npm run dev:api`, so the
 * local and deployed behaviour cannot drift.
 *
 * Vercel's Node runtime parses JSON bodies for us when the content type says so;
 * anything else is read off the stream.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { API_HEADERS, buildApiRequest } from "./_lib/http";
import { routeRequest } from "./_lib/routes";

interface VercelRequest extends IncomingMessage {
  body?: unknown;
}

async function readStreamBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  if (chunks.length === 0) return null;

  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Leave malformed JSON as text so the router answers with a 400.
    return text;
  }
}

async function resolveBody(req: VercelRequest): Promise<unknown> {
  const body = req.body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (body !== undefined) return body;
  return readStreamBody(req);
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  const body = await resolveBody(req);
  const apiRequest = buildApiRequest({
    method: req.method,
    url: req.url,
    headers: req.headers,
    body,
  });

  const { status, payload } = await routeRequest(apiRequest);

  res.statusCode = status;
  for (const [name, value] of Object.entries(API_HEADERS)) {
    res.setHeader(name, value);
  }
  res.end(JSON.stringify(payload));
}
