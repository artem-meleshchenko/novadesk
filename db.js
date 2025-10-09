// db.js — SQLite mínimo para reservas + paginación + delete
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

// Carpeta data (persistente en Azure bajo /home/site/wwwroot/data)
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "novadesk.sqlite");
const db = new sqlite3.Database(dbPath);

// Esquema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      last_name TEXT NOT NULL,
      booking_number TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
});

function insertReserva(last_name, booking_number) {
  return new Promise((resolve, reject) => {
    const created_at = new Date().toISOString();
    db.run(
      `INSERT INTO reservas (last_name, booking_number, created_at) VALUES (?, ?, ?)`,
      [last_name, booking_number, created_at],
      function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, last_name, booking_number, created_at });
      }
    );
  });
}

function ultimasReservas(limit = 5) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, last_name, booking_number, created_at
       FROM reservas
       ORDER BY id DESC
       LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

function listReservas(page = 1, size = 20) {
  return new Promise((resolve, reject) => {
    const limit = Math.max(1, Math.min(200, Number(size)));
    const offset = Math.max(0, (Math.max(1, Number(page)) - 1) * limit);
    db.all(
      `SELECT id, last_name, booking_number, created_at
       FROM reservas
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

function countReservas() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) AS total FROM reservas`, (err, row) =>
      err ? reject(err) : resolve(row.total)
    );
  });
}

function deleteReserva(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM reservas WHERE id = ?`, [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes); // 1 si borró, 0 si no
    });
  });
}

module.exports = {
  insertReserva,
  ultimasReservas,
  listReservas,
  countReservas,
  deleteReserva,
};

