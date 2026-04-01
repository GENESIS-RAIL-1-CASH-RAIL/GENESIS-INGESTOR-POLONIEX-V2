// src/bootstrap.ts — SF-Grade v2.0.0-sf Ingestor: POLONIEX_V2 (DEX)
import fetch from "node-fetch";
import express from "express";
import { randomUUID } from "crypto";
import { CONFIG } from "./config";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 60_000;
let lastPairs: string[] = [];
let lastPriceCount = 0;
let pollCount = 0;
let lastPollTs = 0;
let lastError = "";
let consecutiveFailures = 0;
let lastPollDurationMs = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const priceBook: Record<string, { bid: number; ask: number; ts: number }> = {};

function normalizePair(raw: string): string { return raw.replace(/[-_/:. ]/g, "").toUpperCase(); }
function cleanPriceBook(): void { const c = Date.now() - POLL_INTERVAL_MS * 5; for (const k of Object.keys(priceBook)) { if (priceBook[k].ts < c) delete priceBook[k]; } }
function getHealthStatus(): string { if (consecutiveFailures >= 5) return "critical"; if (consecutiveFailures >= 3) return "degraded"; if (lastError) return "warn"; return "ok"; }

function extractPairs(json: any): string[] {
  if (Array.isArray(json)) return json.map((i: any) => i.symbol||i.pair||i.name||i.market||i.instrument_id||i.trading_pair||i.instrument_name||i.id||"").filter((s: string)=>s.length>0).map(normalizePair);
  if (json.symbols && Array.isArray(json.symbols)) return json.symbols.filter((s: any)=>typeof s==="string"||typeof s.symbol==="string"||typeof s.name==="string").map((s: any)=>normalizePair(typeof s==="string"?s:(s.symbol||s.name)));
  if (json.data && Array.isArray(json.data)) return json.data.map((i: any)=>i.symbol||i.pair||i.name||i.market||i.instrument_name||"").filter((s: string)=>s.length>0).map(normalizePair);
  if (json.result && Array.isArray(json.result)) return json.result.map((i: any)=>i.symbol||i.pair||i.name||i.market||"").filter((s: string)=>s.length>0).map(normalizePair);
  if (json.pools && Array.isArray(json.pools)) return json.pools.map((p: any)=>p.pair||p.symbol||p.name||`${p.token0?.symbol||"?"}/${p.token1?.symbol||"?"}`).filter((s: string)=>s.length>0&&!s.includes("?")).map(normalizePair);
  if (json.pairs && Array.isArray(json.pairs)) return json.pairs.map((p: any)=>p.pair||p.symbol||p.name||`${p.token0?.symbol||p.baseToken?.symbol||"?"}/${p.token1?.symbol||p.quoteToken?.symbol||"?"}`).filter((s: string)=>s.length>0&&!s.includes("?")).map(normalizePair);
  if (json.tokens && Array.isArray(json.tokens)) return json.tokens.map((t: any)=>t.symbol||t.name||t.address||"").filter((s: string)=>s.length>0).map(normalizePair);
  if (json.markets && Array.isArray(json.markets)) return json.markets.map((m: any)=>m.symbol||m.pair||m.name||m.market||"").filter((s: string)=>s.length>0).map(normalizePair);
  if (typeof json==="object"&&!Array.isArray(json)){const k=Object.keys(json).filter(k=>!["success","code","message","msg","status","error","total","page","count"].includes(k));if(k.length>5)return k.map(normalizePair);}
  return [];
}

function extractPrices(json: any): Record<string, { bid: number; ask: number; ts: number }> {
  const prices: Record<string,{bid:number;ask:number;ts:number}>={};
  const now=Date.now();
  const items=Array.isArray(json)?json:(json.data||json.result||json.tickers||json.pools||json.pairs||json.markets||json.tokens||[]);
  if(Array.isArray(items)){for(const t of items){const sym=t.symbol||t.pair||t.name||t.market||t.instrument_name||"";const bid=parseFloat(t.bidPrice||t.bid||t.best_bid||t.buy||t.highestBid||t.price||t.lastPrice||"0");const ask=parseFloat(t.askPrice||t.ask||t.best_ask||t.sell||t.lowestAsk||t.price||t.lastPrice||"0");if(sym&&!isNaN(bid)&&!isNaN(ask)&&isFinite(bid)&&isFinite(ask)&&bid>0&&ask>0){const n=normalizePair(sym);prices[n]={bid,ask,ts:now};priceBook[n]={bid,ask,ts:now};}}}
  else if(typeof items==="object"){for(const[key,val] of Object.entries(items as Record<string,any>)){if(!val||typeof val!=="object")continue;const bid=parseFloat(val.bid||val.buy||val.highestBid||val.price||"0");const ask=parseFloat(val.ask||val.sell||val.lowestAsk||val.price||"0");if(!isNaN(bid)&&!isNaN(ask)&&isFinite(bid)&&isFinite(ask)&&bid>0&&ask>0){const n=normalizePair(key);prices[n]={bid,ask,ts:now};priceBook[n]={bid,ask,ts:now};}}}
  return prices;
}

