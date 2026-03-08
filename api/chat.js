export default async function handler(req, res) {

  // ── CORS — allow browser requests from any origin ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight check (browser sends OPTIONS before POST)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GROQ_KEY = process.env.GROQ_KEY;

  if (!GROQ_KEY) {
    return res.status(500).json({
      error: 'GROQ_KEY is not set. Go to Vercel → Project → Settings → Environment Variables and add GROQ_KEY.'
    });
  }

  // ── AUTO MODEL SELECTION ──
  // Fetches live model list from Groq and picks best available.
  // Never breaks if Groq deprecates a model.
  async function getBestModel() {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${GROQ_KEY}` }
      });
      if (!r.ok) throw new Error('models list failed');
      const data = await r.json();
      const ids = (data.data || []).map(m => m.id);

      const preferred = [
        'llama-3.3-70b-versatile',
        'llama-3.3-70b-specdec',
        'llama-3.1-70b-versatile',
        'llama3-70b-8192',
      ];
      for (const p of preferred) {
        if (ids.includes(p)) return p;
      }
      const fallback70b = ids.find(id => id.includes('70b'));
      if (fallback70b) return fallback70b;
      return ids[0] || 'llama-3.3-70b-versatile';
    } catch {
      return 'llama-3.3-70b-versatile';
    }
  }

  try {
    const { messages, systemPrompt } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const model = await getBestModel();

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt || `You are FarmSense AI — an expert agricultural advisor for Indian farmers trained on ICAR, TNAU, State Agriculture Department, and Government of India crop advisory data.

CRITICAL RULES:
1. Ask ONLY ONE follow-up question at a time. Never ask two questions in one message.
2. Collect these 5 things before giving final advice in this order:
   Crop name → Crop age in days → Exact symptom → Recent weather → Land size in acres
3. Once you have all 5, give: disease/problem name, cause in simple language, chemical name + dose per litre, total quantity for their acreage, cost in rupees, brand names in India, follow-up date, ICAR/TNAU source.
4. ONLY answer farming questions.
5. Use simple English. Never recommend pesticides banned in India.`
          },
          ...messages
        ],
        max_tokens: 1024,
        temperature: 0.4
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({
        error: err.error?.message || 'Groq API error',
        model_used: model
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'No response received.';

    return res.status(200).json({ reply, model_used: model });

  } catch (error) {
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
