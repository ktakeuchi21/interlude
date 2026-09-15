export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", keepalive: body !== undefined });
  let result: unknown;
  try { result = await response.json(); }
  catch {
    throw new Error(body === undefined
      ? "Interlude could not load this response. Reopen the page to check your saved work."
      : "The server connection ended before the result was confirmed. Check Settings for saved results before starting another preparation.");
  }
  if (!response.ok) throw new Error(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "This request did not finish.");
  return result as T;
}
