const db = require("../config/db");


// Paste Material
exports.pasteMaterial = (req, res) => {
    const { user_id, type, content } = req.body;
    const category = (req.body.category || "").trim() || "Uncategorized";

    const sql = "INSERT INTO pasted_materials (user_id, type, content, category) VALUES (?, ?, ?, ?)";

    db.query(sql, [user_id, type, content, category], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: "Database error" });
        }

        res.json({ message: "Content saved successfully" });
    });
};

exports.getMaterials = (req, res) => {
    const userId = req.params.userId;

    const sql = "SELECT * FROM materials WHERE user_id = ? ORDER BY created_at DESC";

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: "Database error" });
        }

        res.json(results);
    });
};

exports.getPastedMaterials = (req, res) => {
    const userId = req.params.userId;

    const sql = "SELECT * FROM pasted_materials WHERE user_id = ? ORDER BY created_at DESC";

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: "Database error" });
        }

        res.json(results);
    });
};