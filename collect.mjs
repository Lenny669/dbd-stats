// Reads Dead by Daylight stats from the Steam Web API, keeps the latest reading
// in site/data/snap.json and appends what changed since the previous reading
// to site/data/sessions.json.
//
// LOOP_MINUTES=0 (default): one reading.
// LOOP_MINUTES=N: read every POLL_SECONDS (default 60) for N minutes and commit
// + push each change straight away, so single matches and their end times are
// captured to the minute. Run by .github/workflows/collect.yml.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const KEY = process.env.STEAM_API_KEY;
const SID = process.env.STEAM_ID || '76561198370105822';
const LOOP_MIN = Number(process.env.LOOP_MINUTES || 0);
const POLL_MS = Number(process.env.POLL_SECONDS || 60) * 1000;
const COMMIT = process.env.COMMIT === '1';
const DIR = 'site/data';
const API = 'https://api.steampowered.com';

if (!KEY) {
  console.error('Missing STEAM_API_KEY secret. Add it under Settings > Secrets and variables > Actions.');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async path => {
  const r = await fetch(API + path, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${path.split('?')[0]} -> HTTP ${r.status}`);
  return r.json();
};
const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};
const sh = cmd => execSync(cmd, { stdio: 'pipe' }).toString().trim();

function commitAndPush(message) {
  if (!COMMIT) return;
  sh('git add site/data');
  try { sh('git diff --cached --quiet'); return; } catch { /* has changes */ }
  sh(`git commit -q -m "${message}"`);
  for (let i = 0; i < 3; i++) {
    try { sh('git pull -q --rebase origin main'); sh('git push -q origin HEAD:main'); return; } catch (e) {
      console.warn('push failed, retrying:', String(e.message).split('\n')[0]);
    }
  }
}

let lastPoll = null; // time of the previous successful reading in this run

async function readOnce() {
  const [st, og, ps] = await Promise.all([
    get(`/ISteamUserStats/GetUserStatsForGame/v2/?appid=381210&key=${KEY}&steamid=${SID}`),
    get(`/IPlayerService/GetOwnedGames/v1/?key=${KEY}&steamid=${SID}&appids_filter[0]=381210&include_played_free_games=1`),
    get(`/ISteamUser/GetPlayerSummaries/v2/?key=${KEY}&steamids=${SID}`)
  ]);
  if (!st.playerstats?.stats) throw new Error('Steam returned no stats. Is "Game details" set to Public in Steam privacy settings?');

  const s = {};
  for (const x of st.playerstats.stats) {
    if (/PerksCount|FinishWithPerks|FixSecondFloor|EscapeNoBlood_Map/.test(x.name)) continue;
    s[x.name.replace('DBD_', '')] = Math.round(x.value * 100) / 100;
  }
  const g = og.response?.games?.[0] ?? {};
  const p = ps.response?.players?.[0] ?? {};
  const now = new Date().toISOString();

  const prev = await readJson(`${DIR}/snap.json`, null);
  const sessions = await readJson(`${DIR}/sessions.json`, []);
  const ingame = p.gameid === '381210';
  // "on" = when the game was first seen running in this play session
  const on = ingame ? (prev?.ingame && prev?.on ? prev.on : now) : null;
  const snap = { t: now, pt: g.playtime_forever ?? 0, p2: g.playtime_2weeks ?? 0, name: p.personaname ?? '', ingame, on, s };

  let session = null;
  if (prev?.s) {
    const d = {};
    for (const k in s) {
      const v = Math.round((s[k] - (prev.s[k] ?? 0)) * 100) / 100;
      if (v > 0) d[k] = v;
    }
    const dpt = Math.max(0, snap.pt - (prev.pt ?? 0));
    // tp = previous poll, so the page knows how precisely the change was timed
    if (Object.keys(d).length) session = { t0: prev.t, t1: now, tp: lastPoll, pt: dpt, on: prev.on || on || null, d };
  }

  // Playtime alone ticking up is not a match: keep it in the snapshot only.
  const statusChanged = !prev || prev.ingame !== ingame || prev.name !== snap.name;
  lastPoll = now;
  if (!session && !statusChanged) return false;
  await mkdir(DIR, { recursive: true });
  if (session) {
    sessions.push(session);
    await writeFile(`${DIR}/sessions.json`, JSON.stringify(sessions) + '\n');
    console.log(now, session.d.BloodwebPoints ? 'match ended' : 'mid-match update', Object.keys(session.d).length, 'counters changed');
  } else {
    console.log(now, ingame ? 'game started' : 'game closed');
  }
  await writeFile(`${DIR}/snap.json`, JSON.stringify(snap) + '\n');
  commitAndPush(session ? `${session.d.BloodwebPoints ? 'Match ended' : 'Match update'} ${now.slice(0, 16)}Z` : `Status ${ingame ? 'in game' : 'offline'} ${now.slice(0, 16)}Z`);
  return true;
}

const end = Date.now() + LOOP_MIN * 60000;
let changed = false;
do {
  const started = Date.now();
  try { changed = (await readOnce()) || changed; } catch (e) { console.warn('reading failed:', e.message); }
  if (Date.now() + POLL_MS > end) break;
  await sleep(Math.max(1000, POLL_MS - (Date.now() - started)));
} while (true);
console.log(changed ? 'Saved new data.' : 'No change.');
