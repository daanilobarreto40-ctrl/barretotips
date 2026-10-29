// Servidor sem dependências (Node 18+). Serve o site e faz proxy das APIs,
// assim as chaves ficam no servidor e o navegador não tem problema de CORS.
//
// Uso:
//   NVIDIA_API_KEY=nvapi-... node server.js
// (Windows PowerShell: $env:NVIDIA_API_KEY="..."; node server.js)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const NVIDIA_KEY = process.env.NVIDIA_API_KEY || "";
const FOOTBALL_KEY = process.env.APIFOOTBALL_KEY || "";
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type + "; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

http
  .createServer(async (req, res) => {
    try {
      // Proxy Sofascore (dados) e imagens (escudos e logos)
      if (req.url.startsWith("/api/sofa/") || req.url.startsWith("/api/sofa-img/")) {
        const isImg = req.url.startsWith("/api/sofa-img/");
        const rest = req.url.slice(isImg ? "/api/sofa-img/".length : "/api/sofa/".length);
        const r = await fetch("https://api.sofascore.com/api/v1/" + rest, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Referer: "https://www.sofascore.com/",
            Origin: "https://www.sofascore.com",
            Accept: isImg ? "image/*" : "application/json",
          },
        });
        if (isImg) {
          res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "image/png", "Cache-Control": "public, max-age=86400" });
          return res.end(Buffer.from(await r.arrayBuffer()));
        }
        return send(res, r.status, await r.text());
      }

      // Proxy API-Football (não é mais usado pelo site)
      if (req.url.startsWith("/api/football/")) {
        if (!FOOTBALL_KEY) return send(res, 500, JSON.stringify({ errors: { key: "APIFOOTBALL_KEY não definida" } }));
        const target = "https://v3.football.api-sports.io/" + req.url.slice("/api/football/".length);
        const r = await fetch(target, { headers: { "x-apisports-key": FOOTBALL_KEY } });
        return send(res, r.status, await r.text());
      }

      // Proxy NVIDIA (IA)
      if (req.url === "/api/ai" && req.method === "POST") {
        if (!NVIDIA_KEY) return send(res, 500, JSON.stringify({ error: "NVIDIA_API_KEY não definida" }));
        const { prompt } = JSON.parse(await readBody(req));
        const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + NVIDIA_KEY },
          body: JSON.stringify({
            model: NVIDIA_MODEL,
            temperature: 0.3,
            max_tokens: 900,
            messages: [
              { role: "system", content: "Você é um analista esportivo. Responda SOMENTE com JSON válido, em português." },
              { role: "user", content: prompt },
            ],
          }),
        });
        return send(res, r.status, await r.text());
      }

      // Arquivos estáticos
      const file = req.url === "/" ? "index.html" : req.url.split("?")[0].replace(/^\/+/, "");
      const full = path.join(__dirname, file);
      if (!full.startsWith(__dirname) || !TYPES[path.extname(full)] || !fs.existsSync(full)) {
        return send(res, 404, "Não encontrado", "text/plain");
      }
      send(res, 200, fs.readFileSync(full), TYPES[path.extname(full)]);
    } catch (e) {
      send(res, 500, JSON.stringify({ error: String(e) }));
    }
  })
  .listen(PORT, () => console.log("Site em http://localhost:" + PORT));
