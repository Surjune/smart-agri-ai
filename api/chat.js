export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GROQ_KEY = process.env.GROQ_KEY;

  if (!GROQ_KEY) {
    return res.status(500).json({ error: 'GROQ_KEY not set in environment variables.' });
  }

  // ── AUTO MODEL SELECTION ──
  // Fetches the available models from Groq and picks the best one automatically.
  // Priority: llama-3.3-70b first (best quality), then 3.1-70b, then any 70b, then any available.
  // This means your chatbot never breaks if Groq deprecates a model.
  async function getBestModel() {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${GROQ_KEY}` }
      });
      if (!r.ok) throw new Error('models fetch failed');
      const data = await r.json();
      const ids = (data.data || []).map(m => m.id);

      // Priority list — first match wins
      const preferred = [
        'llama-3.3-70b-versatile',
        'llama-3.3-70b-specdec',
        'llama-3.1-70b-versatile',
        'llama3-70b-8192',
      ];
      for (const p of preferred) {
        if (ids.includes(p)) return p;
      }
      // Fallback: any 70b model
      const seventyB = ids.find(id => id.includes('70b'));
      if (seventyB) return seventyB;
      // Last resort: first available model
      return ids[0] || 'llama-3.3-70b-versatile';
    } catch {
      // If model fetch fails, use known good model
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
   → Crop name
   → Crop age in days
   → Exact symptom (what farmer sees)
   → Recent weather (rain / dry / humid)
   → Land size in acres
3. Once you have all 5, give:
   → Disease or problem name
   → Exact cause in simple language
   → Chemical name + dose in grams or ml per litre of water
   → Total quantity needed for their exact acreage
   → Approximate cost at local agri-input shop in rupees
   → Brand names available in India
   → Follow-up check date
   → Source: ICAR or TNAU guideline name
4. ONLY answer farming questions. Say "I can only help with farming questions" for anything else.
5. Use simple English. No jargon.
6. Never recommend pesticides banned in India.`
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
