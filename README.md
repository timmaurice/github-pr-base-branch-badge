# GitHub PR Base Branch Badge Extension

Eine Chrome Extension, die den Base Branch (Target Branch) von Pull Requests in der GitHub PR-Listenansicht als farbigen Badge anzeigt und Filterung nach einem oder mehreren Base Branches ermöglicht.

## Features

✅ **Base Branch Badge** - Zeigt den Base Branch als farbigen Badge (PR-Icon + Name) neben jeder PR
✅ **Klick-Filter** - Klick auf einen Badge filtert sofort nach genau diesem Base Branch (Filterzustand open/closed bleibt erhalten)
✅ **Multi-Select-Dropdown** - "Base Branch ▾" vor dem Author-Filter, analog zu GitHubs "Filter by author": Checkbox-Liste aller bekannten Branches, mehrere gleichzeitig wählbar, zeigt die Anzahl aktiver Filter als Badge am Button
✅ **Popup-Einstellungen** - Farben pro Branch anpassen, Branches hinzufügen/umbenennen/entfernen
✅ **Persistentes Caching** - Base Branch (24h TTL) und einmal gesehene Branch-Namen werden in `chrome.storage.local` zwischengespeichert
✅ **Dark Mode Support** - Automatische Anpassung an das Betriebssystem-Farbschema
✅ **Turbo-/Infinite-Scroll-fest** - Funktioniert auch bei dynamisch nachgeladenen PRs und beim Wechsel zwischen Issues/Pulls-Tabs ohne vollständigen Seiten-Reload

## Installation (Unpacked Mode)

1. `chrome://extensions/` öffnen
2. "Developer mode" oben rechts aktivieren
3. "Load unpacked" klicken und diesen Ordner auswählen
4. Zu einer GitHub PR-Liste navigieren (z.B. `github.com/<org>/<repo>/pulls`)

## Verwendung

1. Neben jeder PR erscheint ein farbiger Badge mit PR-Icon und Branch-Namen
2. **Klick auf einen Badge** filtert die Liste nach genau diesem Base Branch
3. **"Base Branch ▾"** öffnet ein Dropdown mit Checkboxen für alle bekannten Branches — mehrere gleichzeitig ankreuzbar, Auswahl wird sofort angewendet; die Zahl am Button zeigt die Anzahl aktiver Filter
4. **Extension-Icon klicken** öffnet das Einstellungs-Popup: Farben ändern, Branches hinzufügen/umbenennen/entfernen, speichern

## Architektur

```
manifest.json    Manifest v3 Konfiguration
content.js       Content Script — findet PRs, holt Base Branch, fügt Badges/Filter-Dropdown ein
background.js    Service Worker — verwaltet den persistenten 24h-Cache für Base-Branch-Lookups
popup.html/js    Einstellungs-Popup (Branch-Farben verwalten)
styles.css       Basis-Styles für den Content-Script-Kontext
icon*.png/svg    Extension-Icon
```

### Wie der Base Branch ermittelt wird

`content.js` ruft für jede neu gesichtete PR `GET https://api.github.com/repos/{owner}/{repo}/pulls/{number}` auf und liest `base.ref` direkt aus der JSON-Antwort — kein HTML-Scraping mehr. Das Ergebnis wird danach zweistufig gecacht:

1. In-Memory (`branchCache`, pro Seitenaufruf)
2. Persistent über `background.js` in `chrome.storage.local` (24h TTL)

**Wichtig:** `api.github.com` ist eine andere Origin als `github.com` und erhält daher **nicht** automatisch die Session-Cookies des eingeloggten Browsers. Für private Repos (und für ein höheres Rate-Limit) muss im Popup ein GitHub Personal Access Token hinterlegt werden — ein Fine-grained Token mit Berechtigung "Pull requests: Read-only" genügt. Ohne Token funktioniert die Extension nur für öffentliche Repos und ist auf 60 Requests/Stunde limitiert (mit Token: 5000/Stunde).

Zusätzlich merkt sich `content.js` jeden einmal gesehenen Branch-Namen dauerhaft in `chrome.storage.local` (`discoveredBranches`), damit auch Branches ohne konfigurierte Farbe im Filter-Dropdown auftauchen — auch nachdem sie durch einen Filter aus der aktuellen Ansicht verschwunden sind.

### Branch-Farben

`popup.js` verwaltet einen Farb-Map (`branchColors`) in `chrome.storage.local`. Branch-Namen sind frei wählbar (Rename/Hinzufügen/Entfernen im Popup) — `content.js` sucht die Farbe generisch per Branch-Namen und fällt auf die "Standard"-Farbe zurück, falls kein Eintrag existiert. Nach dem Speichern sendet das Popup ein `reloadBadges`-Signal an alle offenen GitHub-Tabs, woraufhin bestehende Badges entfernt und mit den neuen Farben neu gezeichnet werden (aus dem In-Memory-Cache, ohne erneuten Netzwerk-Request).

