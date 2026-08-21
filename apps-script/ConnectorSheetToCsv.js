// ================================================================
// 📚 Connector SheetToCsv
// Bibliothèque Générale PreCogn
// ================================================================

const SHEETTOCSV_URL =
  "https://script.google.com/macros/s/AKfycbzlrVesIT6S3nkgiJG77sj2wtRtGrIq6zlGE66NdcEpTO93bikJBScv9po6LOOIuUNY/exec";

/**
 * Fonction privée
 */
function _callSheetToCsv(sheetUrl) {

  const response = UrlFetchApp.fetch(SHEETTOCSV_URL, {
    method: "POST",
    payload: {
      url: sheetUrl
    },
    muteHttpExceptions: true
  });

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
 */

/**
 * Convertit un Google Sheet en CSV.
 *
 * @param {string} sheetUrl
 * @returns {Object}
 */
function sheetToCsv(sheetUrl) {

  return _callSheetToCsv(sheetUrl);

}

function testSheetToCsv() {

  const url = "https://docs.google.com/spreadsheets/d/TON_ID_DE_SHEET";

  const result = sheetToCsv(url);

  Logger.log(JSON.stringify(result, null, 2));

}