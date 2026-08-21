// ================================================================
// 📚 Connector Ollama — Bibliothèque Générale PreCogn
// ================================================================
//
// Relais vers le service Ollama local via Analyzor.
// Aucune logique métier — API uniforme uniquement.
//
// Utilisé par : LLMPreCogn, Facilitator, Agents, Flows
// ================================================================

/**
 * Vérifie que le service Ollama répond.
 * @returns {{ success: boolean, status?: string, error?: string }}
 */
function ollamaStatus() {
  return analyzor("/api/ollama/status", null, "GET");
}

/**
 * Liste les modèles installés sur Ollama.
 * @returns {{ success: boolean, models?: Object[], error?: string }}
 */
function ollamaModels() {
  return analyzor("/api/ollama/models", null, "GET");
}

/**
 * Génère une complétion à partir d'un prompt (API /generate).
 * @param {string}  prompt
 * @param {string=} model    Défaut côté serveur : qwen2.5-coder:3b
 * @param {Object=} options  Paramètres Ollama (temperature, num_ctx, ...)
 * @returns {{ success: boolean, content?: string, model?: string, error?: string }}
 */
function ollamaGenerate(prompt, model, options) {
  const payload = { prompt: prompt };
  if (model)   payload.model   = model;
  if (options) payload.options = options;
  return analyzor("/api/ollama/generate", payload, "POST");
}

/**
 * Conversation multi-tour (API /chat).
 * @param {Object[]} messages  [{role, content}, ...]
 * @param {string=}  model     Défaut côté serveur : qwen2.5-coder:3b
 * @param {Object=}  options   Paramètres Ollama (temperature, num_ctx, ...)
 * @returns {{ success: boolean, content?: string, model?: string, error?: string }}
 */
function ollamaChat(messages, model, options) {
  const payload = { messages: messages };
  if (model)   payload.model   = model;
  if (options) payload.options = options;
  return analyzor("/api/ollama/chat", payload, "POST");
}

/**
 * Génère un embedding vectoriel.
 * @param {string}  text
 * @param {string=} model  Défaut côté serveur : nomic-embed-text
 * @returns {{ success: boolean, embedding?: number[], error?: string }}
 */
function ollamaEmbedding(text, model) {
  const payload = { input: text };
  if (model) payload.model = model;
  return analyzor("/api/ollama/embed", payload, "POST");
}
