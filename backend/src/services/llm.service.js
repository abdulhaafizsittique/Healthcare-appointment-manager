/**
 * LLM Service
 * ------------
 * Wraps calls to the Anthropic Messages API for the two required prompts:
 *   1. Pre-visit symptom summary (urgency, chief complaint, suggested questions)
 *   2. Post-visit patient-friendly summary
 *
 * Design goals (per assignment requirement "LLM failures must be handled
 * gracefully, system should not break"):
 *   - Every call is wrapped in try/catch with a timeout.
 *   - On failure we NEVER throw up to the route handler for booking/notes
 *     submission - we return a structured { ok: false, error } result and
 *     the caller stores a safe fallback value + the error message, so the
 *     appointment is still created/updated.
 *   - Responses are validated (JSON.parse guarded) before being trusted.
 *   - A doctor/patient can trigger a manual "regenerate summary" later
 *     (see appointment.routes.js) once the LLM is available again.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const TIMEOUT_MS = 15000;

async function callClaude(prompt, { maxTokens = 600 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `LLM API error ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) return { ok: false, error: "LLM returned no text content" };

    return { ok: true, text: textBlock.text };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, error: "LLM request timed out" };
    }
    return { ok: false, error: `LLM request failed: ${err.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Pre-visit summary. Returns:
 *   { ok: true, summary: { urgency, chiefComplaint, questions: [] } }
 *   { ok: false, error, summary: <safe fallback> }
 */
async function generatePreVisitSummary(symptomsText) {
  const prompt = `Analyse these symptoms and return ONLY valid JSON (no markdown, no prose) in this exact shape:
{"urgency": "Low" | "Medium" | "High", "chiefComplaint": string, "questions": [string, string, string]}

The "questions" field must contain exactly three suggested questions the doctor could ask the patient.
Symptoms: ${symptomsText}`;

  const result = await callClaude(prompt, { maxTokens: 400 });

  const fallback = {
    urgency: "Medium",
    chiefComplaint: symptomsText ? symptomsText.slice(0, 200) : "Not provided",
    questions: [
      "Could you describe when the symptoms started?",
      "Have you noticed anything that makes it better or worse?",
      "Are you currently taking any medication?",
    ],
    _fallback: true,
  };

  if (!result.ok) {
    return { ok: false, error: result.error, summary: fallback };
  }

  const parsed = safeParseJson(result.text);
  if (!parsed || !parsed.urgency || !parsed.chiefComplaint || !Array.isArray(parsed.questions)) {
    return { ok: false, error: "LLM response was not valid JSON in the expected shape", summary: fallback };
  }

  // Normalise urgency to our enum casing
  const urgency = ["Low", "Medium", "High"].includes(parsed.urgency) ? parsed.urgency : "Medium";

  return { ok: true, summary: { urgency, chiefComplaint: parsed.chiefComplaint, questions: parsed.questions } };
}

/**
 * Post-visit summary. Returns:
 *   { ok: true, summary: string }
 *   { ok: false, error, summary: <safe fallback string> }
 */
async function generatePostVisitSummary(clinicalNotes, prescription) {
  const prompt = `Convert these clinical notes into a patient-friendly summary with a medication schedule and follow-up steps. Write in plain, warm, non-technical language a patient can easily understand. Use short sections with headings: "What we found", "Your medication schedule", "Follow-up steps".

Clinical notes: ${clinicalNotes}
Prescription: ${prescription || "None"}`;

  const result = await callClaude(prompt, { maxTokens: 700 });

  const fallback =
    "Your visit summary is being prepared. Please refer to the notes and prescription shared by your doctor, " +
    "or contact the clinic if you have questions about your medication schedule or next steps.";

  if (!result.ok) {
    return { ok: false, error: result.error, summary: fallback };
  }

  return { ok: true, summary: result.text.trim() };
}

function safeParseJson(text) {
  try {
    // Strip potential markdown code fences just in case
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

module.exports = { generatePreVisitSummary, generatePostVisitSummary };