async function poll(): Promise<void> {
  const pollStart=Date.now();
  try{
    console.log(`[${CONFIG.EXCHANGE}] Poll #${pollCount+1} starting...`);
    cleanPriceBook();
    const res=await fetch(CONFIG.API_URL,{headers:{"Accept":"application/json","User-Agent":"Genesis-Ingestor/2.0"},signal:AbortSignal.timeout(CONFIG.FETCH_TIMEOUT_MS) as any});
    if(res.status===429){console.warn(`[${CONFIG.EXCHANGE}] Rate limited (429)`);consecutiveFailures++;lastPollDurationMs=Date.now()-pollStart;return;}
    if(!res.ok)throw new Error(`API returned ${res.status}: ${res.statusText}`);
    const json:any=await res.json();
    const pairs=extractPairs(json);
    const prices=extractPrices(json);
    lastPairs=pairs;lastPriceCount=Object.keys(prices).length;pollCount++;lastPollTs=Date.now();lastPollDurationMs=Date.now()-pollStart;
    console.log(`[${CONFIG.EXCHANGE}] Poll #${pollCount} — ${pairs.length} pairs, ${lastPriceCount} prices (${lastPollDurationMs}ms)`);
    const evt={eventId:randomUUID(),eventType:"OPPORTUNITY_OBSERVATION",source:CONFIG.SOURCE,timestamp:new Date().toISOString(),payload:{exchange:CONFIG.EXCHANGE,type:CONFIG.TYPE,pairCount:pairs.length,pairs,prices}};
    const gateRes=await fetch(CONFIG.INGESTION_GATE_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(evt),signal:AbortSignal.timeout(CONFIG.FETCH_TIMEOUT_MS) as any});
    if(!gateRes.ok){const b=await gateRes.text();console.error(`[${CONFIG.EXCHANGE}] Gate ${gateRes.status}: ${b.slice(0,200)}`);}
    else console.log(`[${CONFIG.EXCHANGE}] Forwarded to Ingestion Gate`);
    lastError="";consecutiveFailures=0;
  }catch(err){consecutiveFailures++;lastError=(err as Error).message;lastPollDurationMs=Date.now()-pollStart;console.error(`[${CONFIG.EXCHANGE}] Poll error (${consecutiveFailures}): ${lastError}`);}
}

const app=express();
app.get("/health",(_req,res)=>{res.json({service:CONFIG.SERVICE_NAME,version:CONFIG.VERSION,type:CONFIG.TYPE,status:getHealthStatus(),exchange:CONFIG.EXCHANGE,chain:CONFIG.CHAIN,port:CONFIG.PORT,pollCount,lastPollTs,lastPollDurationMs,pairCount:lastPairs.length,priceCount:lastPriceCount,priceBookSize:Object.keys(priceBook).length,consecutiveFailures,lastError:lastError||null,uptime:process.uptime()});});
app.get("/pairs",(_req,res)=>{res.json({exchange:CONFIG.EXCHANGE,chain:CONFIG.CHAIN,pairs:lastPairs,count:lastPairs.length});});
app.get("/prices",(_req,res)=>{res.json({exchange:CONFIG.EXCHANGE,chain:CONFIG.CHAIN,prices:priceBook,count:Object.keys(priceBook).length});});
function shutdown(s:string){console.log(`[${CONFIG.EXCHANGE}] ${s} — shutting down`);if(pollTimer)clearInterval(pollTimer);process.exit(0);}
process.on("SIGTERM",()=>shutdown("SIGTERM"));process.on("SIGINT",()=>shutdown("SIGINT"));
app.listen(CONFIG.PORT,"0.0.0.0",()=>{console.log(`[${CONFIG.EXCHANGE}] v${CONFIG.VERSION} (DEX/${CONFIG.CHAIN}) on port ${CONFIG.PORT}`);poll();pollTimer=setInterval(poll,POLL_INTERVAL_MS);});
