// Level dressing: turns a level's "props" list into placed props, and adds
// the roadside furniture every level gets (bend chevrons and warning signs).
//
// "props" entries, all placed by distance from the start line (at, from, to)
// and offset across the road (d, + right):
//   { "type": "chalet", "at": 120, "d": 18, "yaw": 10, "scale": 1 }
//       One prop. It faces the road unless yaw is "along" or "across"; a
//       number turns it that many degrees from facing the road. "side":
//       "valley" or "mountain" puts it on that side whatever the sign of d.
//   { "row": "fence", "from": 100, "to": 400, "d": -8, "every": 3 }
//       Props along the road, turned to run with it ("both": true mirrors it;
//       "face": "road" turns each to face the road instead, as houses do).
//   { "scatter": ["cow", "cow_pied"], "from": 100, "to": 500, "side": "left",
//     "near": 12, "far": 60, "count": 12 }
//       Props dotted about a stretch beside the road, facing any way
//       ("face": "road" to face the road), never on steep ground. "side" may
//       also be "valley" or "mountain".
//   { "bends": ["chalet", "chalet_small"], "maxRadius": 40, "d": 22,
//     "from": 0, "to": 2000, "with": ["woodpile"] }
//       A prop on the inside of every bend tighter than maxRadius (or on its
//       valley side with "side": "valley"), facing the apex, with any "with"
//       props dotted round it.
import { mulberry32 } from './noise.js';
import { Props } from './props.js';

export function dressLevel(level, road, props, terrain = props.terrain) {
  const rand = mulberry32((level?.seed ?? 7) + 777);
  if (!level) return;
  dressEntries(level.props || [], road, props, rand, terrain);
  if (level.chevrons !== false) bendSigns(road, props);
}

// Endless: dresses one stretch of road, s0..s1, as it is generated. `entries`
// are "props" entries as above (distances from the start line); the bend
// signs go on every bend whose apex is in the stretch.
export function dressRange(road, props, s0, s1, entries, rand, terrain = props.terrain) {
  dressEntries(entries, road, props, rand, terrain);
  bendSigns(road, props, s0, s1);
}

function dressEntries(entries, road, props, rand, terrain) {
  const S = road.start;
  for (const e of entries) {
    if (e.type) {
      const p = Props.at(road, S + e.at, onSide(road, S + e.at, e.d ?? 0, e.side), e.yaw);
      props.add(e.type, p.x, p.z, p.yaw, e.scale ?? 1);
    } else if (e.row) {
      const every = e.every ?? 3;
      const types = [].concat(e.row);
      // A "side" is judged once, at the middle of the row.
      const d0 = onSide(road, S + (e.from + e.to) / 2, e.d, e.side);
      for (const d of e.both ? [d0, -d0] : [d0]) {
        let k = 0;
        for (let s = e.from; s <= e.to; s += every) {
          const p = Props.at(road, S + s, d, e.across ? 'across' : e.face === 'road' ? undefined : 'along');
          props.add(types[k++ % types.length], p.x, p.z, p.yaw, e.scale ?? 1);
        }
      }
    } else if (e.scatter) {
      const types = [].concat(e.scatter);
      const sides = e.side === 'left' ? [-1] : e.side === 'right' ? [1] : [-1, 1];
      for (let i = 0, tries = 0; i < (e.count ?? 8) && tries < (e.count ?? 8) * 6; tries++) {
        const s = e.from + rand() * (e.to - e.from);
        const side = e.side === 'valley' || e.side === 'mountain' ? onSide(road, S + s, 1, e.side) : sides[Math.floor(rand() * sides.length)];
        const d = side * ((e.near ?? 12) + rand() * ((e.far ?? 50) - (e.near ?? 12)));
        const p = Props.at(road, S + s, d, 0);
        // Not on a cliff: animals and haybales want gentle ground.
        if (terrain && Math.abs(terrain.heightAt(p.x, p.z) - p.f.y) > Math.abs(d) * 0.45 + 1) continue;
        i++;
        const yaw = e.face === 'road' ? p.yaw + (rand() - 0.5) * 0.6 : rand() * Math.PI * 2;
        props.add(types[Math.floor(rand() * types.length)], p.x, p.z, yaw, (e.scale ?? 1) * (0.9 + rand() * 0.2));
      }
    } else if (e.bends) {
      const types = [].concat(e.bends);
      let k = 0;
      for (const b of findBends(road, 1 / (e.maxRadius ?? 40))) {
        const at = b.peak - S;
        if (at < (e.from ?? -Infinity) || at > (e.to ?? Infinity)) continue;
        // On the inside of the bend, or on its valley side with "side": "valley".
        const d = e.side === 'valley' ? onSide(road, b.peak, e.d ?? 20, 'valley') : b.dir * (e.d ?? 20);
        const p = Props.at(road, b.peak, d, e.yaw ?? 0);
        props.add(types[k++ % types.length], p.x, p.z, p.yaw, e.scale ?? 1);
        for (const w of [].concat(e.with || [])) {
          const q = Props.at(road, b.peak + (rand() - 0.5) * 16, d * (0.55 + rand() * 0.1), 0);
          props.add(w, q.x, q.z, q.yaw + (rand() - 0.5) * 0.5);
        }
      }
    }
  }
}

