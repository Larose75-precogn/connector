// ================================================================
// 📚 Connector Docling — registre (et bus d'adressage) de l'écosystème PreCogn
// Bibliothèque Générale PreCogn
// ================================================================
// Docling sait, pour un orgId donné, où vivent ses données réelles (uid + adresse BYOS —
// dossier Drive aujourd'hui, potentiellement un autre backend plus tard). C'est un connector au
// même titre que les autres (ConnectorLedger.js, ConnectorAnalyzor.js...) : il parle à Analyzor
// (voir docling_registry.py côté Python) via le transport générique `analyzor()`
// (ConnectorAnalyzor.js) — Docling vit dans Analyzor, ce n'est pas un service séparé.
//
// Aucun autre composant ne doit garder sa propre logique de résolution orgId → adresse : tout
// passe par ici (identityCreateOrg l'appelle juste après la création d'une organisation).

/** Enregistre l'adresse BYOS d'une organisation dans Docling. Non-bloquant côté appelant :
 * Analyzor retrouvera quand même l'org par repli si cet appel échoue (voir docling_registry.py
 * côté Python pour le detail du repli). */
function doclingRegisterOrgAddress(orgId, uid, folderId, backend) {
  return analyzor("/api/org/" + encodeURIComponent(orgId) + "/address",
    { uid: uid, folderId: folderId, backend: backend || "gdrive" }, "POST");
}
