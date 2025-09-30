// === Config ===
const MODEL_NAME = "gemini-2.5-flash"; // modelo vigente en v1
const API_KEY = "AIzaSyAI9lF9SVz_irAxLAKzD8X3YrDKZwOt5e8";     // SOLO pruebas; no subir a git
const API_ENDPOINT = "https://generativelanguage.googleapis.com/v1/models/" + MODEL_NAME + ":generateContent?key=" + encodeURIComponent(API_KEY);

// === UI refs ===
const messageList = document.getElementById("message-list");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const statusEl = document.getElementById("status");
const submitButton = form.querySelector("button[type='submit']");
const conversationHistory = [];

let typingIndicatorBubble = null;

// === Utils UI ===
function ensureInView() {
  messageList.scrollTop = messageList.scrollHeight;
}

function appendMessage(text, author = "ai") {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${author}`;
  bubble.textContent = text;
  messageList.appendChild(bubble);
  ensureInView();
  return bubble;
}

function setStatus(text) {
  statusEl.textContent = text || "";
}

function showTypingIndicator() {
  if (typingIndicatorBubble) return;
  typingIndicatorBubble = document.createElement("div");
  typingIndicatorBubble.className = "bubble ai loading";
  typingIndicatorBubble.setAttribute("aria-hidden", "true");
  typingIndicatorBubble.innerHTML = "<span></span><span></span><span></span>";
  messageList.appendChild(typingIndicatorBubble);
  ensureInView();
}

function hideTypingIndicator() {
  if (!typingIndicatorBubble) return;
  try { typingIndicatorBubble.remove(); } finally { typingIndicatorBubble = null; }
}

function typewriter(element, text, duration = 2000) {
  element.textContent = "";
  if (!text) return Promise.resolve();
  const content = String(text);
  const totalChars = content.length;

  return new Promise(resolve => {
    const start = performance.now();
    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const charsToShow = Math.max(1, Math.floor(progress * totalChars));
      element.textContent = content.slice(0, charsToShow);
      ensureInView();
      if (progress >= 1) { element.textContent = content; resolve(); return; }
      requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  });
}

async function renderAIMessage(text) {
  const bubble = document.createElement("div");
  bubble.className = "bubble ai";
  bubble.dataset.state = "typing";
  messageList.appendChild(bubble);
  ensureInView();
  await typewriter(bubble, text, 2000);
  bubble.dataset.state = "complete";
  return bubble;
}

// === Inventario ===
async function fetchInventory() {
  const response = await fetch("php/disponible.php", {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Error al obtener inventario (${response.status})`);
  }
  const payload = await response.json();
  if (!payload.success) {
    throw new Error(payload.error || "Respuesta inválida desde disponible.php");
  }
  return payload; // { success:true, data:[...], count:n }
}

// === Búsqueda relevante local ===
function normalizeText(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getKeywords(message) {
  return normalizeText(message)
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 3);
}

function selectRelevant(items, query) {
  const keywords = getKeywords(query);
  const hasKeywords = keywords.length > 0;

  const ranked = items.map(item => {
    const haystack = normalizeText([
      item.articulo,
      item.variedad,
      item.cultivo,
      item.ubicacion,
      item.vuelo
    ].join(" "));

    let score = 0;
    if (hasKeywords) {
      score += keywords.reduce((acc, w) => acc + (haystack.includes(w) ? 3 : 0), 0);
    }

    const available = Number.parseFloat(item.disponible) || 0;
    if (available > 0) score += 1;

    if (String(item.es_outlet) === "0") score += 1.5;

    const fechaTime = Date.parse(item.fecha) || 0;

    return { item, score, fechaTime };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const outletA = Number.parseInt(a.item?.es_outlet, 10) || 0;
    const outletB = Number.parseInt(b.item?.es_outlet, 10) || 0;
    if (outletA !== outletB) return outletA - outletB;
    return (b.fechaTime || 0) - (a.fechaTime || 0);
  });

  return ranked.slice(0, 15).map(entry => entry.item);
}

