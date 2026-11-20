// Función serverless de Vercel: convierte en voz una respuesta de Shenron con Gemini TTS y devuelve el audio WAV.
// Solo acepta textos que ha escrito el propio Oráculo (ficha firmada de api/deseo.js, válida una vez y
// durante 5 minutos): así nadie puede gastar la cuota de voz leyendo textos propios.
//
// Variables de entorno (además de las de api/deseo.js):
//   GEMINI_TTS_MODEL      opcional; modelo de voz (por defecto, DEFAULT_MODEL)
//   GEMINI_TTS_VOICE      opcional; voz prediseñada de Gemini (por defecto, DEFAULT_VOICE)
//   GEMINI_TTS_DAILY_CAP  opcional; máximo de audios al día entre todos (por defecto, DEFAULT_DAILY_CAP)

import { json, sameOrigin, redis, checkVoiceTicket } from "./_comun.js";

const DEFAULT_MODEL = "gemini-3.8-flash-lite-tts";
const DEFAULT_VOICE = "Algenib";
// El plan gratuito de voz es mucho más corto que el de texto (3 audios por minuto).
const DEFAULT_DAILY_CAP = 150;
const MAX_TEXT = 700;
const MAX_BODY_BYTES = 3000;
const TTS_TIMEOUT_MS = 12000;
// La etiqueta entre corchetes marca el estilo: el modelo la interpreta y no la lee en voz alta.
const STYLE_TAG = "[con voz grave y solemne]";

// Marca la ficha como usada y, solo si era nueva, suma al contador del día. Todo de una vez (script Lua),
// para que repetir una ficha ya usada no sirva para llenar el tope y dejar a todos sin voz.
// Devuelve -1 si la ficha ya se había usado; si no, los audios del día.
const CLAIM_SCRIPT = `if not redis.call('SET', KEYS[1], '1', 'NX', 'EX', 600) then return -1 end
local n = redis.call('INCR', KEYS[2])
if n == 1 then redis.call('EXPIRE', KEYS[2], 172800) end
return n`;

// Gemini suele devolver WAV; si devuelve PCM en crudo (audio/L16), se le pone la cabecera WAV.
function toWav(bytes, mimeType) {
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF") return bytes;
  const rate = Number(/rate=(\d+)/.exec(mimeType || "")?.[1]) || 24000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}

export async function POST(request) {
  if (!sameOrigin(request)) return json(403, { error: "origen" });

  let text, ticket;
  try {
    // Se mide el cuerpo de verdad: la cabecera content-length puede faltar (envío por partes).
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: "largo" });
    const body = JSON.parse(raw);
    text = typeof body?.texto === "string" ? body.texto : "";
    ticket = body?.ficha;
  } catch (_) {
    return json(400, { error: "formato" });
  }
  if (!text || text.length > MAX_TEXT) return json(400, { error: "texto" });

  const secret = process.env.IP_SALT;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!secret || !apiKey) return json(503, { error: "sin-voz" });
  const signature = checkVoiceTicket(ticket, text, secret);
  if (!signature) return json(403, { error: "ficha" });

  // Cada ficha sirve una sola vez y hay un tope diario de audios entre todos.
  const usedKey = `voz:usada:${signature}`;
  const dayKey = `gemini:voz:${new Date().toISOString().slice(0, 10)}`;
  const dailyCap = Number(process.env.GEMINI_TTS_DAILY_CAP) || DEFAULT_DAILY_CAP;
  // Si Gemini no da la voz, la ficha se libera y el audio no cuenta: así se puede reintentar.
  const release = async () => {
    try { await redis("pipeline", [["DEL", usedKey], ["DECR", dayKey]]); } catch (_) { /* Se pierde un reintento; no pasa nada. */ }
  };
  try {
    const [today] = await redis("pipeline", [["EVAL", CLAIM_SCRIPT, 2, usedKey, dayKey]]);
    if (today === -1) return json(409, { error: "usada" });
    if (today > dailyCap) {
      await release();
      return json(503, { error: "sin-voz" });
    }
  } catch (error) {
    console.error(error.message);
    return json(503, { error: "sin-voz" });
  }

  const model = process.env.GEMINI_TTS_MODEL || DEFAULT_MODEL;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${STYLE_TAG} ${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || DEFAULT_VOICE } } }
        }
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS)
    });
    // 429 = el plan gratuito de voz se ha agotado (por minuto o por día): Shenron responde sin voz.
    if (!response.ok) throw new Error(`Gemini TTS ${response.status}`);
    const data = await response.json();
    const audio = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
    if (!audio?.data) throw new Error("Gemini TTS sin audio");
    const wav = toWav(Buffer.from(audio.data, "base64"), audio.mimeType);
    return new Response(wav, { status: 200, headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
  } catch (error) {
    console.error(error.message);
    await release();
    return json(503, { error: "sin-voz" });
  }
}
