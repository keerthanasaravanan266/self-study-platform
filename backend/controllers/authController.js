const db = require("../config/db");

// REGISTER
exports.register = (req, res) => {

    const { username, password, email } = req.body;

const sql = "INSERT INTO users (username, password, email) VALUES (?, ?, ?)";

    db.query(sql, [username, password, email], (err, result) => {

        if (err) {
            return res.status(500).json({ message: "Username already exists" });
        }

        res.json({ message: "Registration successful" });
    });
};


// LOGIN
exports.login = (req, res) => {

    const { username, password } = req.body;

    // First check if username exists
    const checkUserSql = "SELECT * FROM users WHERE username=?";

    db.query(checkUserSql, [username], (err, userResult) => {

        if (err) {
            return res.status(500).json(err);
        }

        if (userResult.length === 0) {
            return res.status(404).json({ message: "No account found" });
        }

        // Now check password
        const user = userResult[0];

        if (user.password !== password) {
            return res.status(401).json({ message: "Incorrect password" });
        }

        // Login success
        res.json({
            message: "Login successful",
            user: user
            
        });

    });
};
