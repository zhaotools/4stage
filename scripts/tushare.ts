const API_URL = "https://api.tushare.pro";

interface TushareResponse {
  code: number;
  msg: string;
  data?: { fields: string[]; items: unknown[][] };
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class TushareClient {
  private readonly interval: number;
  private lastRequestAt = 0;

  constructor(private readonly token: string) {
    this.interval = Number(process.env.TUSHARE_REQUEST_INTERVAL_MS ?? 1250);
  }

  async query(
    apiName: string,
    params: Record<string, string | number | undefined>,
    fields: string[],
  ): Promise<Record<string, unknown>[]> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.interval) await wait(this.interval - elapsed);
    this.lastRequestAt = Date.now();

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_name: apiName,
        token: this.token,
        params: Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)),
        fields: fields.join(","),
      }),
    });

    if (!response.ok) throw new Error(`Tushare HTTP ${response.status}: ${apiName}`);
    const payload = (await response.json()) as TushareResponse;
    if (payload.code !== 0 || !payload.data) {
      throw new Error(`Tushare ${apiName} failed (${payload.code}): ${payload.msg}`);
    }

    return payload.data.items.map((item) =>
      Object.fromEntries(payload.data!.fields.map((field, index) => [field, item[index]])),
    );
  }
}
