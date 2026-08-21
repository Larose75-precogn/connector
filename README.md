# connector — Connexions aux systèmes externes

Tous les connecteurs de Structory, regroupés : bancaires (Powens, Enable Banking, Mercury, Qonto),
documents (Docling), LLM (Ollama, routeur cloud), stockage (Drive), et les connecteurs Apps Script
(transport vers les services). Un connecteur = un fichier isolé : si un système externe change son
API, seul ce fichier change.

Composant : **Connector**. Regroupe le code jusqu'ici dispersé dans `executor`, `analyzor` et `bibliotheque`.
Licence : Apache-2.0.
