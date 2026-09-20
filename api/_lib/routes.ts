/**
 * Router.
 *
 * A small explicit table rather than a framework: the API has a fixed, documented
 * surface, and keeping the table flat makes it trivial to audit which role may
 * call what. Dispatch is a pure function of the request and the configuration,
 * so the whole API can be exercised from a test without a network listener.
 */

// Relative imports carry explicit `.js` extensions: Vercel compiles these files
// to ES modules, and Node's ESM resolver requires the extension on a compiled
// path. See the note in `api/[...path].ts`.
import { resolveActor, resolveOptionalActor } from "./auth.js";
import { readConfig, type ApiConfig } from "./config.js";
import { HttpError, type ApiRequest, type RequestContext, type RouteHandler } from "./http.js";
import { DuplicateIdError, getRepository } from "./repo/index.js";
import * as services from "./services.js";

interface RouteDefinition {
  method: string;
  pattern: string;
  handler: RouteHandler;
  /**
   * Answers before authentication. A public route receives `ANONYMOUS_ACTOR`
   * instead of a role, so it can report the API's state without holding a
   * credential — and cannot accidentally be authorised as a staff member.
   */
  public?: boolean;
}

const ROUTES: RouteDefinition[] = [
  { method: "GET", pattern: "/health", handler: services.handleHealth, public: true },
  { method: "GET", pattern: "/bootstrap", handler: services.handleBootstrap },
  // Public so the demo sign-in screen can list the seeded identities; the
  // handler itself refuses unless the API is serving the seeded dataset.
  { method: "GET", pattern: "/demo/profiles", handler: services.handleDemoProfiles, public: true },
  { method: "POST", pattern: "/demo/reset", handler: services.handleResetDemo },

  { method: "POST", pattern: "/hospitals", handler: services.handleCreateHospital },
  { method: "PATCH", pattern: "/hospitals/:id", handler: services.handlePatchHospital },

  { method: "POST", pattern: "/patients", handler: services.handleRegisterPatient },
  { method: "PATCH", pattern: "/patients/:id", handler: services.handlePatchPatient },

  { method: "POST", pattern: "/appointments", handler: services.handleCreateAppointment },
  { method: "PATCH", pattern: "/appointments/:id", handler: services.handlePatchAppointment },

  { method: "POST", pattern: "/treatments", handler: services.handleCreateTreatment },
  { method: "PATCH", pattern: "/administrations/:id", handler: services.handlePatchAdministration },
  { method: "POST", pattern: "/vitals", handler: services.handleCreateVitals },

  { method: "POST", pattern: "/invoices", handler: services.handleCreateInvoice },
  { method: "POST", pattern: "/invoices/:id/payments", handler: services.handleCollectPayment },

  { method: "POST", pattern: "/reports", handler: services.handleCreateReport },
  { method: "PATCH", pattern: "/reports/:id", handler: services.handlePatchReport },
  { method: "POST", pattern: "/inquiries", handler: services.handlePatientInquiry },

  { method: "POST", pattern: "/transfers/:id/decision", handler: services.handleDecideTransfer },
  { method: "POST", pattern: "/alerts/:id/acknowledge", handler: services.handleAcknowledgeAlert },
];

interface CompiledRoute extends RouteDefinition {
  regex: RegExp;
  names: string[];
}

function compile(route: RouteDefinition): CompiledRoute {
  const names: string[] = [];
  const source = route.pattern.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_match, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { ...route, regex: new RegExp(`^${source}$`), names };
}

const COMPILED: CompiledRoute[] = ROUTES.map(compile);

interface MatchedRoute {
  route: CompiledRoute;
  params: Record<string, string>;
}

function matchRoute(method: string, path: string): MatchedRoute | null {
  let pathMatchedButMethodDidNot = false;

  for (const route of COMPILED) {
    const match = route.regex.exec(path);
    if (!match) continue;
    if (route.method !== method) {
      pathMatchedButMethodDidNot = true;
      continue;
    }

    const params: Record<string, string> = {};
    route.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });
    return { route, params };
  }

  if (pathMatchedButMethodDidNot) {
    throw new HttpError(405, "method_not_allowed", `${method} is not supported on ${path}.`);
  }
  return null;
}

/** The response envelope documented in `docs/api-reference.md`. */
export interface RoutedResponse {
  status: number;
  payload: unknown;
}

function success(status: number, data: unknown): RoutedResponse {
  return { status, payload: { success: true, data } };
}

function failure(status: number, code: string, message: string, requestId: string): RoutedResponse {
  return { status, payload: { success: false, error: { code, message, requestId } } };
}

/**
 * Authenticate, authorise, and execute one request.
 *
 * Health is the only endpoint that answers before authentication, so a
 * misconfigured deploy reports its problem instead of a generic 401.
 */
export async function routeRequest(req: ApiRequest, config?: ApiConfig): Promise<RoutedResponse> {
  let resolved: ApiConfig;
  try {
    resolved = config ?? readConfig();
  } catch (error) {
    console.error("[smartmedic] configuration error", error);
    const message = error instanceof Error ? error.message : "Configuration error.";
    return failure(503, "not_configured", message, req.requestId);
  }

  try {
    const matched = matchRoute(req.method, req.path);
    if (!matched) {
      throw new HttpError(404, "not_found", `No route for ${req.method} ${req.path}.`);
    }

    const repo = getRepository(resolved);
    const actor = matched.route.public
      ? await resolveOptionalActor(req, resolved, repo)
      : await resolveActor(req, resolved, repo);
    const ctx: RequestContext = {
      config: resolved,
      repo,
      req,
      params: matched.params,
      actor,
      actorRef: { id: actor.id, name: actor.fullName, role: actor.role },
    };

    const result = await matched.route.handler(ctx);
    return success(result.status, result.body);
  } catch (error) {
    if (error instanceof HttpError) {
      return failure(error.status, error.code, error.message, req.requestId);
    }
    if (error instanceof DuplicateIdError) {
      // The client's snapshot is stale; it re-bootstraps on this code.
      return failure(409, "duplicate_id", error.message, req.requestId);
    }

    console.error(`[smartmedic] unhandled error on ${req.method} ${req.path}`, error);
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return failure(500, "internal_error", message, req.requestId);
  }
}

/** Exposed so the entry points and tests can assert the surface. */
export const API_ROUTES = ROUTES.map((route) => `${route.method} /api${route.pattern}`);
