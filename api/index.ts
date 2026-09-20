/**
 * Vercel serverless entry point.
 *
 * This one function serves the whole API — `/api/bootstrap`, `/api/reports/:id`
 * and so on all land here and are dispatched by the route table in
 * `_lib/routes.ts`. The same router backs `npm run dev:api`, so the local and
 * deployed behaviour cannot drift.
 *
 * Three deployment details are load-bearing, and each one was learned the hard
 * way on this project:
 *
 *   1. The file is `api/index.ts` and `vercel.json` rewrites `/api/*` onto it.
 *      A catch-all such as `api/[...path].ts` is a *Next.js* feature: in a plain
 *      Vite project Vercel does not serve `/api/health` from a bracketed
 *      filename, so that layout deploys a function nothing can reach and every
 *      call answers with Vercel's own 404 page.
 *   2. Files and directories whose names begin with an underscore are ignored by
 *      Vercel, which is why the router and services live under `api/_lib/`
 *      without becoming functions of their own.
 *   3. Every relative import carries an explicit `.js` extension. The package is
 *      `"type": "module"`, so Vercel compiles these files to ES modules, and
 *      Node's ESM resolver requires the extension on a compiled `.js` path; the
 *      extensionless form works in Vite and throws `ERR_MODULE_NOT_FOUND` here.
 *
 * The rewrite names the matched route in `__route` rather than relying on the
 * request path surviving it, so routing does not depend on how the platform
 * passes the path through. See `ROUTE_PARAM` in `_lib/http.ts`.
 *
 * Vercel's Node runtime parses JSON bodies when the content type says so;
 * anything else is read off the stream.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { API_HEADERS, buildApiRequest } from "./_lib/http.js";
import { routeRequest } from "./_lib/routes.js";

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
