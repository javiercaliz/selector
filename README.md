# Selector · ¿Quién presenta la weekly?

Minijuegos para elegir al azar quién presenta. Es un sitio estático (HTML/CSS/JS, sin build).

## Usarlo

- **Local:** `python -m http.server 8137` dentro de esta carpeta y abrir http://localhost:8137
- **Online:** subir la carpeta tal cual a GitHub Pages, Netlify, Vercel, etc.

La lista de participantes se guarda en el navegador. Para pasársela al equipo: **🔗 Copiar link con la lista**.

## Estructura

```
index.html
css/styles.css        layout, panel de participantes
css/game-shared.css   botón principal y pantalla del ganador (compartidos)
css/gachapon.css      la máquina
css/plinko.css        el tablero
js/core.js            Store (estado), Sound, Confetti, registro de juegos
js/app.js             navegación y panel
js/games/gachapon.js  minijuego Gachapón
js/games/plinko.js    minijuego Plinko
```

**Justicia:** en todos los juegos el ganador se sortea primero con `crypto.getRandomValues`
(uniforme). La animación solo pone el suspenso. En Plinko se buscan, con la misma física, las
condiciones iniciales que llevan la bola a ese casillero y se reproduce esa caída exacta.

## Agregar un minijuego

1. Crear `js/games/mijuego.js` y registrarlo:

```js
Selector.Games.register({
  id: 'carrera', title: 'Carrera', icon: '🏇',
  mount(el) { /* dibujar dentro de el */ },
  unmount() { /* limpiar timers, listeners */ },
});
```

2. Sortear con `Selector.Store.pool()` + `Selector.util.rand(n)` y guardar el resultado con
   `Selector.Store.recordWin(id, 'Carrera')`.
3. Agregar el `<script>` en `index.html` (antes de `app.js`) y quitarlo de la lista `SOON` en `app.js`.
