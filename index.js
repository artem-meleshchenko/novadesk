require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");

const token = process.env.BOT_TOKEN;
if (!token) { console.error("❌ Falta BOT_TOKEN"); process.exit(1); }

const NODE_ENV = process.env.NODE_ENV || "development";
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const WEBHOOK_PATH = (process.env.WEBHOOK_PATH || "/telegram/webhook-123").trim();

const bot = new Telegraf(token);

// ====== Bot UI ======
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

// ====== Modo DEV (polling) vs PROD (webhook) ======
if (NODE_ENV === "production") {
  const app = express();

  // Logs y ruta de debug para ver exactamente qué valores usa la app
  console.log("✅ NODE_ENV:", NODE_ENV);
  console.log("✅ WEBHOOK_DOMAIN:", WEBHOOK_DOMAIN);
  console.log("✅ WEBHOOK_PATH:", JSON.stringify(WEBHOOK_PATH));

  // MIDDLEWARE de traza (para ver hits al webhook)
  app.use((req, _res, next) => { console.log(`➡️  ${req.method} ${req.url}`); next(); });

  // Endpoints de salud
  app.get("/", (_req, res) => res.status(200).send("NovaDesk bot OK"));
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/debug", (_req, res) =>
    res.json({ NODE_ENV, WEBHOOK_DOMAIN, WEBHOOK_PATH })
  );

  // **MONTAJE EXPLÍCITO DEL WEBHOOK**
  app.get(WEBHOOK_PATH, (_req, res) => res.status(200).send("OK"));        // GET (diagnóstico)
  app.post(WEBHOOK_PATH, express.json(), bot.webhookCallback(WEBHOOK_PATH)); // POST real

  const port = process.env.PORT || 3000;
  app.listen(port, async () => {
    console.log(`🚀 Server escuchando en puerto ${port}`);
    const info = await bot.telegram.getMe();
    console.log(`🤖 Bot @${info.username} listo (webhook) → ${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`);
  });
} else {
  bot.launch().then(() => console.log("✅ NovaDesk bot en *polling* (DEV)"));
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}