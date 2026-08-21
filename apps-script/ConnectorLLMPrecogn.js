// ================================================================
// 📚 Connector LLMPreCogn
// Bibliothèque Générale PreCogn
// ================================================================

const LLMPRECOGN_URL = "https://llm.precogn.org";

/**
 * Journal interne
 */
function _log(level, message) {
  Logger.log("[" + level + "] " + message);
}

/**
 * Construit une query string
 */
function _buildQueryString(params) {
  if (!params) return "";

  return Object.keys(params)
    .filter(k => params[k] !== null && params[k] !== undefined)
    .map(k =>
      encodeURIComponent(k) +
      "=" +
      encodeURIComponent(params[k])
    )
    .join("&");
}

/**
 * Fonction privée
 */
function _callWorker(endpoint, payload, method) {

  method = method || "POST";

  let url = LLMPRECOGN_URL + endpoint;

  const options = {
    method: method,
    muteHttpExceptions: true,
    contentType: "application/json"
  };

  if (method === "GET") {

    const qs = _buildQueryString(payload);

    if (qs) {
      url += "?" + qs;
    }

  } else {

    if (payload !== null && payload !== undefined) {
      options.payload = JSON.stringify(payload);
    }

  }

  const response = UrlFetchApp.fetch(url, options);

  const code = response.getResponseCode();

  const text = response.getContentText();

  if (code !== 200) {
    throw new Error("HTTP " + code + " : " + text);
  }

  return JSON.parse(text);

}

/**
 * ============================================================
 * API PUBLIQUE
 * ============================================================
 *
 * Bibliotheque.llmExecute(...)
 *
 */
function llmExecute(endpoint, data, method) {

  return _callWorker(endpoint, data, method);

}
function testBibliotheque() {
  return "OK";
}