const express = require("express");
const router = express.Router();
const materialController = require("../controllers/materialController");
const upload = require("../config/multer");

// ✅ ADD THIS ROUTE
router.post("/upload", upload.single("file"), (req, res) => {

    const db = require("../config/db");

    const user_id = req.body.user_id;
    const type = req.body.type;
    const category = (req.body.category || "").trim() || "Uncategorized";

    // ================= FILE UPLOAD =================
    if (req.file) {

        const title = req.file.originalname;

        // 🔍 CHECK DUPLICATE
        const checkSql = `
            SELECT * FROM materials 
            WHERE user_id = ? AND title = ?
        `;

        db.query(checkSql, [user_id, title], (err, results) => {

            if (err) return res.status(500).json({ message: "DB error" });

            if (results.length > 0) {
                return res.json({ message: "File already uploaded" });
            }

            const filePath = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

            const insertSql = `
                INSERT INTO materials (user_id, type, title, file_path, category)
                VALUES (?, ?, ?, ?, ?)
            `;

            db.query(insertSql, [user_id, type, title, filePath, category],
                (err) => {
                    if (err) return res.status(500).json({ message: "Insert error" });

                    res.json({ message: "File uploaded successfully" });
                }
            );

        });
    }

    // ================= LINK UPLOAD =================
    else {

        const { title, file_path } = req.body;

        // 🔍 CHECK DUPLICATE
        const checkSql = `
            SELECT * FROM materials 
            WHERE user_id = ? AND file_path = ?
        `;

        db.query(checkSql, [user_id, file_path], (err, results) => {

            if (err) return res.status(500).json({ message: "DB error" });

            if (results.length > 0) {
                return res.json({ message: "Link already uploaded" });
            }

            const insertSql = `
                INSERT INTO materials (user_id, type, title, file_path, category)
                VALUES (?, ?, ?, ?, ?)
            `;

            db.query(insertSql, [user_id, type, title, file_path, category],
                (err) => {
                    if (err) return res.status(500).json({ message: "Insert error" });

                    res.json({ message: "Link saved successfully" });
                }
            );

        });
    }

});

// Distinct categories a user has used so far, for the category dropdown/datalist
router.get("/categories/:userId", (req, res) => {
    const db = require("../config/db");
    const userId = req.params.userId;

    const sql = `
        SELECT category FROM materials WHERE user_id = ?
        UNION
        SELECT category FROM pasted_materials WHERE user_id = ?
    `;

    db.query(sql, [userId, userId], (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results.map(r => r.category).filter(Boolean));
    });
});

// ✅ FIRST this (specific route)
router.get("/pasted/:userId", materialController.getPastedMaterials);

// ✅ THEN this (generic route)
router.get("/:userId", materialController.getMaterials);

// POST stays same
router.post("/paste", materialController.pasteMaterial);

module.exports = router;