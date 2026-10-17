/**
 * Caelia Brain Gateway — integration scaffold
 * Build: 2026-10-07
 * Rights: © 2026 Alicia Spears / Caelia Systems
 *
 * This is intentionally a small boundary service.
 * Do NOT put API keys or private certificates in this file.
 */

const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "https://motherboard.caeliasystems.com";

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

function requestId() {
  return crypto.randomUUID();
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });
    return res.end();
  }

  if (req.url === "/health" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      service: "caelia-brain-gateway",
      request_id: requestId(),
      build: "2026-10-07"
    });
  }

  if (req.url === "/api/avatar/intent" && req.method === "POST") {
    // Production implementation should:
    // 1. authenticate the caller
    // 2. validate the intent against an allowlist
    // 3. check Caelia/Alicia permission policy
    // 4. route to the brain
    // 5. return only the approved result
    return json(res, 501, {
      ok: false,
      error: "BRAIN_ROUTER_NOT_CONNECTED",
      message: "Connect this endpoint to the production Caelia permission and brain router."
    });
  }

  return json(res, 404, { ok: false, error: "NOT_FOUND" });
});

server.listen(PORT, () => {
  console.log(`Caelia Brain Gateway listening on ${PORT}`);
});
