// Thin HTTP client for the running Orbit server. Every request is tagged as coming from Claude,
// so the board shows Claude's changes live and history attributes them correctly.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class OrbitError extends Error {}

export class OrbitClient {
  constructor(
    readonly baseUrl = process.env.ORBIT_URL ?? "http://127.0.0.1:4700",
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api${path}`, {
        method,
        headers: { "content-type": "application/json", "x-orbit-actor": "claude" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new OrbitError(`Orbit isn't reachable at ${this.baseUrl}. Start it with: systemctl --user start orbit`);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new OrbitError(data.error ?? `Orbit returned ${res.status}`);
    return data as T;
  }

  get = <T>(path: string) => this.request<T>("GET", path);
  post = <T>(path: string, body?: unknown) => this.request<T>("POST", path, body ?? {});
  patch = <T>(path: string, body: unknown) => this.request<T>("PATCH", path, body);
}
