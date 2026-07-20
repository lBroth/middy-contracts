/** RFC 9457 Problem Details object (application/problem+json). */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly [extension: string]: unknown;
}

/** Input to problem(). Unknown properties are kept as RFC 9457 extension members. */
export interface ProblemInit extends Record<string, unknown> {
  readonly status: number;
  readonly title: string;
  readonly type?: string;
  readonly detail?: string;
  readonly instance?: string;
}

/** Build a Problem Details object. `type` defaults to "about:blank" per RFC 9457 §3.1.1. */
export function problem(init: ProblemInit): ProblemDetails {
  const { type = "about:blank", ...rest } = init;
  return { type, ...rest };
}

export interface ProblemDetailsHandlerOptions {
  /** Map an error to a Problem Details object. Return undefined to use the default mapping. */
  readonly mapError?: (error: unknown) => ProblemDetails | undefined;
  /**
   * Include the message of unexpected (non-HTTP) errors as `detail` on the
   * 500 response. Default false: unexpected errors stay opaque to clients.
   */
  readonly exposeInternalErrors?: boolean;
}

interface MiddyLikeRequest {
  response?: unknown;
  error?: unknown;
}

/**
 * Middy onError middleware: converts any thrown error into an RFC 9457
 * application/problem+json response.
 *
 * Errors following the http-errors convention (numeric statusCode, expose
 * flag) keep their status and their message as `detail` when expose is true
 * — per that convention, expose defaults to true for 4xx and false for 5xx
 * when absent.
 *
 * Errors carrying a ready-made Problem Details object on a `problem`
 * property (build one with `problem()`) are emitted as-is when well-formed
 * (string title, integer status 400-599), extension members included;
 * malformed ones fall through to the default mapping. `mapError` takes
 * precedence over a carried problem.
 *
 * A response already set by an earlier onError middleware is left untouched.
 */
export function problemDetailsHandler(options: ProblemDetailsHandlerOptions = {}) {
  return {
    onError(request: MiddyLikeRequest): void {
      if (request.response !== undefined) return;
      const mapped = options.mapError?.(request.error) ?? carriedProblem(request.error);
      const body = mapped ?? defaultProblem(request.error, options.exposeInternalErrors ?? false);
      request.response = {
        statusCode: body.status,
        headers: { "Content-Type": "application/problem+json" },
        body: safeStringify(body),
      };
    },
  };
}

/**
 * Extension members are caller-controlled and may not be serializable
 * (BigInt, circular refs, throwing toJSON). The error middleware must never
 * throw on its own error path: fall back to the validated core members.
 */
function safeStringify(body: ProblemDetails): string {
  try {
    return JSON.stringify(body);
  } catch {
    return JSON.stringify({
      type: typeof body.type === "string" ? body.type : "about:blank",
      title: String(body.title),
      status: body.status,
    });
  }
}

/**
 * HTTP status phrases for every error code in the IANA registry. RFC 9457
 * §4.2.1: when `type` is "about:blank", the title SHOULD be the status phrase,
 * so this table must stay exhaustive over 400-599 rather than covering only
 * the common codes. Unregistered codes (499, vendor 5xx) fall back to "Error".
 */
const STATUS_TITLES: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Content",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
};

function defaultProblem(error: unknown, exposeInternalErrors: boolean): ProblemDetails {
  const httpError = asHttpError(error);
  if (httpError) {
    return problem({
      status: httpError.statusCode,
      title: STATUS_TITLES[httpError.statusCode] ?? "Error",
      ...(httpError.expose && httpError.message !== undefined
        ? { detail: httpError.message }
        : {}),
    });
  }
  const detail =
    exposeInternalErrors && error instanceof Error ? { detail: error.message } : {};
  return problem({
    status: 500,
    title: STATUS_TITLES[500] ?? "Internal Server Error",
    ...detail,
  });
}

/**
 * Errors may carry a ready-made Problem Details object on a `problem`
 * property. This is an error path: only well-formed error statuses are
 * trusted, anything else falls through to the safe default mapping.
 */
function carriedProblem(error: unknown): ProblemDetails | undefined {
  if (typeof error !== "object" || error === null || !("problem" in error)) return undefined;
  const candidate = (error as { problem?: unknown }).problem;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const { status, title } = candidate as { status?: unknown; title?: unknown };
  if (typeof title !== "string") return undefined;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599) {
    return undefined;
  }
  // Copy onto a fresh plain object: drops any (own or inherited) toJSON that
  // would otherwise control serialization, and applies the type default.
  const { toJSON: _ignored, ...members } = candidate as Record<string, unknown>;
  return { type: "about:blank", ...members } as ProblemDetails;
}

interface HttpErrorLike {
  readonly statusCode: number;
  readonly expose: boolean;
  readonly message?: string;
}

function asHttpError(error: unknown): HttpErrorLike | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { statusCode?: unknown; expose?: unknown; message?: unknown };
  const statusCode = candidate.statusCode;
  if (typeof statusCode !== "number" || !Number.isInteger(statusCode)) return undefined;
  if (statusCode < 400 || statusCode > 599) return undefined;
  return {
    statusCode,
    // http-errors convention: 4xx expose by default, 5xx never.
    expose: typeof candidate.expose === "boolean" ? candidate.expose : statusCode < 500,
    ...(typeof candidate.message === "string" ? { message: candidate.message } : {}),
  };
}
