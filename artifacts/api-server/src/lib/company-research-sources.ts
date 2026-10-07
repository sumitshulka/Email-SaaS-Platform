import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import sanitizeHtml from "sanitize-html";
import type { IntelligenceSource } from "./company-intelligence-schema";

export type SourceCandidate = { url: string; title?: string };
export type ResearchEvidence = { source: IntelligenceSource; text: string };

export function isPublicResearchAddress(address: string): boolean {
  const ip = address.toLowerCase().split("%")[0]!;
  if (ip.startsWith("::ffff:")) return isPublicResearchAddress(ip.slice(7));
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a! >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(ip) === 6) {
    const first = Number.parseInt(ip.split(":")[0]!, 16);
    return first >= 0x2000 && first <= 0x3fff && !/^(?:2002:|2001:(?:0:|db8:|10:|20:))/.test(ip); // No local, tunnelling or documentation ranges.
  }
  return false;
}

export function researchUrl(raw: string): URL {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || raw.length > 2048 ||
    (url.port && !["80", "443"].includes(url.port)) || !url.hostname.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)) throw new Error("Only public web URLs can be researched.");
  url.hash = "";
  return url;
}

async function downloadPage(raw: string, redirects = 0, deadline = Date.now() + 30_000): Promise<{ url: string; html: string }> {
  if (Date.now() >= deadline) throw new Error("The evidence collection time budget has expired.");
  const url = researchUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error("Source DNS lookup timed out.")), Math.max(1, Math.min(8000, deadline - Date.now()))); dnsTimer.unref(); }),
  ]).finally(() => { if (dnsTimer) clearTimeout(dnsTimer); });
  if (!addresses.length || addresses.some(item => !isPublicResearchAddress(item.address))) throw new Error("The source is not a public web host.");
  const pinned = addresses.find(item => item.family === 4) ?? addresses[0]!;
  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => callback(null, pinned.address, pinned.family);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      agent: false, lookup: pinnedLookup, family: pinned.family,
      maxHeaderSize: 16_384, signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, deadline - Date.now()))),
      headers: { "User-Agent": "MailflowCompanyResearch/1.0", Accept: "text/html,text/plain" },
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects >= 3) { reject(new Error("Too many source redirects.")); return; }
        void downloadPage(new URL(response.headers.location, url).toString(), redirects + 1, deadline).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300 || !/text\/(?:html|plain)|application\/xhtml/.test(response.headers["content-type"] ?? "")) {
        response.resume(); reject(new Error("The source does not provide a readable public page.")); return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1_000_000) { req.destroy(new Error("The source page is too large.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ url: url.toString(), html: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    req.setTimeout(12_000, () => req.destroy(new Error("The source timed out.")));
    req.on("error", reject);
    req.end();
  });
}

function clean(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}
function sourceKind(url: URL, officialDomain: string | null): IntelligenceSource["source_type"] {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (officialDomain && (host === officialDomain || host.endsWith(`.${officialDomain}`))) {
    if (/news|press|media|release/i.test(url.pathname)) return "company_newsroom";
    if (/investor|annual-report|financial/i.test(url.pathname)) return "investor_relation";
    if (/product|service|solution/i.test(url.pathname)) return "company_product_page";
    return "company_website";
  }
  if (host === "sec.gov" || /filing|registry|register/i.test(url.pathname) && /\.gov(?:\.[a-z]{2})?$/.test(host)) return "regulatory_filing";
  if (/\.gov(?:\.[a-z]{2})?$/.test(host)) return "government";
  if (/(?:^|\.)(?:reuters\.com|apnews\.com|bbc\.com|bloomberg\.com|ft\.com|wsj\.com|businesswire\.com|prnewswire\.com)$/.test(host)) return "reputable_news";
  if (/(?:^|\.)(?:computerweekly\.com|cio\.com|gartner\.com|idc\.com|manufacturing\.net|industryweek\.com|supplychaindive\.com|retaildive\.com|healthcaredive\.com|crunchbase\.com)$/.test(host)) return "industry_source";
  return "other";
}

export async function collectCompanyEvidence(input: {
  officialUrl: string | null; candidates: SourceCandidate[]; allowedSourceTypes: readonly string[]; maxPages: number;
}): Promise<ResearchEvidence[]> {
  const evidence: ResearchEvidence[] = [];
  const deadline = Date.now() + 90_000;
  const queue: SourceCandidate[] = input.officialUrl ? [{ url: input.officialUrl }, ...input.candidates] : [...input.candidates];
  const attempted = new Set<string>();
  const saved = new Set<string>();
  const officialDomain = input.officialUrl ? researchUrl(input.officialUrl).hostname.toLowerCase().replace(/^www\./, "") : null;
  for (let index = 0; index < queue.length && evidence.length < input.maxPages && attempted.size < input.maxPages * 2 && Date.now() < deadline; index += 1) {
    const candidate = queue[index]!;
    let canonical: string;
    try { canonical = researchUrl(candidate.url).toString(); } catch { continue; }
    if (attempted.has(canonical)) continue;
    attempted.add(canonical);
    try {
      const page = await downloadPage(canonical, 0, deadline);
      if (saved.has(page.url)) continue;
      const url = new URL(page.url);
      const kind = sourceKind(url, officialDomain);
      if (!input.allowedSourceTypes.includes(kind)) continue;
      const text = clean(page.html.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " "));
      if (text.length < 150) continue;
      const title = clean(page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? candidate.title ?? url.hostname).slice(0, 500);
      const published = page.html.match(/(?:datePublished["']?\s*:\s*["']|(?:article:published_time|datePublished)["'][^>]*content=["'])(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
      const validDate = published && !Number.isNaN(Date.parse(`${published}T00:00:00Z`)) ? published : null;
      const source: IntelligenceSource = {
        source_id: `SRC-${String(evidence.length + 1).padStart(3, "0")}`, source_type: kind,
        title: title || url.hostname, url: page.url, publisher: url.hostname,
        published_date: validDate, accessed_at: new Date().toISOString(),
        reliability: ["company_website", "company_product_page", "company_newsroom", "investor_relation", "government", "regulatory_filing"].includes(kind) ? "high" : kind === "reputable_news" || kind === "industry_source" ? "medium" : "low",
      };
      evidence.push({ source, text: text.slice(0, 12_000) });
      saved.add(page.url);
      if (officialDomain && url.hostname.replace(/^www\./, "") === officialDomain) {
        const related = [...page.html.matchAll(/href=["']([^"'#]+)["']/gi)].flatMap(match => {
          try {
            const linked = new URL(match[1]!, url);
            return linked.hostname === url.hostname && /about|product|service|solution|news|press|investor/i.test(linked.pathname) ? [{ url: linked.toString() }] : [];
          } catch { return []; }
        }).slice(0, 10);
        queue.splice(index + 1, 0, ...related);
      }
    } catch { /* One inaccessible source must not erase usable evidence from others. */ }
  }
  if (!evidence.length) throw new Error("No readable evidence could be retrieved from the allowed public sources. Check the company website and source settings, then retry.");
  return evidence;
}
