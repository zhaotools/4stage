import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface ConfigAsset { symbol: string; name: string; providerSymbol?: string }

async function config(name: string) {
  return JSON.parse(await readFile(new URL(`../config/${name}.json`, import.meta.url), "utf8")) as ConfigAsset[];
}

describe("first expansion universe", () => {
  it("contains unique, well-formed ETF and index symbols", async () => {
    const assets = [...await config("etfs"), ...await config("indexes")];
    expect(assets.length).toBe(50);
    expect(new Set(assets.map((asset) => asset.symbol)).size).toBe(assets.length);
    expect(assets.every((asset) => /^\d{6}\.(SH|SZ)$/.test(asset.symbol))).toBe(true);
    expect(assets.every((asset) => asset.name.length > 0)).toBe(true);
  });

  it("contains the requested crypto and crypto-stock universe", async () => {
    const crypto = await config("crypto");
    const cryptoStocks = await config("crypto-stocks");
    const assets = [...crypto, ...cryptoStocks];
    expect(assets.map((asset) => asset.symbol)).toEqual([
      "BTC-USD", "ETH-USD", "HYPE-USD", "MSTR", "CRCL", "HOOD", "COIN",
    ]);
    expect(new Set(assets.map((asset) => asset.symbol)).size).toBe(7);
    expect(assets.every((asset) => asset.name.length > 0 && asset.providerSymbol)).toBe(true);
  });

  it("contains the first high-liquidity US stock and ETF universe", async () => {
    const stocks = await config("us-stocks");
    const etfs = await config("us-etfs");
    const assets = [...stocks, ...etfs];
    expect(stocks).toHaveLength(22);
    expect(etfs).toHaveLength(18);
    expect(new Set(assets.map((asset) => asset.symbol)).size).toBe(40);
    expect(assets.every((asset) => /^[A-Z]+$/.test(asset.symbol))).toBe(true);
    expect(assets.every((asset) => asset.name.length > 0 && asset.providerSymbol === asset.symbol)).toBe(true);
  });
});
