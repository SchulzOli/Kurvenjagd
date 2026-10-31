// Oberfläche des Fahrprofils: Bewertung nach der Fahrt, Reiter „Fahrten“ in der Bibliothek,
// Anwenden des gelernten Profils auf den Rechenkern. Die Lernlogik selbst steckt in profile.js.
import * as R from './router.js';
import { TAGS, learn, applyProfile } from './profile.js';
import { listRides, saveRide, updateRide, deleteRide, loadRideTrace } from './store.js';
import { log } from './telemetry.js';

const $ = id => document.getElementById(id);
const PREF = 'kj.profile';
const STAR_TEXT = ['', 'Langweilig', 'Geht so', 'Ganz okay', 'Richtig gut', 'Traumtour'];
const km = m => `${(m / 1000).toFixed(0)} km`;
const pct = x => `${Math.round(x * 100)} %`;
const hm = s => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)}:${String(Math.round(s / 60) % 60).padStart(2, '0')} h`);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmtDate = t => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' });
const stars = n => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

export const profileEnabled = () => { try { return localStorage.getItem(PREF) !== '0'; } catch { return true; } };

// Kurzbeschreibung einer Fahrt (Dialog und Liste)
export function rideMeta(r) {
  const f = r.features, parts = [km(r.km), hm((r.end - r.at) / 1000)];
  if (f) parts.push(`${pct(1 - (f.bands.straight || 0))} in Kurven`);
  if (r.speed?.curvy) parts.push(`Ø ${Math.round(r.speed.curvy)} km/h in Kurven`);
  return parts.join(' · ');
}

// app: { engine, onChange(rebuild), showTrace(coords, name), shareGpx(coords, name), flash }
export function initProfile(app) {
  let rides = [], profile = null, enabled = profileEnabled(), dlg = null;

  // ---------- Lernen und anwenden ----------

  async function refresh() {
    rides = await listRides();
    profile = learn(rides.filter(r => !r.ignored));
    const before = JSON.stringify(R.P.bands);
    applyProfile(R.P, R.DEFAULTS, enabled ? profile : null);
    const rebuild = JSON.stringify(R.P.bands) !== before; // Kurven-Gewichte geändert: Netz neu vermessen
    await app.engine.setParams(rebuild);
    app.onChange(rebuild);
    log('profil', `${enabled ? 'aktiv' : 'aus'} · ${rides.length} Fahrten, ${profile.rated} bewertet · ${profile.reasons.length} Anpassungen`);
    if (!$('ridePane').hidden) renderPane();
  }

  // ---------- Bewertungsdialog ----------

  function openRating(ride, isNew) {
    dlg = { ride, isNew, rating: ride.rating || 0, tags: new Set(ride.tags || []) };
    $('rateMeta').textContent = `${ride.name}${ride.sim ? ' (Simulation)' : ''} · ${rideMeta(ride)}`;
    $('rateSkip').textContent = isNew ? 'Überspringen' : 'Abbrechen';
    $('rateTags').innerHTML = TAGS.map(t => `<button data-tag="${t.key}">${t.label}</button>`).join('');
    renderRating();
    $('library').hidden = true;
    $('rateDlg').hidden = false;
  }
  function renderRating() {
    $('stars').innerHTML = [1, 2, 3, 4, 5].map(n => `<button data-star="${n}" class="${n <= dlg.rating ? 'on' : ''}" aria-label="${n} Sterne">★</button>`).join('');
    $('starText').textContent = STAR_TEXT[dlg.rating] || 'Tippe auf die Sterne';
    document.querySelectorAll('#rateTags [data-tag]').forEach(b => b.classList.toggle('on', dlg.tags.has(b.dataset.tag)));
  }
  async function closeRating(save) {
    const { ride, isNew, rating, tags } = dlg;
    dlg = null;
    $('rateDlg').hidden = true;
    const patch = save ? { rating: rating || null, tags: [...tags], ignored: false } : {}; // neu bewerten hebt „zurückgesetzt“ auf
    if (isNew) await saveRide({ ...ride, rating: null, tags: [], ...patch }); // auch unbewertet in der Chronik
    else if (save) await updateRide(ride.id, patch);
    if (save && (rating || tags.size)) log('profil', `Bewertung: ${rating || '–'} Sterne${tags.size ? `, ${[...tags].join(', ')}` : ''}`);
    await refresh();
    if (isNew) app.afterRideSaved?.(rides.length);
    if (save && (rating || tags.size)) app.flash(profile.reasons.length ? 'Danke! Dein Fahrprofil wurde angepasst.' : 'Danke! Ab ein paar bewerteten Touren lernt die App deinen Stil.');
  }
  $('stars').addEventListener('click', ev => { const b = ev.target.closest('[data-star]'); if (b) { dlg.rating = +b.dataset.star === dlg.rating ? 0 : +b.dataset.star; renderRating(); } });
  $('rateTags').addEventListener('click', ev => {
    const b = ev.target.closest('[data-tag]');
    if (!b) return;
    const k = b.dataset.tag, opposite = { moreCurves: 'lessCurves', lessCurves: 'moreCurves' }[k];
    if (dlg.tags.has(k)) dlg.tags.delete(k); else { dlg.tags.add(k); if (opposite) dlg.tags.delete(opposite); }
    renderRating();
  });
  $('rateSave').addEventListener('click', () => closeRating(true));
  $('rateSkip').addEventListener('click', () => closeRating(false));

  // ---------- Reiter „Fahrten“ ----------

  function renderPane() {
    $('profOn').checked = enabled;
    const rated = rides.filter(r => !r.ignored && (r.rating || r.tags?.length)).length;
    $('profCard').innerHTML = !enabled
      ? '<h3>Fahrprofil ausgeschaltet</h3><p class="dlgnote">Routen werden mit den Standardwerten berechnet. Deine Fahrten bleiben gespeichert.</p>'
      : profile?.reasons.length
        ? `<h3>Das habe ich über deinen Stil gelernt</h3><ul>${profile.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
           <p class="dlgnote">Aus ${profile.n === 1 ? 'einer Fahrt' : `${profile.n} Fahrten`}, ${profile.rated} mit Sternen. Gilt ab der nächsten Berechnung.</p>
           <div class="b"><button id="profReset">Gelerntes zurücksetzen</button></div>`
        : `<h3>Noch nichts gelernt</h3><p class="dlgnote">Fahre Touren und bewerte sie danach. Schnell-Tags wie „Mehr Kurven“ wirken sofort,
           aus Sternen lernt die App ab 3 bewerteten Fahrten (bisher ${rated}). Alles bleibt auf diesem Gerät.</p>`;
    $('rideList').innerHTML = rides.length ? rides.map(r => `<li>
        <div class="t">${esc(r.name)}${r.sim ? ' <small class="dlgnote">(Simulation)</small>' : ''}</div>
        <div class="m">${fmtDate(r.at)} · ${rideMeta(r)}<br>${r.ignored ? 'zurückgesetzt – zählt nicht mehr' : r.rating ? `<span class="s">${stars(r.rating)}</span>` : 'nicht bewertet'}${r.tags?.length ? ` · ${r.tags.map(t => TAGS.find(x => x.key === t)?.label || t).join(', ')}` : ''}</div>
        <div class="b"><button data-rate="${r.id}">Bewerten</button><button data-show="${r.id}">Zeigen</button><button data-gpx="${r.id}">GPX</button><button class="danger" data-del="${r.id}" aria-label="Löschen">✕</button></div>
      </li>`).join('') : '<li class="dlgnote">Noch keine Fahrten aufgezeichnet. Starte eine Fahrt – ab 1 km auf der Route wird sie hier gespeichert.</li>';
  }

  $('profOn').addEventListener('change', async () => {
    enabled = $('profOn').checked;
    try { localStorage.setItem(PREF, enabled ? '1' : '0'); } catch { /* egal */ }
    await refresh();
    app.flash(enabled ? 'Fahrprofil an – gilt ab der nächsten Berechnung' : 'Fahrprofil aus – Standardwerte');
  });
  $('ridePane').addEventListener('click', async ev => {
    const t = ev.target.closest('button');
    if (!t) return;
    const ride = rides.find(r => r.id === (t.dataset.rate || t.dataset.show || t.dataset.gpx || t.dataset.del));
    if (t.id === 'profReset') {
      if (!t.classList.contains('confirm')) { t.classList.add('confirm'); t.textContent = 'Wirklich zurücksetzen?'; return; }
      for (const r of rides) if (!r.ignored) await updateRide(r.id, { ignored: true });
      log('profil', 'Gelerntes zurückgesetzt');
      return refresh();
    }
    if (t.dataset.rate) return openRating(ride, false);
    if (t.dataset.show || t.dataset.gpx) {
      const coords = (await loadRideTrace(ride.id)).map(([lat, lon]) => [lat, lon]);
      if (coords.length < 2) return app.flash('Für diese Fahrt gibt es keine Spur');
      if (t.dataset.show) { $('library').hidden = true; return app.showTrace(coords, ride.name); }
      return app.shareGpx(coords, ride.name);
    }
    if (t.dataset.del) {
      if (!t.classList.contains('confirm')) { t.classList.add('confirm'); t.textContent = 'Löschen?'; return; }
      await deleteRide(ride.id);
      return refresh();
    }
  });

  return {
    ready: refresh(),
    refresh,
    renderPane,
    // Nach der Fahrt: Aufzeichnung (oder null bei zu kurzer Fahrt) bewerten lassen
    afterRide(rec) { if (rec) openRating(rec, true); },
    state: () => ({ rides, profile, enabled }),
  };
}
