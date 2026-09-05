// ================= API CONFIG =================
// One place to control which backend the whole site talks to.
//
// - While you're developing on your own PC, it automatically uses
//   http://localhost:5000, so you don't need to change anything.
// - Once you deploy the backend (Render/Railway/etc.), put its live URL
//   in PROD_API_URL below. Every page will then use it automatically
//   whenever the site itself isn't running on localhost.

const PROD_API_URL = "https://YOUR-BACKEND-URL-HERE.onrender.com"; // <-- change this after deploying the backend

const API_BASE =
  (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:5000"
    : PROD_API_URL;
