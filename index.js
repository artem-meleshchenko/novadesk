// index.js — NovaDesk Bot (final)
// Modo DEV: polling | Modo PROD: webhook (Express en Azure)

require("dotenv").config();
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

  // Logs y trazas HTTP
  console.log("✅ NODE_ENV:", NODE_ENV);
  console.log("✅ WEBHOOK_DOMAIN:", WEBHOOK_DOMAIN);
  console.log("✅ WEBHOOK_PATH:", JSON.stringify(WEBHOOK_PATH));

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

