const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth } = require("../middleware/auth");
const { getAuthUrl, handleOAuthCallback } = require("../services/calendar.service");

const router = express.Router();

// Returns the Google consent URL for the logged-in user to visit.
// We encode the userId in a short-lived signed `state` token instead of a
// server session, since this API is stateless/JWT-based.
router.get("/oauth/connect", requireAuth, (req, res) => {
  const state = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const url = getAuthUrl(state);
  res.json({ url });
});

// Google redirects here after consent. No requireAuth (Google can't send
// our Bearer header) - we authenticate via the signed `state` instead.
router.get("/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");

  try {
    const { userId } = jwt.verify(String(state), process.env.JWT_SECRET);
    await handleOAuthCallback(String(code), userId);
    res.redirect(`${process.env.FRONTEND_URL}/calendar-connected`);
  } catch (err) {
    res.status(400).send(`Calendar connection failed: ${err.message}`);
  }
});

module.exports = router;
