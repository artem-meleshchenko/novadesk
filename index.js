require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { insertReserva, ultimasReservas } = require("./db"); // ⬅️ NUEVO

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ Falta BOT_TOKEN en .env");
  process.exit(1);
}

const bot = new Telegraf(token);

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

// Comando admin para ver últimas reservas (útil para probar)
bot.command("ultimas", async (ctx) => {
  const filas = await ultimasReservas(5);
  if (!filas.length) return ctx.reply("Aún no hay reservas registradas.");
  const texto = filas
    .map(
      (r) =>
        `#${r.id} — ${r.last_name} / ${r.booking_number} · ${new Date(
          r.created_at
        ).toLocaleString()}`
    )
    .join("\n");
  return ctx.reply(texto);
});

// Captura 'Apellido Numero' y guarda en DB
bot.on("text", async (ctx) => {
  const texto = ctx.message.text.trim();
  const m = texto.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+)\s+(\d{4,})$/);
  if (m) {
    const last_name = m[1].trim();
    const booking_number = m[2];
    try {
      const row = await insertReserva(last_name, booking_number);
      await ctx.reply(
        `✅ *Pre check-in registrado*\nApellido: *${row.last_name}*\nReserva: *${row.booking_number}*\nID: *${row.id}*`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      console.error(e);
      await ctx.reply("⚠️ Error al registrar. Inténtalo de nuevo.");
    }
  }
});

bot.telegram.getMe().then((botInfo) => {
  console.log(`🤖 Bot @${botInfo.username} listo (polling)`);
});

bot.launch().then(() => {
  console.log("✅ NovaDesk bot en *polling* está listo");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
