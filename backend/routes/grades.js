const express = require("express");
const router = express.Router();
const db = require("../config/db");


router.post("/add", (req, res) => {

    const {subject, marks, user_id} = req.body;

    const sql = "INSERT INTO grades (subject, marks, user_id) VALUES (?, ?, ?)";

    db.query(sql, [subject, marks, user_id], (err, result) => {

        if(err){
            return res.status(500).json(err);
        }

        res.json({message: "Grade added"});
    });

});


router.get("/:user_id", (req, res) => {

    const sql = "SELECT * FROM grades WHERE user_id=?";

    db.query(sql, [req.params.user_id], (err, result) => {

        if(err){
            return res.status(500).json(err);
        }

        res.json(result);
    });

});


module.exports = router;