// === Prompt ===
function buildPrompt({ userMessage, relevantItems, inventoryCount, history }) {
  const historySection = history
    .slice(-6)
    .map(entry => `${entry.role === "user" ? "Cliente" : "Asistente"}: ${entry.content}`)
    .join("\n");

  const inventorySection = relevantItems.length > 0
    ? relevantItems.map(item => {
        const outlet = String(item.es_outlet) === "1" ? "Sí" : "No";
        const reservado = Number.parseFloat(item.reservado) || 0;
        const disponible = Number.parseFloat(item.disponible) || 0;
        const cajas = Number.parseFloat(item.cajas) || 0;
        return `- Producto: ${item.articulo} | Variedad: ${item.variedad} | Cultivo: ${item.cultivo} | Fecha: ${item.fecha || "sin fecha"} | Ubicación: ${item.ubicacion || "sin ubicación"} | Vuelo: ${item.vuelo || "sin vuelo"} | Disponible: ${disponible} | Cajas: ${cajas} | Reservado: ${reservado} | Outlet: ${outlet} | Caducidad: ${item.caducidad || ""} | Tiempo outlet: ${item.tiempo_outlet || ""}`;
      }).join("\n")
    : "(No se encontraron registros relevantes con disponibilidad positiva.)";

  return `Actúa como un asistente comercial experto en flor cortada que responde en español.
Tu objetivo es recomendar productos disponibles y explicar claramente por qué encajan con la solicitud del cliente.
Usa los datos proporcionados y evita inventar información que no esté en el inventario.

Contexto del inventario: actualmente hay ${inventoryCount} referencias abiertas.
Historial reciente:
${historySection || "(Sin conversaciones previas)"}

Solicitud actual del cliente:
"""${userMessage}"""

Registros relevantes:
${inventorySection}

Instrucciones para la respuesta:
- Responde con un tono profesional, cercano y proactivo.
- Prioriza productos frescos (fecha más reciente) y que no sean outlet salvo que el cliente pida liquidaciones.
- Explica brevemente por qué cada sugerencia es adecuada (color, disponibilidad, frescura, ubicación, tiempo de salida).
- Si consideras alternativas, descríbelas también desde el inventario.
- Si no hay disponibilidad, indícalo y ofrece sugerencias de manejo (reservar, revisar próximamente, etc.).
- Evita listas largas: recomienda máximo 3 opciones priorizadas.
- Incluye datos clave como ubicación, disponibilidad y fecha estimada de salida cuando sea relevante.
- Sé conciso.`;
}

// === Parse de respuesta REST ===
function extractText(data) {
  if (!data) return "";
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  for (const cand of candidates) {
    const parts = cand?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }
  return "";
}

// === Call REST (fetch) ===
async function callModel(prompt) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  };

  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Error al generar respuesta (${response.status}). ${detail}`);
  }

  return response.json();
}

// === Orquestación ===
async function generateResponse(userMessage) {
  setStatus("Consultando disponibilidad actual...");
  const inventory = await fetchInventory();

  const relevantItems = selectRelevant(inventory.data || [], userMessage);

  setStatus("Generando propuesta inteligente...");
  const prompt = buildPrompt({
    userMessage,
    relevantItems,
    inventoryCount: inventory.count || 0,
    history: conversationHistory
  });

  const result = await callModel(prompt);
  const reply = (extractText(result).trim()) || "No he podido generar una respuesta en este momento.";

  hideTypingIndicator();
  conversationHistory.push({ role: "assistant", content: reply });
  await renderAIMessage(reply);
  setStatus("");
}

// === Eventos ===
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  appendMessage(message, "user");
  conversationHistory.push({ role: "user", content: message });
  input.value = "";
  input.setAttribute("aria-busy", "true");
  submitButton.disabled = true;
  input.disabled = true;
  showTypingIndicator();

  try {
    await generateResponse(message);
  } catch (error) {
    console.error(error);
    hideTypingIndicator();
    setStatus("");
    const fallback = "No he podido conectarme con la IA o con el inventario. Inténtalo nuevamente en unos minutos.";
    conversationHistory.push({ role: "assistant", content: fallback });
    await renderAIMessage(fallback);
  } finally {
    submitButton.disabled = false;
    input.disabled = false;
    input.removeAttribute("aria-busy");
    input.focus();
  }
});

// === Mensaje de bienvenida ===
const greeting = "Hola, soy tu asistente comercial IA. Cuéntame qué necesita tu cliente y revisaré el inventario para ti.";
conversationHistory.push({ role: "assistant", content: greeting });
renderAIMessage(greeting);
