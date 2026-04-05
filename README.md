# MinPlan

Ett grid-baserat 3D-ritverktyg för att planera och visualisera husombyggnationer direkt i webbläsaren. Rita väggar, placera möbler och se resultatet i realtid i en 3D-vy.

## Funktioner

- **Rita väggar** — klicka för startpunkt, rör musen och klicka för slutpunkt. Väggar snäpper automatiskt till horisontellt eller vertikalt. Håll igång en polyline genom att fortsätta klicka, högerklicka eller dubbelklicka för att avsluta.
- **Radera** — hovra över en vägg eller möbel och klicka för att ta bort den.
- **Välj & flytta** — klicka på en möbel och dra den till ny position.
- **Möbler** — 13 typer att välja mellan: soffa, sängar, köksbänk, garderob, badrumsartiklar m.m.
- **Längdmåt** visas i realtid medan du ritar.
- **3D-vy** — synkroniseras automatiskt. Väggar extruderas till 2,6 m höjd, möbler visas i rätt proportioner.
- **Vylägen** — Split (2D + 3D sida vid sida), enbart 2D, eller enbart 3D.

## Navigation

| Åtgärd | Hur |
|---|---|
| Zooma i 2D | Scroll |
| Panorera i 2D | Alt + dra |
| Rotera i 3D | Vänsterklick + dra |
| Zooma i 3D | Scroll |
| Panorera i 3D | Högerklick + dra |
| Avbryt väggritning | Högerklick eller dubbelklick |

## Kom igång

Du behöver [Node.js](https://nodejs.org) installerat (kommer med `npm`).

```bash
# Klona repot
git clone https://github.com/Krusing/minplan.git
cd minplan

# Starta appen
npm start
```

Öppna sedan webbläsaren på adressen som visas i terminalen, oftast `http://localhost:3000`.

> **Vad händer under huven?** `npm start` kör `npx serve .` vilket startar en lokal webbserver i mappen. Det behövs för att webbläsaren ska tillåta ES-moduler (som Three.js) att laddas korrekt. Du kan inte bara dubbelklicka på `index.html`.

## Teknik

- Vanilla JavaScript med ES-moduler
- [Three.js](https://threejs.org) för 3D-rendering
- HTML Canvas API för 2D-ritverktyget
- Ingen byggsteg eller kompilering — det som finns i repot körs direkt
