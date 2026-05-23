const https = require('https');
const express = require('express');

const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const env = require('../../../config/env');

const router = express.Router();

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const USER_SYSTEM_PROMPT = `You are Zandra AI, a friendly assistant for the HanapGawa app — a local service marketplace in Tawi-Tawi, Philippines that connects clients with skilled workers and agencies.

Help users with:
- Finding workers or services (plumbing, electrical, cleaning, tutoring, beauty, delivery, etc.)
- How to post a job or book a worker
- How bookings, reviews, and messages work
- Platform safety tips
- Pricing and payment info
- Anything related to using HanapGawa

Keep answers concise, friendly, and practical. Use simple English. When relevant, mention specific app features (Explore tab, Jobs tab, Bookings tab). The app serves municipalities in Tawi-Tawi like Bongao, Panglima Sugala, Sapa-Sapa, Languyan, Tandubas, etc.`;

const ADMIN_SYSTEM_PROMPT = `You are HanapGawa Admin AI, an intelligent assistant for platform administrators of HanapGawa — a service marketplace in Tawi-Tawi, Philippines.

You help admins with:
- Understanding platform data and metrics
- Identifying fraud, suspicious users, or abuse patterns
- Report management and prioritization
- User moderation decisions (suspend, ban, reactivate)
- Platform health and analytics insights
- Policy and moderation guidance

Be direct, analytical, and professional. When platform data is provided in the message, use it to give specific answers.`;

// ─── AI providers ─────────────────────────────────────────────────────────────

function callGemini(systemPrompt, history, userMessage) {
  const contents = [
    ...history.map((m) => ({ role: m.isUser ? 'user' : 'model', parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200 || json.error) {
            return reject(new Error(json.error?.message || `Gemini error ${res.statusCode}`));
          }
          resolve(json?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.');
        } catch { reject(new Error('Failed to parse Gemini response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callGroq(systemPrompt, history, userMessage) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.isUser ? 'user' : 'assistant', content: m.text })),
    { role: 'user', content: userMessage },
  ];
  const body = JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.7, max_tokens: 512 });

  return new Promise((resolve, reject) => {
    const url = new URL(GROQ_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200 || json.error) {
            return reject(new Error(json.error?.message || `Groq error ${res.statusCode}`));
          }
          resolve(json?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.');
        } catch { reject(new Error('Failed to parse Groq response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callAI(systemPrompt, history, userMessage) {
  if (env.GEMINI_API_KEY) {
    try { return await callGemini(systemPrompt, history, userMessage); }
    catch (err) { console.warn('[AI] Gemini failed, falling back to Groq:', err.message); }
  }
  if (env.GROQ_API_KEY) return callGroq(systemPrompt, history, userMessage);
  throw new Error('No AI service configured');
}

// ─── Fallbacks (no API key configured) ───────────────────────────────────────

function userFallback(message) {
  const t = message.toLowerCase();
  if (t.includes('book'))   return 'AI is not available right now. To book a worker, open Explore, choose a service or worker, then tap Book or send a message.';
  if (t.includes('job'))    return 'AI is not available right now. To post a job, go to the Jobs tab, create a job post, and wait for workers to apply.';
  if (t.includes('report') || t.includes('safe')) return 'AI is not available right now. For safety, use Report on posts, profiles, or messages.';
  return 'AI is not available right now. You can still use Explore to find workers, Jobs to post work, Bookings to manage transactions, and Messages to chat.';
}

function adminFallback(message, context = '') {
  const t = `${message} ${context}`.toLowerCase();
  if (t.includes('report'))  return 'AI is not configured. Use the Reports tab to review pending reports, then resolve, dismiss, suspend, or ban as appropriate.';
  if (t.includes('summary') || t.includes('platform')) return `AI is not configured. Current context: ${context || 'No platform context provided.'}`;
  return 'AI is not configured, but the admin dashboard is available. Check Reports, Analytics, and the User/Provider lists for moderation signals.';
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post('/chat', hanapgawaAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }
    if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
      return res.json({ reply: userFallback(message), degraded: true });
    }
    const reply = await callAI(USER_SYSTEM_PROMPT, history, message);
    res.json({ reply });
  } catch (err) {
    console.error('[AI] /ai/chat error:', err.message);
    res.status(500).json({ error: 'AI service unavailable' });
  }
});

router.post('/admin-chat', hanapgawaAuth, async (req, res) => {
  try {
    if (req.auth.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });

    const { message, history = [], context = '' } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }
    if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
      return res.json({ reply: adminFallback(message, context), degraded: true });
    }
    const fullMessage = context ? `Platform context:\n${context}\n\nAdmin question: ${message}` : message;
    const reply = await callAI(ADMIN_SYSTEM_PROMPT, history, fullMessage);
    res.json({ reply });
  } catch (err) {
    console.error('[AI] /ai/admin-chat error:', err.message);
    res.status(500).json({ error: 'AI service unavailable' });
  }
});

module.exports = { aiRoutes: router };
