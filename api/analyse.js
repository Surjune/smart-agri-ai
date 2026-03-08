export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GEMINI_KEY = "AIzaSyDvprxfEffvH8olLiE_y2K3IZoMk9p9I2Y";

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_KEY not set in environment variables.' });
  }

  // ── AUTO MODEL SELECTION ──
  // Fetches available Gemini models and picks the best vision-capable one automatically.
  // Priority: gemini-1.5-flash first (fast + free), then 1.5-pro, then any flash, then any gemini.
  // Never breaks if Google deprecates a model name.
  async function getBestGeminiModel() {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`
      );
      if (!r.ok) throw new Error('models fetch failed');
      const data = await r.json();
      const models = (data.models || []).map(m => m.name.replace('models/', ''));

      // Only keep vision-capable models (generateContent support)
      const vision = models.filter(m =>
        m.includes('gemini') && (m.includes('flash') || m.includes('pro'))
      );

      // Priority list — first match wins
      const preferred = [
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-flash-002',
        'gemini-1.5-pro',
        'gemini-1.5-pro-latest',
        'gemini-2.0-flash',
        'gemini-2.0-flash-exp',
      ];
      for (const p of preferred) {
        if (vision.includes(p)) return p;
      }
      // Fallback: first flash model
      const flash = vision.find(m => m.includes('flash'));
      if (flash) return flash;
      // Last resort
      return vision[0] || 'gemini-1.5-flash';
    } catch {
      return 'gemini-1.5-flash';
    }
  }

  try {
    const {
      imageBase64,
      mimeType,
      crop,
      age,
      district,
      symptoms
    } = req.body;

    const model = await getBestGeminiModel();

    const analysisPrompt = `You are FarmSense AI — an expert agricultural image analyst for Indian farmers trained on ICAR and TNAU plant pathology data.

A farmer has uploaded a photo of their crop leaf or plant.

Known details:
- Crop: ${crop || 'Not specified — ask the farmer'}
- Crop age: ${age ? age + ' days' : 'Not specified — ask'}
- Location: ${district || 'Not specified'}
- Symptoms described: ${symptoms || 'Not described'}

YOUR TASK:
1. Carefully analyse the image for disease signs, pest damage, or nutrient deficiency
2. Give your diagnosis with confidence level: High / Medium / Low
3. Ask ONLY ONE follow-up question to confirm your diagnosis
4. Do NOT give full treatment yet — wait for farmer confirmation

FORMAT your response exactly like this:

🔍 WHAT I SEE IN THE IMAGE:
[Describe exactly what you observe — colour, pattern, location on leaf/stem]

🌾 LIKELY PROBLEM:
[Disease / pest / deficiency name] — Confidence: [High / Medium / Low]

Why: [One sentence explanation]

❓ ONE QUESTION TO CONFIRM:
[Your single most important follow-up question]

Source: ICAR Plant Pathology Division · Government of India`;

    // Build Gemini request parts
    const parts = [];

    // Add image if provided
    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: imageBase64
        }
      });
    }

    parts.push({ text: analysisPrompt });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024
        }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({
        error: err.error?.message || 'Gemini API error',
        model_used: model
      });
    }

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
      || 'Could not analyse the image. Please try again with a clearer photo.';

    return res.status(200).json({ reply, model_used: model });

  } catch (error) {
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
