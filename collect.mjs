// Reads Dead by Daylight stats from the Steam Web API, stores the latest reading
// in site/data/snap.json and appends what changed since the previous reading
// to site/data/sessions.json. Run by .github/workflows/collect.yml.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const KEY = process.env.STEAM_API_KEY;
const SID = process.env.STEAM_ID || '76561198370105822';
const DIR = 'site/data';
const API = 'https://api.steampowered.com';

if (!KEY) {
  console.error('Missing STEAM_API_KEY secret. Add it under Settings > Secrets and variables > Actions.');
  process.exit(1);
}

const get = async path => {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path.split('?')[0]} -> HTTP ${r.status}`);
  return r.json();
};
const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};

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
const snap = {
  t: new Date().toISOString(),
  pt: g.playtime_forever ?? 0,
  p2: g.playtime_2weeks ?? 0,
  name: p.personaname ?? '',
  ingame: p.gameid === '381210',
  s
};

await mkdir(DIR, { recursive: true });
const prev = await readJson(`${DIR}/snap.json`, null);
const sessions = await readJson(`${DIR}/sessions.json`, []);

let session = null;
if (prev?.s) {
  const d = {};
  for (const k in s) {
    const v = Math.round((s[k] - (prev.s[k] ?? 0)) * 100) / 100;
    if (v > 0) d[k] = v;
  }
  const dpt = Math.max(0, snap.pt - (prev.pt ?? 0));
  if (Object.keys(d).length || dpt > 0) session = { t0: prev.t, t1: snap.t, pt: dpt, d };
}

const statusChanged = !prev || prev.ingame !== snap.ingame || prev.name !== snap.name;
if (!session && !statusChanged) {
  console.log('No change since', prev?.t);
  process.exit(0);
}
if (session) {
  sessions.push(session);
  await writeFile(`${DIR}/sessions.json`, JSON.stringify(sessions) + '\n');
  console.log('New window:', JSON.stringify(session));
}
await writeFile(`${DIR}/snap.json`, JSON.stringify(snap) + '\n');
console.log('Saved reading at', snap.t);
