require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ Falta BOT_TOKEN en .env");
  process.exit(1);
}

const NODE_ENV = process.env.NODE_ENV || "development";
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN; // ej: https://novadesk-xxxxx.azurewebsites.net
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/telegram/webhook-123"; // usa un path “secreto”

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
  // Webhook en Azure
  const app = express();

  // Healthcheck y home
  app.get("/", (_req, res) => res.status(200).send("NovaDesk bot OK"));
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  // Ruta del webhook (debe coincidir con WEBHOOK_PATH)
  app.use(express.json());
  app.use(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));

  const port = process.env.PORT || 3000;
  app.listen(port, async () => {
    console.log(`🚀 Server escuchando en puerto ${port}`);
    if (!WEBHOOK_DOMAIN) {
      console.error("⚠️ Falta WEBHOOK_DOMAIN en variables de entorno de Azure");
      return;
    }
    const fullUrl = WEBHOOK_DOMAIN + WEBHOOK_PATH;
    try {
      // Opcional: confirmar identidad del bot
      const info = await bot.telegram.getMe();
      console.log(`🤖 Bot @${info.username} listo (webhook) → ${fullUrl}`);

      // SUGERENCIA: configurar el webhook desde fuera (script o curl). Aquí solo informamos.
      console.log("ℹ️ Recuerda ejecutar setWebhook apuntando a:", fullUrl);
    } catch (err) {
      console.error("❌ Error iniciando bot:", err.message);
    }
  });
} else {
  // Desarrollo (Codespaces) con polling
  bot.telegram.getMe().then((info) => {
    console.log(`🤖 Bot @${info.username} listo (polling DEV)`);
  });
  bot.launch().then(() => {
    console.log("✅ NovaDesk bot en *polling* (DEV)");
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
