// index.js — NovaDesk Bot (final)
// Modo DEV: polling | Modo PROD: webhook (Express en Azure)

require("dotenv").config();
const rateLimit = require("express-rate-limit");
const express = require("express");
const { Telegraf, Markup } = require("telegraf");

// (Opcional) persistencia si creaste db.js en Tema 3
let insertReserva, ultimasReservas;
try {
  ({ insertReserva, ultimasReservas } = require("./db"));
} catch {
  // Si no existe db.js, crea stubs inofensivos
  insertReserva = async (last_name, booking_number) => ({
    id: 0,
    last_name,
    booking_number,
    created_at: new Date().toISOString(),
  });
  ultimasReservas = async () => [];
}

// ====== Config ======
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ Falta BOT_TOKEN en variables de entorno");
  process.exit(1);
}

const NODE_ENV = (process.env.NODE_ENV || "development").trim();
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN?.trim();
const WEBHOOK_PATH = (process.env.WEBHOOK_PATH || "/telegram/webhook-123").trim();
const PORT = process.env.PORT || process.env.WEBSITES_PORT || 3000;

// ====== Bot ======
const bot = new Telegraf(token);

// Middleware de trazas (útil para ver qué llega)
bot.use(async (ctx, next) => {
  try {
    console.log("📩 update:", ctx.updateType);
  } catch {}
  return next();
});

// Menú principal
const menuPrincipal = Markup.inlineKeyboard([
  [Markup.button.callback("🛎️ Check-in", "CHECKIN")],
  [Markup.button.callback("ℹ️ Info del hotel", "INFO")],
  [Markup.button.callback("📞 Contacto", "CONTACTO")],
]);

bot.start((ctx) =>
  ctx.reply(
    "¡Bienvenido a NovaDesk! Soy tu recepción virtual.\nElige una opción:",
    menuPrincipal
  )
);

bot.action("CHECKIN", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Para iniciar pre check-in, envíame en un solo mensaje tu *apellido y número de reserva*, por ejemplo:\n\n`Pérez 12345`",
    { parse_mode: "Markdown" }
  );
});

bot.action("INFO", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Información del hotel:\n• Check-in: 15:00\n• Check-out: 12:00\n• Desayuno: 07:00–10:30\n• Wi-Fi: NovaDesk-Guest (clave: novadesk2025)"
  );
});

bot.action("CONTACTO", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Contacto recepción:\n• WhatsApp: +56 9 1234 5678\n• Email: recepcion@hotel-ejemplo.cl"
  );
});

// Comando admin para ver últimas reservas
bot.command("ultimas", async (ctx) => {
  try {
    const filas = await ultimasReservas(5);
    if (!filas.length) return ctx.reply("Aún no hay reservas registradas.");
    const txt = filas
      .map(
        (r) =>
          `#${r.id} — ${r.last_name} / ${r.booking_number} · ${new Date(
            r.created_at
          ).toLocaleString()}`
      )
      .join("\n");
    return ctx.reply(txt);
  } catch (e) {
    console.error("Error /ultimas:", e);
    return ctx.reply("⚠️ Error al consultar.");
  }
});

bot.command("admin", (ctx) =>
  ctx.reply("Panel: https://novadesk-app-hhh5cce5hretcgap.chilecentral-01.azurewebsites.net/admin")
);

// Captura 'Apellido Numero' y guarda
bot.on("text", async (ctx) => {
  const texto = (ctx.message?.text || "").trim();
  const m = texto.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+)\s+(\d{4,})$/);
  if (!m) return;

  const last_name = m[1].trim();
  const booking_number = m[2];

  try {
    const row = await insertReserva(last_name, booking_number);
    await ctx.reply(
      `✅ *Pre check-in registrado*\nApellido: *${row.last_name}*\nReserva: *${row.booking_number}*\nID: *${row.id}*`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("Error insertReserva:", e);
    await ctx.reply("⚠️ Error al registrar. Inténtalo otra vez.");
  }
});

