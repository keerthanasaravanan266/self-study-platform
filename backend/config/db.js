const mysql = require("mysql2");

// Reads from environment variables when present (needed once you deploy to
// a cloud MySQL host), and falls back to your current local XAMPP/MySQL
// settings so nothing changes for local development.
const db = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "selfstudy",
    port: process.env.DB_PORT || 3306
});

db.connect((err) => {
    if (err) {
        console.log("Database connection failed:", err);
    } else {
        console.log("MySQL Connected");
    }
});

module.exports = db;
