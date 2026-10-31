// „Kurvenjäger unterstützen“: zahl, was du willst. Nichts wird freigeschaltet.
// - Store-Versionen (Google Play, App Store): nur Trinkgeld per In-App-Kauf (cordova-plugin-purchase),
//   keine externen Spenden-Links – das verlangen die Regeln beider Stores.
// - Web und F-Droid: Links zu Liberapay, GitHub Sponsors und Überweisung.
// Monatsziel, Kosten und Links stehen in spendenziel.json auf dem Datenspeicher und lassen sich
// ohne App-Update ändern (Vorlage: docs/spendenziel.beispiel.json).
import { Capacitor } from '@capacitor/core';
import { CONFIG } from './config.js';
import { fetchData } from './data.js';
import { cacheGet, cacheSet } from './store.js';
import { log } from './telemetry.js';
import pkg from '../package.json';

const $ = id => document.getElementById(id);
export const TIPS = ['trinkgeld_2', 'trinkgeld_5', 'trinkgeld_10', 'trinkgeld_25']; // Produkt-IDs in Play Console / App Store Connect
// Monatliches Unterstützer-Abo, nur Google Play: Apple verlangt bei Abos einen fortlaufenden Gegenwert
export const MONTHLY = 'unterstuetzer_monatlich';
const android = () => Capacitor.getPlatform() === 'android';
const HINT = 'kj.supportHint';
const REPO = 'https://github.com/SchulzOli/Kurvenjagd';
const eur = v => `${Math.round(v).toLocaleString('de-DE')} €`;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export const channel = () => CONFIG.channel || (Capacitor.isNativePlatform() ? 'store' : 'web');

// Monatsziel laden (online), sonst letzte bekannte Fassung
async function loadGoal() {
  try {
    const { json } = await fetchData('spendenziel.json');
    await cacheSet('support-goal', json).catch(() => {});
    return json;
  } catch { return cacheGet('support-goal').catch(() => null); }
}