// ====== Server (DEV/PROD) ======
if (NODE_ENV === "production") {
  const app = express();
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  
  // Logs y trazas HTTP
  console.log("✅ NODE_ENV:", NODE_ENV);
  console.log("✅ WEBHOOK_DOMAIN:", WEBHOOK_DOMAIN);
  console.log("✅ WEBHOOK_PATH:", JSON.stringify(WEBHOOK_PATH));

  // --- auth básica ---
  function basicAuth(req, res, next) {
    const b64 = (req.headers.authorization || "").split(" ")[1] || "";
    const [u, p] = Buffer.from(b64, "base64").toString().split(":");
    if (u === process.env.ADMIN_USER && p === process.env.ADMIN_PASS) return next();
    res.set("WWW-Authenticate", 'Basic realm="NovaDesk Admin"');
    return res.status(401).send("Auth required");
  }

  // Aplica limitador a rutas admin/api
  app.use(["/admin", "/api"], adminLimiter);

  // --- API: reservas con paginación ---
  app.get("/api/reservas", basicAuth, async (req, res) => {
    try {
      const page = Number(req.query.page || 1);
      const size = Number(req.query.size || 20);
      const [rows, total] = await Promise.all([
        listReservas(page, size),
        countReservas(),
      ]);
      res.json({ page, size, total, data: rows });
    } catch (e) {
      console.error("GET /api/reservas", e);
      res.status(500).json({ error: "db_error" });
    }
  });

  // --- API: export CSV ---
  app.get("/api/reservas.csv", basicAuth, async (req, res) => {
    try {
      const page = Number(req.query.page || 1);
      const size = Number(req.query.size || 100); // export un poco mayor
      const rows = await listReservas(page, size);
      const header = "id,last_name,booking_number,created_at";
      const lines = rows.map(
        (r) =>
          `${r.id},"${(r.last_name || "").replace(/"/g, '""')}",` +
          `"${(r.booking_number || "").replace(/"/g, '""')}",${r.created_at}`
      );
      const csv = [header, ...lines].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="reservas-p${page}-s${size}.csv"`
      );
      res.status(200).send(csv);
    } catch (e) {
      console.error("GET /api/reservas.csv", e);
      res.status(500).send("error");
    }
  });

  // --- API: borrar una reserva (demo) ---
  app.delete("/api/reservas/:id", basicAuth, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "bad_id" });
      const changes = await deleteReserva(id);
      res.json({ ok: true, deleted: changes });
    } catch (e) {
      console.error("DELETE /api/reservas/:id", e);
      res.status(500).json({ error: "db_error" });
    }
  });

  app.get("/admin", basicAuth, async (req, res) => {
    try {
      const page = Number(req.query.page || 1);
      const size = Number(req.query.size || 20);
      const [rows, total] = await Promise.all([
        listReservas(page, size),
        countReservas(),
      ]);
      const pages = Math.max(1, Math.ceil(total / size));

      const qs = (p) =>
        `/admin?page=${p}&size=${size}`;

      const pager =
        `<div class="pager">` +
        `<a href="${qs(Math.max(1, page - 1))}">&laquo; Anterior</a>` +
        `<span> Página ${page} / ${pages} </span>` +
        `<a href="${qs(Math.min(pages, page + 1))}">Siguiente &raquo;</a>` +
        `</div>`;

      const trs = rows
        .map(
          (r) =>
            `<tr>
              <td>${r.id}</td>
              <td>${r.last_name}</td>
              <td>${r.booking_number}</td>
              <td>${new Date(r.created_at).toLocaleString()}</td>
              <td><button data-id="${r.id}" class="del">🗑</button></td>
            </tr>`
        )
        .join("");

      const html = `
        <!doctype html>
        <html lang="es"><head>
          <meta charset="utf-8" />
          <title>NovaDesk Admin</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body{font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:24px;}
            h1{margin:0 0 16px;}
            table{border-collapse: collapse; width:100%;}
            th,td{border:1px solid #ddd; padding:8px; font-size:14px;}
            th{background:#f5f5f5; text-align:left;}
            tr:nth-child(even){background:#fafafa;}
            .top{display:flex; gap:12px; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap;}
            .pill{font-size:12px; background:#eef; padding:4px 8px; border-radius:999px;}
            .pager{display:flex; gap:8px; align-items:center; margin:12px 0;}
            .pager a{padding:4px 8px; border:1px solid #ddd; border-radius:6px; text-decoration:none; color:#333;}
            .actions{display:flex; gap:8px; align-items:center;}
            .actions a{padding:6px 10px; border:1px solid #ddd; border-radius:8px; text-decoration:none; color:#333;}
          </style>
        </head><body>
          <div class="top">
            <h1>NovaDesk — Reservas</h1>
            <div class="actions">
              <a href="/api/reservas?page=${page}&size=${size}">API JSON</a>
              <a href="/api/reservas.csv?page=${page}&size=${size}">Export CSV</a>
              <span class="pill">Total: ${total}</span>
            </div>
          </div>
          ${pager}
          <table>
            <thead><tr><th>ID</th><th>Apellido</th><th>Reserva</th><th>Creado</th><th></th></tr></thead>
            <tbody>${trs || "<tr><td colspan=5>Sin datos</td></tr>"}</tbody>
          </table>
          ${pager}
          <script>
            // Borrar fila (demo)
            const authHeader = 'Basic ' + btoa('${process.env.ADMIN_USER}:${process.env.ADMIN_PASS}');
            document.querySelectorAll('.del').forEach(btn=>{
              btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                if(!confirm('¿Borrar registro #' + id + '?')) return;
                const res = await fetch('/api/reservas/' + id, {
                  method: 'DELETE',
                  headers: { Authorization: authHeader, 'Content-Type':'application/json' }
                });
                if(res.ok) location.reload(); else alert('Error al borrar');
              });
            });
          </script>
        </body></html>`;
      res.status(200).send(html);
    } catch (e) {
      console.error("GET /admin", e);
      res.status(500).send("Error");
    }
  });

  app.use((req, _res, next) => {
    console.log(`➡️  ${req.method} ${req.url}`);
    next();
  });

  // Health & debug
  app.get("/", (_req, res) => res.status(200).send("NovaDesk bot OK"));
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/debug", (_req, res) =>
    res.json({ NODE_ENV, WEBHOOK_DOMAIN, WEBHOOK_PATH, PORT })
  );

  // Webhook (montaje explícito)
  app.get(WEBHOOK_PATH, (_req, res) => res.status(200).send("OK"));
  app.post(WEBHOOK_PATH, express.json(), bot.webhookCallback(WEBHOOK_PATH));

  app.listen(PORT, async () => {
    console.log(`🚀 Server escuchando en puerto ${PORT}`);
    try {
      const info = await bot.telegram.getMe();
      console.log(
        `🤖 Bot @${info.username} listo (webhook) → ${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`
      );
    } catch (e) {
      console.error("❌ Error getMe:", e?.message || e);
    }
  });
} else {
  // Desarrollo por polling
  bot.launch().then(() => {
    console.log("✅ NovaDesk bot en *polling* (DEV)");
  });
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

