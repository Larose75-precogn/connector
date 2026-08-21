/**
 * ============================================================
 * PRECOGN CONNECTOR v1.0.0
 * ============================================================
 * 
 * TABLE DES MATIÈRES
 * ------------------
 * 1.  PHILOSOPHIE DU CONNECTEUR
 * 2.  CONFIGURATION
 * 3.  MENU
 * 4.  INTERFACE COMMUNE (getConnectorInfo)
 * 5.  CONSTRUCTEUR D'URL
 * 6.  LANCEMENT DE PRECOGN (launchPreCogn)
 * 7.  SPÉCIFICATION DU PROTOCOLE
 * 8.  NOTES DE VERSION
 * ============================================================
 */

// ============================================================
// 1. PHILOSOPHIE DU CONNECTEUR
// ============================================================
/**
 * Ce script ne contient aucune logique métier.
 * Il connecte simplement un Google Sheet à la Web App PreCogn.
 *
 * Le Connector transmet uniquement l'identité du contexte.
 * Il ne transmet jamais les données métier.
 *
 * Toute l'intelligence, l'interface et les traitements sont
 * réalisés par le Navigator.
 *
 * Thin Client / Fat Server
 */

// ============================================================
// 2. CONFIGURATION
// ============================================================

/**
 * URL de la Web App PreCogn
 * 
 * V1 : URL Apps Script
 * V2 : https://navigator.precogn.org
 * V3 : https://app.precogn.org
 */
const PRECOGN_URL = 'https://script.google.com/macros/s/AKfycbwTMqsl0aRweL-jNlHk5npLf48mOqm2O7H8lt103jSCZXZWTOi_hL0dCJklJv-kXmQPYA/exec';

// ============================================================
// 3. MENU
// ============================================================

/**
 * Ajoute le menu PreCogn dans le Google Sheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🧠 PreCogn')
    .addItem('🚀 Entrer dans PreCogn', 'launchPreCogn')
    .addToUi();
}

// ============================================================
// 4. INTERFACE COMMUNE (TOUS LES CONNECTEURS)
// ============================================================

/**
 * Retourne les informations d'identification du connecteur
 * 
 * Cette fonction est commune à TOUS les connecteurs PreCogn :
 *   - Google Sheets Connector
 *   - Google Docs Connector
 *   - Gmail Connector
 *   - Redmine Connector
 *   - Notion Connector
 *   - Excel Connector
 *   - Outlook Connector
 * 
 * @returns {Object} Informations du connecteur
 */
function getConnectorInfo() {
  return {
    protocol: 'precogn-v1',
    connector: 'google-sheets',
    version: '1.0.0'
  };
}

// ============================================================
// 5. CONSTRUCTEUR D'URL
// ============================================================

/**
 * Construit l'URL de PreCogn avec les paramètres minimum
 * 
 * @returns {string} URL complète avec paramètres encodés
 */
function buildPreCognUrl() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const info = getConnectorInfo();
  
  const params = {
    protocol: info.protocol,
    connector: info.connector,
    connectorVersion: info.version,
    sheetId: ss.getId()
  };
  
  let url = PRECOGN_URL + '?';
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    parts.push(key + '=' + encodeURIComponent(value));
  }
  url += parts.join('&');
  
  return url;
}

// ============================================================
// 6. LANCEMENT DE PRECOGN (INTERFACE COMMUNE)
// ============================================================

/**
 * Lance PreCogn en ouvrant la Web App dans un nouvel onglet
 * 
 * Cette fonction est commune à TOUS les connecteurs PreCogn.
 * Chaque connecteur l'implémente de la même manière.
 */
function launchPreCogn() {
  const url = buildPreCognUrl();
  
  // Ouverture dans un nouvel onglet via une popup
  // (contrainte technique d'Apps Script)
  const html = `
    <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 30px;
            text-align: center;
          }
          a {
            display: inline-block;
            padding: 12px 24px;
            background: #1a73e8;
            color: white;
            text-decoration: none;
            border-radius: 4px;
            font-size: 16px;
          }
          a:hover {
            background: #1557b0;
          }
        </style>
      </head>
      <body>
        <a href="${url}" target="_blank">🚀 Ouvrir PreCogn</a>
      </body>
    </html>
  `;
  
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setHeight(120).setWidth(300),
    'Connexion à PreCogn'
  );
}
// ============================================================
// 7. SPÉCIFICATION DU PROTOCOLE
// ============================================================

/**
 * PROTOCOLE precogn-v1
 * --------------------
 * 
 * Interface commune à tous les connecteurs :
 * 
 *   function getConnectorInfo() {
 *     return {
 *       protocol: "precogn-v1",
 *       connector: "google-sheets",  // ou "google-docs", "gmail", "redmine", etc.
 *       version: "1.0.0"
 *     };
 *   }
 * 
 *   function launchPreCogn() {
 *     // Ouvre PreCogn
 *   }
 * 
 * Paramètres obligatoires transmis à PreCogn :
 *   - protocol         : "precogn-v1"
 *   - connector        : Identifiant unique du connecteur
 *   - connectorVersion : Version du connecteur
 *   - sheetId          : ID du Google Sheet (spécifique à ce connecteur)
 * 
 * Évolution :
 *   - Toute évolution incompatible du protocole entraîne
 *     un changement de version (precogn-v2, etc.)
 *   - Le Navigator utilise le protocole pour interpréter
 *     les paramètres reçus
 */

// ============================================================
// 8. NOTES DE VERSION
// ============================================================

/**
 * v1.0.0 - 2026-07-01
 * -------------------
 * - Version initiale stable
 * - Interface commune : getConnectorInfo() + launchPreCogn()
 * - Protocole precogn-v1
 * - Support Google Sheets uniquement
 * - 48 lignes de code
 * 
 * Évolutions prévues :
 * - v2.0.0 : URL stable (navigator.precogn.org)
 * - v3.0.0 : Support de nouveaux connecteurs
 * - v4.0.0 : Protocole precogn-v2
 */