### Mehrfachauswahl im Filter

GitHub behandelt wiederholte `base:`-Qualifier in der Suche als OR, nicht als AND — `base:master base:beta` matcht PRs mit Base `master` **oder** `beta`. Die Query-Bauhelfer in `content.js` (`getSelectedBaseBranches`, `buildQueryForBaseBranches`, `navigateToQuery`) nutzen genau dieses Verhalten; ein Klick auf einen Badge setzt dagegen bewusst nur genau einen Branch (ersetzt die aktuelle Auswahl), das Dropdown ist der Weg für Mehrfachauswahl.

### Navigation zwischen Issues und Pulls

GitHub nutzt Turbo (Hotwire) für die Navigation zwischen `/issues` und `/pulls` — die URL ändert sich über die History API ohne echten Seiten-Reload. Damit die Badges/das Dropdown trotzdem zuverlässig erscheinen:

- Das Manifest matched pauschal `https://github.com/*` statt nur `*/pulls*`/`*/issues*` — PR-Detailseiten (`/pull/<n>`, Singular) sind ein eigenes Muster, und wer zuerst dort landet (oder per Turbo Liste → Detail → Liste navigiert), darf nicht ohne injiziertes Script dastehen. `content.js` selbst entscheidet per `isPRListPage()`, wo tatsächlich etwas passiert.
- `content.js` reagiert auf das `turbo:load`-Event und hängt den `MutationObserver` bei jeder Navigation neu an das aktuelle `document.body` — GitHub tauscht dieses Element bei manchen Navigationen komplett aus, wodurch ein alter Observer sonst den Anschluss verliert.
- Änderungen an der Filterauswahl (Checkbox, Badge-Klick) lösen dagegen einen echten Seiten-Reload aus (bestätigt durch Beobachtung), nicht nur eine Turbo-Soft-Navigation.

## Troubleshooting

**Badge wird nicht angezeigt?**
- Seite neu laden (F5)
- Extension in `chrome://extensions/` auf Fehler prüfen
- Browser-Konsole (F12) auf `Base Branch Badge:`-Warnungen prüfen — ein `404` bei privaten Repos ohne Token bedeutet: Token fehlt; ein `403` bedeutet: Rate-Limit erreicht, ein Token (oder ein anderes Token mit höherem Limit) hinzufügen

**404 trotz gesetztem Token bei einem Organisations-Repo?**
- Fine-grained Tokens mit "All repositories" gelten nur für Repos, die einem persönlich gehören — Repos einer Organisation (z.B. `hafele-group-it`) sind davon ausgenommen, bis die Organisation Fine-grained-Token-Zugriff explizit erlaubt/genehmigt hat (Org-Settings → Personal access tokens)
- Schnellerer Workaround: ein **Classic Token** mit Scope `repo` erstellen (`github.com/settings/tokens` → "Generate new token (classic)") — braucht keine Org-Genehmigung, außer die Organisation erzwingt SSO (dann Token einmalig per "Enable SSO" für die Org autorisieren)

**Popup öffnet sich nicht?**
- Extension-Icon in der Toolbar anpinnen (Puzzle-Symbol 🧩 → Pin)
- Alternativ: `chrome://extensions/` → Details → "Erweiterungsoptionen" existiert nicht mehr, Einstellungen laufen ausschließlich über das Popup

**Ein Branch fehlt im Filter-Dropdown?**
- Er muss mindestens einmal als Badge sichtbar gewesen sein (oder in den Popup-Farbeinstellungen konfiguriert sein), damit er in `discoveredBranches` landet

## Bekannte Grenzen

- Jede neu gesichtete PR verursacht einen zusätzlichen API-Request, um den Base Branch zu ermitteln (durch Caching nur beim ersten Mal pro PR)
- Ohne hinterlegten Token: nur öffentliche Repos, 60 API-Requests/Stunde (geteilt über alle Extensions/Tools, die unauthentifiziert auf die GitHub-API zugreifen)
- Branch-Namen-Abgleich ist case-sensitive und muss exakt dem GitHub-Namen entsprechen
- `discoveredBranches` wächst nur (nie automatisch bereinigt) — gelöschte/umbenannte Branches bleiben dauerhaft im Filter-Dropdown sichtbar
- Nur `github.com`, kein GitHub Enterprise Server (eigene Domain) — `manifest.json` müsste dafür um die entsprechende Domain erweitert werden
