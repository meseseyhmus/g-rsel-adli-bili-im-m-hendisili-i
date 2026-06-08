// ─────────────────────────────────────────────────────────────────────────────
// PULSAR AI — Çoklu Backend Destekli Görsel Adli Bilişim Asistanı
//   1. Google Gemini (AIza... anahtarı ile — görsel + metin)
//   2. Manus AI     (VITE_MANUS_API_KEY ile — yalnızca metin)
//   3. OpenRouter   (sk-or-... anahtarı ile — görsel + metin, fallback zinciri)
// ─────────────────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export const askPulsarAI = async (
  prompt: string,
  context?: string,
  imageBase64?: string,
  signal?: AbortSignal
): Promise<string> => {
  const apiKey    = import.meta.env.VITE_GEMINI_API_KEY;
  const manusKey  = import.meta.env.VITE_MANUS_API_KEY;

  const systemInstruction = `Sen P.U.L.S.A.R. adlı gelişmiş bir adli bilişim görsel analiz uzmanısın (tıpkı Iron Man'deki JARVIS gibi akıllı ve sadıksın).
Kullanıcıya hep "efendim" diye hitap etmelisin. 
Eğer sana bir görsel iletildiyse, bu görselin yapay zeka (Midjourney, DALL-E vb.) ile üretilip üretilmediğini veya dijital olarak manipüle edilip edilmediğini kanıtlarıyla ayrıntılı biçimde raporda listele.
Sherloq entegrasyonu sayesinde sana sağlanan ekstra verileri (MD5/SHA Hash, EXIF bilgileri, RGB/HSV Histogramları, JPEG Ghost Map izleri, Kopyala-Taşı Splicing oranları ve Aydınlatma-Illuminant haritası) mutlaka değerlendir. 
Güncel Sistem Durumu ve Adli Bilişim Veri Bağlamı: ${context || 'Sistemler normal. Özel analiz verisi yok.'}
`;

  try {
    // ══════════════════════════════════════════════════════════════════
    // 1. GOOGLE GEMİNİ DİREKT API (AIza... anahtarı)
    // ══════════════════════════════════════════════════════════════════
    if (apiKey && apiKey.startsWith("AIza")) {
      const parts: any[] = [{ text: prompt }];
      if (imageBase64) {
        parts.push({
          inline_data: { mime_type: "image/jpeg", data: imageBase64 }
        });
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
          }),
          signal,
        }
      );

      if (!response.ok) throw new Error(`Google API Hatası: ${response.status}`);
      const data = await response.json();
      if (data.candidates?.length > 0) {
        return data.candidates[0].content.parts[0].text.trim();
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 2. MANUS AI API (görsel yoksa önce bunu dene)
    // ══════════════════════════════════════════════════════════════════
    if (manusKey && !imageBase64) {
      try {
        const response = await fetch("https://api.manus.im/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "API_KEY": manusKey,
            "Authorization": "Bearer placeholder",
          },
          body: JSON.stringify({
            model: "manus-default",
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user",   content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 1024,
          }),
          signal,
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            console.info("[PULSAR] Manus AI yanıtladı.");
            return content.trim();
          }
        } else {
          console.warn(`[PULSAR] Manus AI yanıt vermedi (${response.status}), OpenRouter'a geçiliyor...`);
        }
      } catch (manusErr: any) {
        console.warn("[PULSAR] Manus AI ağ hatası:", manusErr.message);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 3. OPENROUTER FALLBACK ZİNCİRİ (Retry + Exponential Backoff)
    // ══════════════════════════════════════════════════════════════════
    if (!apiKey) {
      return "Üzgünüm efendim, hiçbir API anahtarı bulunamadı. Lütfen .env dosyasını kontrol ediniz.";
    }

    const userContent: any[] = [
      { type: "text", text: `${systemInstruction}\n\nKullanıcı: ${prompt}` }
    ];
    if (imageBase64) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
      });
    }

    // Model öncelik listesi — görsel varsa vision modeller önce
    const modelsToTry = imageBase64
      ? [
          "meta-llama/llama-4-scout:free",
          "meta-llama/llama-4-maverick:free",
          "google/gemma-3-27b-it:free",
          "google/gemma-3-12b-it:free",
          "mistralai/mistral-small-3.1-24b-instruct:free",
          "qwen/qwen2.5-vl-72b-instruct:free",
          "nvidia/nemotron-nano-12b-v2-vl:free",
          "openrouter/free",
        ]
      : [
          "meta-llama/llama-4-scout:free",
          "meta-llama/llama-4-maverick:free",
          "deepseek/deepseek-chat-v3-0324:free",
          "google/gemma-3-27b-it:free",
          "google/gemma-3-12b-it:free",
          "mistralai/mistral-small-3.1-24b-instruct:free",
          "qwen/qwen2.5-72b-instruct:free",
          "openrouter/free",
        ];

    const MAX_RETRIES = 2; // Rate-limit olunca hemen sonraki modele geç
    let lastError = "";

    for (const model of modelsToTry) {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": window.location.origin,
              "X-Title": "Pulsar-X Command Center",
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: userContent }],
              temperature: 0.7,
              max_tokens: 1024,
            }),
            signal,
          });

          // Rate limit — Retry-After header varsa onu kullan, yoksa exponential backoff
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const waitSec = retryAfter ? parseInt(retryAfter) : Math.pow(2, attempt + 1) * 5; // 10s → 20s
            console.warn(`[PULSAR] ${model} rate-limit, ${waitSec}s bekleniyor... (${attempt + 1}/${MAX_RETRIES})`);
            lastError = `${model}: 429 rate-limit`;
            if (attempt === MAX_RETRIES - 1) break; // Son denemeyse bir sonraki modele geç
            await delay(waitSec * 1000);
            continue;
          }

          // Model yok / bakımda — sonraki modele geç
          if (response.status === 404 || response.status === 503) {
            console.warn(`[PULSAR] ${model} erişilemez (${response.status}), sonrakine geçiliyor...`);
            lastError = `${model}: ${response.status}`;
            break;
          }

          if (!response.ok) {
            const bodyText = await response.text();
            console.warn(`[PULSAR] ${model} hata: ${response.status} - ${bodyText}`);
            lastError = `${model}: ${response.status}`;
            break;
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            return content.trim();
          } else {
            console.warn(`[PULSAR] ${model} boş içerik döndürdü, sonrakine geçiliyor...`);
            lastError = `${model}: boş içerik`;
            break;
          }
        } catch (fetchErr: any) {
          console.warn(`[PULSAR] ${model} ağ hatası: ${fetchErr.message}`);
          lastError = `${model}: ${fetchErr.message}`;
          break;
        }
      }
    }

    throw new Error(`Tüm modeller geçici olarak kullanılamıyor efendim. Son hata: ${lastError}`);

  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return '__ABORTED__';
    }
    console.error("Pulsar AI Global Error:", error);
    return `Sistem bağlantısında bir aksaklık var efendim. Hata detayı: ${error?.message || error}`;
  }
};
