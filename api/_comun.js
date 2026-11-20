// Utilidades compartidas por las funciones del Oráculo (api/deseo.js y api/voz.js).
// Vercel no publica como ruta los archivos de api/ que empiezan por «_».

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const REDIS_TIMEOUT_MS = 3000;
// Una respuesta solo puede convertirse en voz durante estos minutos después de escribirse.
const VOICE_TICKET_SECONDS = 5 * 60;

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

export function hashId(id, salt) {
  // HMAC con una sal secreta: en Upstash nunca se guardan la IP ni el identificador, solo una huella seudónima.
  return createHmac("sha256", salt).update(id).digest("hex");
}

export function sameOrigin(request) {
  // Frena a otras webs que intenten usar el Oráculo desde el navegador de sus visitantes.
  // No frena a un script (puede no mandar Origin): eso lo limitan los topes de cada función.
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch (_) {
    return false; // «Origin: null» (iframes aislados) u otro valor raro.
  }
}

// Deseo que Shenron no puede entender: se detecta antes de contar nada ni llamar a Gemini, y devuelve
// el caso (para que el navegador elija la frase) o null si el deseo es válido. Casos, en este orden:
//   «vacio»      nada o solo espacios: «», «   ».
//   «signos»     ni una letra ni un número: «???», «😀», «¡¡!!».
//   «numero»     solo cifras, números u ordinales: «7», «42», «siete», «séptimo», «3.º», «1ª».
//   «galimatias» letras que no forman palabras:
//                  - menos de dos letras: «a», «😀a» (salvo un ideograma, como «龍», que ya es una palabra);
//                  - letras latinas sin ninguna vocal: «xkqzv», «bcdf»;
//                  - cinco consonantes seguidas o más, que no se dan en español: «asdfghjkl»;
//                  - una sola palabra con cuatro teclas seguidas de una fila del teclado: «asdf», «qwer», «lkjh».
// La misma función está copiada en script.js (sin servidor no se puede compartir): si cambias una, cambia la otra.
const NUMBER_WORDS = new Set([
  "cero", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
  "veinte", "cien", "ciento", "mil", "millon", "primero", "primera", "primer", "segundo", "segunda", "tercero",
  "tercera", "tercer", "cuarto", "cuarta", "quinto", "quinta", "sexto", "sexta", "septimo", "septima", "octavo",
  "octava", "noveno", "novena", "decimo", "decima", "undecimo", "undecima", "duodecimo", "duodecima"
]);
// Lo que acompaña a una cifra para hacerla ordinal: «3.º» → «3» y «o»; «1er» → «1» y «er».
const ORDINAL_ENDINGS = new Set(["o", "a", "os", "as", "er", "ero", "era"]);
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkln", "zxcvbnm"];

export function unclearWish(text) {
  // Minúsculas y sin tildes, para que «á» cuente como vocal y «ñ» como consonante; «º» y «ª» pasan a letra.
  const plain = text.toLowerCase().replace(/º/g, "o").replace(/ª/g, "a").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!plain) return "vacio";
  const tokens = plain.match(/\p{N}+|\p{L}+/gu) || [];
  if (!tokens.length) return "signos";
  const isNumber = (token) => /^\p{N}+$/u.test(token) || NUMBER_WORDS.has(token) || /^\p{L}*esim[oa]s?$/u.test(token);
  if (tokens.some(isNumber) && tokens.every((token) => isNumber(token) || ORDINAL_ENDINGS.has(token))) return "numero";
  const words = plain.match(/\p{L}+/gu) || [];
  // Un ideograma chino o japonés es una palabra entera («龍»): esa letra sola sí vale.
  if (words.join("").length < 2 && !/\p{Script=Han}/u.test(plain)) return "galimatias";
  const latin = plain.replace(/[^a-z]/g, "");
  if (latin && !/[aeiouy]/.test(latin)) return "galimatias";
  if (/[b-df-hj-np-tv-xz]{5,}/.test(plain)) return "galimatias";
  if (words.length === 1 && onKeyboardRow(words[0])) return "galimatias";
  return null;
}

// ¿Tiene la palabra cuatro letras seguidas de una fila del teclado, en un sentido o en el otro?
function onKeyboardRow(word) {
  const rows = KEYBOARD_ROWS.flatMap((row) => [row, [...row].reverse().join("")]);
  for (let i = 0; i + 4 <= word.length; i += 1) {
    if (rows.some((row) => row.includes(word.slice(i, i + 4)))) return true;
  }
  return false;
}

export async function redis(endpoint, commands) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Upstash sin configurar");
  const response = await fetch(`${url}/${endpoint}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Upstash ${response.status}`);
  const results = await response.json();
  const failed = results.find((item) => item.error);
  if (failed) throw new Error(`Upstash: ${failed.error}`);
  return results.map((item) => item.result);
}

// /multi-exec ejecuta los comandos como una transacción: o todos o ninguno.
export const transaction = (commands) => redis("multi-exec", commands);

// Ficha de voz: prueba de que un texto lo ha escrito el Oráculo hace poco. Sin ella, api/voz.js no
// genera audio, para que nadie use la cuota de voz para leer textos propios.
// Formato: «caducidad.aleatorio.firma», con la firma = HMAC(secreto, "voz|caducidad|aleatorio|texto").
// El valor aleatorio hace única cada ficha aunque dos personas reciban el mismo texto en el mismo segundo.
// Las fichas se firman con una clave derivada del secreto, distinta de la que seudonimiza IPs y cookies.
function voiceSignature(text, expires, nonce, secret) {
  const key = createHmac("sha256", secret).update("voz-ficha-v1").digest();
  return createHmac("sha256", key).update(`voz|${expires}|${nonce}|${text}`).digest("hex");
}

export function voiceTicket(text, secret) {
  const expires = Math.floor(Date.now() / 1000) + VOICE_TICKET_SECONDS;
  const nonce = randomBytes(8).toString("hex");
  return `${expires}.${nonce}.${voiceSignature(text, expires, nonce, secret)}`;
}

// Devuelve la firma si la ficha es válida para ese texto y no ha caducado; si no, null.
export function checkVoiceTicket(ticket, text, secret) {
  const match = /^(\d{10})\.([a-f0-9]{16})\.([a-f0-9]{64})$/.exec(typeof ticket === "string" ? ticket : "");
  if (!match) return null;
  const expires = Number(match[1]);
  if (expires < Date.now() / 1000) return null;
  const expected = Buffer.from(voiceSignature(text, expires, match[2], secret), "hex");
  const given = Buffer.from(match[3], "hex");
  // timingSafeEqual: compara sin dar pistas por el tiempo que tarda.
  return timingSafeEqual(expected, given) ? match[3] : null;
}
