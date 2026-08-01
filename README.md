# OQ Python Academy

Interaktive, offlinefähige Python-Lernakademie vom absoluten Beginner bis zu Architektur und technischer Führung.

## Enthalten

- 10 aufeinander aufbauende Level
- Erklären → Verstehen → geführt üben → selbstständig arbeiten → Klausur
- Anklickbare, bereits erreichte Unterrichtsphasen
- Code-Abgabe mit Strukturtests und Ausgabevorschau
- 155 Glossarbegriffe mit Suche, Filtern, Favoriten und persönlichen Notizen
- Automatische lokale Speicherung über IndexedDB
- Optionaler Backup-Export und -Import
- Installierbare Progressive Web App (PWA)
- Automatische Updates über GitHub Pages und Service Worker
- Offlinebetrieb nach dem ersten vollständigen Laden

## GitHub Pages aktivieren

1. Repository auf GitHub öffnen.
2. `Settings` auswählen.
3. Links unter `Code and automation` auf `Pages` klicken.
4. Unter `Build and deployment` bei `Source` die Option `Deploy from a branch` auswählen.
5. Branch `main` und Ordner `/(root)` wählen.
6. `Save` anklicken.
7. Nach der Bereitstellung erscheint die Adresse:

   `https://aleshon.github.io/oqpythonacademy/`

## Als App installieren

1. Die veröffentlichte GitHub-Pages-Adresse in Edge oder Chrome öffnen.
2. In der App `Als App installieren` anklicken oder das Installationssymbol in der Browser-Adressleiste verwenden.
3. Danach über Startmenü oder Desktop starten.

## Automatische Updates

Jeder Push auf `main` wird von GitHub Pages veröffentlicht. Die Anwendung prüft beim Start, beim erneuten Öffnen und alle 15 Minuten die Datei `version.json`.

Bei einem Update müssen mindestens diese beiden Stellen dieselbe neue Version erhalten:

- `version.json` → `version`
- `app.js` → `APP_VERSION`
- `service-worker.js` → `CACHE_NAME`

Beispiel für Version 4.0.1:

```text
version.json:       "version": "4.0.1"
app.js:             const APP_VERSION = "4.0.1";
service-worker.js:  const CACHE_NAME = "oq-python-academy-v4.0.1";
```

Die neue Version wird beim nächsten Online-Start erkannt. Der Lernstand bleibt in IndexedDB erhalten, weil Programmdateien und Fortschrittsdaten getrennt gespeichert werden.

## Typische spätere Änderungen

### Unterricht ändern

`data/curriculum.json` bearbeiten.

### Glossar ändern

`data/glossary.json` bearbeiten.

### Oberfläche oder Logik ändern

`index.html`, `styles.css` oder `app.js` bearbeiten.

### Neues Update veröffentlichen

1. Änderungen hochladen oder committen.
2. Versionsnummer in den drei oben genannten Dateien erhöhen.
3. Änderungen nach `main` pushen.
4. GitHub Pages veröffentlicht automatisch.

## Lokale Speicherung

Der Fortschritt wird automatisch in IndexedDB unter der GitHub-Pages-Adresse gespeichert. Er bleibt beim Schließen und Aktualisieren erhalten.

Er kann verloren gehen, wenn:

- die Websitedaten für `aleshon.github.io` gelöscht werden,
- ein anderer Browser oder ein anderes Browserprofil verwendet wird,
- im privaten Modus gelernt wird,
- das Gerät zurückgesetzt wird.

Für Gerätewechsel steht unter `Einstellungen` ein optionales JSON-Backup zur Verfügung.

## Datenschutz

Die Akademie besitzt keinen eigenen Server und übermittelt den Lernstand nicht an GitHub. Fortschritt, Notizen und Ergebnisse bleiben lokal im Browser. Das öffentliche Repository enthält nur Programm- und Unterrichtsdateien.

## Technischer Hinweis zur Codeausführung

Die Basisversion prüft Aufgaben anhand definierter Strukturtests und zeigt für einfache Zuweisungen, Rechnungen und `print()`-Anweisungen eine Ausgabevorschau. Sie führt noch keinen vollständigen Python-Interpreter im Browser aus. Eine spätere Pyodide-Erweiterung kann echte Python-Ausführung ergänzen.
