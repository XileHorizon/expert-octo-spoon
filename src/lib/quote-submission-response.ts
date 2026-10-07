type QuoteSubmissionSuccess = {
  ok: true;
  requestId: string;
  pricingStatus: string;
};

type QuoteSubmissionFailure = {
  ok: false;
  error: string;
};

export type QuoteSubmissionResult = QuoteSubmissionSuccess | QuoteSubmissionFailure;

function errorObject(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null
    && typeof (value as { error?: unknown }).error === "string";
}

function successObject(value: unknown): value is { requestId: string; pricingStatus: string } {
  return typeof value === "object" && value !== null
    && typeof (value as { requestId?: unknown }).requestId === "string"
    && typeof (value as { pricingStatus?: unknown }).pricingStatus === "string";
}

function statusError(status: number, data: unknown, contactPrompt: string) {
  if (status === 413) {
    return `The hosting platform rejected this upload because the request is too large (status 413). Reduce the total file size and try again. ${contactPrompt}`;
  }
  if (status === 429) {
    return `The hosting platform is receiving too many requests (status 429). Wait a moment and try again. ${contactPrompt}`;
  }
  if ([502, 503, 504].includes(status)) {
    return `The hosting platform or print service is temporarily unavailable (status ${status}). Try again shortly. ${contactPrompt}`;
  }
  if (errorObject(data) && data.error.trim()) return data.error;
  if (status >= 500) {
    return `The print service could not process the request (status ${status}). Try again shortly. ${contactPrompt}`;
  }
  return `The request could not be submitted (status ${status}). Review the form and try again. ${contactPrompt}`;
}

/**
 * Reads a quote response as untrusted text so an HTML proxy error can never
 * surface a JSON parser exception or HTML content to the customer.
 */
export async function readQuoteSubmissionResponse(response: Response, contactPrompt: string): Promise<QuoteSubmissionResult> {
  const raw = await response.text();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : undefined;
  } catch {
    data = undefined;
  }

  if (!response.ok) return { ok: false, error: statusError(response.status, data, contactPrompt) };
  if (!successObject(data)) {
    return {
      ok: false,
      error: `The request reached the server, but it returned an unexpected response (status ${response.status}). Check whether the request arrived before trying again. ${contactPrompt}`,
    };
  }
  return { ok: true, requestId: data.requestId, pricingStatus: data.pricingStatus };
}