export function initSupport({ flash }) {
  const ch = channel();
  let goal = null, iap = null; // iap: { store, products } sobald der Store bereit ist

  // ---------- In-App-Kauf (nur Store-Versionen) ----------

  function initStore() {
    const P = globalThis.CdvPurchase;
    if (!P || iap) return;
    const { store, ProductType, Platform } = P;
    const platform = Capacitor.getPlatform() === 'ios' ? Platform.APPLE_APPSTORE : Platform.GOOGLE_PLAY;
    store.register(TIPS.map(id => ({ id, type: ProductType.CONSUMABLE, platform })));
    if (android()) store.register([{ id: MONTHLY, type: ProductType.PAID_SUBSCRIPTION, platform }]);
    store.when()
      .productUpdated(() => render())
      // Trinkgeld schaltet nichts frei: keine Belegprüfung nötig, Kauf sofort abschließen
      .approved(tx => tx.finish())
      .finished(tx => {
        log('unterstützen', `Trinkgeld ${tx.products?.map(p => p.id).join(', ')}`);
        try { localStorage.setItem(HINT, 'done'); } catch { /* egal */ }
        flash('Danke für deine Unterstützung! ♥');
        render();
      });
    store.error(err => log('unterstützen', `Store: ${err.message}`));
    iap = { store };
    store.initialize([platform]).catch(err => log('unterstützen', `Store nicht bereit: ${err.message}`))
      .finally(() => { iap.ready = true; render(); });
    setTimeout(() => { iap.ready = true; render(); }, 8000); // Store antwortet nicht (z. B. App nicht aus dem Store)
  }

  async function tip(id) {
    const product = iap?.store.get(id);
    const err = await product?.getOffer()?.order();
    if (err && err.code !== globalThis.CdvPurchase.ErrorCode.PAYMENT_CANCELLED) flash(`Das hat nicht geklappt: ${err.message}`);
  }

  // ---------- Anzeige ----------

  function goalHtml() {
    if (!goal) return '<p class="dlgnote">Kurvenjäger ist kostenlos, ohne Werbung und ohne Tracking. Wer mag, gibt einen frei gewählten Betrag für die laufenden Kosten.</p>';
    const pct = Math.min(100, Math.round((goal.eingegangen || 0) / (goal.ziel || 1) * 100));
    const monat = goal.monat ? new Date(`${goal.monat}-01`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : '';
    return `<p class="dlgnote">Kurvenjäger ist kostenlos, ohne Werbung und ohne Tracking. Spenden decken nur die laufenden Kosten – nichts wird freigeschaltet.</p>
      <div class="goal"><div class="gh"><b>${eur(goal.eingegangen || 0)} von ${eur(goal.ziel)}</b><span>${esc(monat)}</span></div>
        <div class="prog"><span style="width:${pct}%"></span></div></div>
      ${goal.kosten?.length ? `<ul class="costs">${goal.kosten.map(([label, v]) => `<li><span>${esc(label)}</span><span>${eur(v)}</span></li>`).join('')}</ul>` : ''}`;
  }

  function waysHtml() {
    if (ch === 'store') {
      const products = TIPS.map(id => iap?.store.get(id)).filter(p => p?.canPurchase);
      const monthly = android() ? iap?.store.get(MONTHLY) : null, subscribed = !!monthly && iap.store.owned(MONTHLY);
      const sub = !monthly ? '' : subscribed
        ? `<h3>Monatlich</h3><p class="dlgnote">Du unterstützt Kurvenjäger monatlich – danke! ♥</p><button data-manage>Abo in Google Play verwalten</button>`
        : monthly.canPurchase ? `<h3>Monatlich unterstützen</h3><button class="big primary" data-tip="${MONTHLY}">${esc(monthly.pricing?.price || '')} im Monat</button>
          <p class="dlgnote">Jederzeit in Google Play kündbar. Schaltet nichts frei.</p>` : '';
      if (!products.length && !sub) return `<p class="dlgnote">${globalThis.CdvPurchase && !iap?.ready ? 'Trinkgeld wird geladen …' : 'Trinkgeld ist gerade nicht verfügbar (der Store antwortet nicht oder die App stammt nicht aus dem Store). Danke, dass du es versuchst!'}</p>`;
      return (products.length ? `<h3>Einmalig Trinkgeld geben</h3><div class="tips">${products.map(p => `<button class="big" data-tip="${esc(p.id)}">${esc(p.pricing?.price || p.title)}</button>`).join('')}</div>
        <p class="dlgnote">Bezahlt wird über dein ${android() ? 'Google' : 'Apple'}-Konto. Einmalig, kein Abo.</p>` : '') + sub;
    }
    const l = goal?.links || {};
    const rows = [
      l.liberapay && `<a class="way" href="${esc(l.liberapay)}" target="_blank" rel="noopener"><b>Liberapay</b><span>Betrag frei wählbar, einmalig oder regelmäßig</span></a>`,
      l.github && `<a class="way" href="${esc(l.github)}" target="_blank" rel="noopener"><b>GitHub Sponsors</b><span>einmalig oder monatlich</span></a>`,
      l.iban && `<div class="way"><b>Überweisung / Dauerauftrag</b><span>${esc(l.inhaber || '')}<br><span class="mono">${esc(l.iban)}</span><br>Verwendungszweck: Kurvenjäger</span></div>`,
    ].filter(Boolean);
    return rows.length ? `<h3>So kannst du unterstützen</h3>${rows.join('')}` : '<p class="dlgnote">Spendenwege werden gerade eingerichtet.</p>';
  }

  // Feedback als GitHub-Issue, mit App-Version und Plattform schon ausgefüllt (keine weiteren Daten)
  function feedbackHtml() {
    const body = `

---
App-Version ${pkg.version} · ${Capacitor.getPlatform()} · ${ch}`;
    const url = (kind, title) => `${REPO}/issues/new?labels=${kind}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    return `<h3>Feedback</h3>
      <p class="dlgnote">Fehler gefunden oder eine Idee? Schreib es öffentlich ins Projekt auf GitHub (kostenloses Konto nötig).</p>
      <a class="way" href="${url('bug', 'Fehler: ')}" target="_blank" rel="noopener"><b>Fehler melden</b><span>Was ist passiert, was hast du erwartet?</span></a>
      <a class="way" href="${url('enhancement', 'Idee: ')}" target="_blank" rel="noopener"><b>Idee vorschlagen</b><span>Was würde dir unterwegs helfen?</span></a>
      <a class="way" href="${REPO}/issues" target="_blank" rel="noopener"><b>Alle Rückmeldungen ansehen</b><span>github.com/SchulzOli/Kurvenjagd</span></a>`;
  }

  function render() {
    if ($('support').hidden) return;
    $('supportBody').innerHTML = goalHtml() + waysHtml() + feedbackHtml();
  }

  async function open() {
    try { localStorage.setItem(HINT, 'done'); } catch { /* egal */ }
    $('library').hidden = true;
    $('support').hidden = false;
    render();
    if (ch === 'store') initStore();
    goal = await loadGoal();
    render();
  }

  $('supportClose').addEventListener('click', () => { $('support').hidden = true; });
  $('supportBody').addEventListener('click', ev => {
    const b = ev.target.closest('[data-tip]');
    if (b) tip(b.dataset.tip);
    if (ev.target.closest('[data-manage]')) iap?.store.manageSubscriptions();
  });
  document.querySelectorAll('[data-support]').forEach(b => b.addEventListener('click', open));

  return {
    open,
    // Einmaliger, wegklickbarer Hinweis nach der fünften Fahrt – danach nie wieder
    maybeHint(rides) {
      let state = null;
      try { state = localStorage.getItem(HINT); } catch { return; }
      if (state || rides < 5) return;
      try { localStorage.setItem(HINT, 'shown'); } catch { /* egal */ }
      flash('Gefällt dir Kurvenjäger? Unter „Unterstützen“ kannst du freiwillig etwas beitragen.');
    },
  };
}