// d moved to the valley (downhill) or mountain side of the road at s, for
// "side": "valley" or "mountain"; otherwise d as given.
function onSide(road, s, d, side) {
  if (side !== 'valley' && side !== 'mountain') return d;
  const c = road.c[Math.round(s)] || 0;
  const valley = c > 0 ? -1 : 1; // + cliff: mountain on the right
  return Math.abs(d) * (side === 'valley' ? valley : -valley);
}

// The bends tighter than curvature K between from and to (the level by
// default): { start, end, peak, dir } in road distance, dir +1 turning right.
export function findBends(road, K, from = road.start, to = road.finish) {
  const out = [];
  const i0 = Math.max(0, Math.round(from)), i1 = Math.min(road.count - 1, Math.round(to));
  let i = i0;
  while (i < i1) {
    if (Math.abs(road.k[i]) < K) {
      i++;
      continue;
    }
    let j = i, peak = i;
    while (j < i1 && Math.abs(road.k[j]) >= K * 0.8 && Math.sign(road.k[j]) === Math.sign(road.k[i])) {
      if (Math.abs(road.k[j]) > Math.abs(road.k[peak])) peak = j;
      j++;
    }
    out.push({ start: i, end: j, peak, dir: Math.sign(road.k[peak]) });
    i = j + 1;
  }
  return out;
}

// Chevrons on the outside of every tight bend (radius under 45 m), and a
// warning sign on the approach. With from/to, only bends whose apex is in
// that stretch (it looks a little either side to find them whole).
function bendSigns(road, props, from, to) {
  const bends = from === undefined ? findBends(road, 1 / 45) : findBends(road, 1 / 45, from - 200, to + 200).filter((b) => b.peak >= from && b.peak < to);
  for (const { start, end, peak, dir } of bends) {
    const outside = -dir;
    const rail = road.barrierAt(peak, outside) === 'guardrail';
    const d = outside * (rail ? 5.5 : 6.3);
    const span = Math.max(12, (end - start) * 0.8);
    for (let k = -1; k <= 1; k++) {
      const s = peak + (k * span) / 2.5;
      if (road.spanAt(s)) continue;
      const p = Props.at(road, s, d, 0);
      // Face oncoming riders: the board's front looks back up the road.
      const yaw = Math.atan2(-p.f.dirX, -p.f.dirZ);
      props.add(dir > 0 ? 'chevron_r' : 'chevron_l', p.x, p.z, yaw);
    }
    const ws = start - 70;
    if (ws > road.start + 30 && !road.spanAt(ws)) {
      const p = Props.at(road, ws, 6.2, 0);
      props.add(dir > 0 ? 'warnsign_r' : 'warnsign_l', p.x, p.z, Math.atan2(-p.f.dirX, -p.f.dirZ));
    }
  }
}
