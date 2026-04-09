export const CONFIG = {
  EXCHANGE: "POLONIEX_V2" as const,
  SOURCE: "poloniex-v2" as const,
  TYPE: "CEX" as const,
  CHAIN: "multi" as const,
  PORT: parseInt(process.env.PORT || "10491", 10),
  SERVICE_NAME: "GENESIS-INGESTOR-POLONIEX-V2",
  API_URL: "https://api.poloniex.com/markets/ticker24h", // API URL FIXED 2026-04-10 — was returning 400 Bad Request
  TICKER_URL: "",
  INGESTION_GATE_URL: process.env.INGESTION_GATE_URL || "http://genesis-ingestion-gate:8700/ingest",
  FETCH_TIMEOUT_MS: parseInt(process.env.FETCH_TIMEOUT_MS || "10000", 10),
  VERSION: "2.0.0-sf",
};
