// Audit port, batch 3 (content items). Run with: node --test
// Sources: AC 91-74B (10/8/15), FAA-H-8083-28, NASA A Pilot's Guide to Inflight Icing, AIM 7-1-5, NWSI 10-813.
// AC 91-51A is cancelled by AC 91-74B (para 1-2), so it must not be cited.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readRepoFile } = require('./load-site');

const text = (name) => readRepoFile(name).replace(/\r\n/g, '\n');

test('icing: the recovery list is in the approved order', () => {
  const i = text('pages/learn/icing.html');
  const order = [
    'Follow the AFM or POH procedure for your airplane.',
    'Do not treat flap retraction as a universal first step.',
    'If you have not just deployed full flaps, suspect a wing stall first.',
    'If you have just extended full flaps and notice lightening of the controls, difficulty trimming, or buffet in the control column',
    'If the AFM or POH gives no procedure for your piston airplane, use the AC\'s icing checklist.',
    'Roll upset guidance, not tail stall recovery (AC 91-74B ¶5-13a):',
  ].map((s) => i.indexOf(s));
  assert.ok(order.every((n) => n > 0), 'every step present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'in order');
});

test('icing: NASA is quoted for each tail stall step', () => {
  const i = text('pages/learn/icing.html');
  for (const q of [
    'usually occur during an approach when flaps are at full extension and/or the aircraft is being flown near the upper speed limit for flap extension',
    'If flaps are extended and you experience lightening of the controls, difficulty trimming, or buffet in the control column, immediately retract the flaps and maintain or reduce thrust.',
    'Immediately retract flaps to the previous setting.',
    'If you experience a tail stall, immediately pull back on the yoke. This is opposite to the action that you have been taught and have practiced for recovering from a wing stall.',
    'Power additions usually increase airspeed and bring the tailplane closer to the stall.',
    'As the flaps retract, you may need to reduce the back pressure on the yoke to avoid a subsequent wing stall.',
  ]) assert.ok(i.includes(q), q);
  // line 500 carries the pull-back quote too
  assert.equal(i.split('immediately pull back on the yoke. This is opposite').length - 1, 2);
});

test('icing: AC quotes for the discriminator, Appendix 2, and roll upset are exact', () => {
  const i = text('pages/learn/icing.html');
  assert.ok(i.includes('you should always suspect a wing stall with any vibration or buffet if you have not just deployed full flaps.'));
  assert.ok(i.includes('Be prepared for unexpected attitude changes when changing the airplane\'s configuration. If the aircraft begins to roll or pitch unexpectedly, return to the previous configuration.'));
  assert.ok(i.includes('should not replace or supersede Airplane Flight Manual (AFM) or pilot\'s operating handbook (POH).'));
  assert.ok(i.includes('If the flaps are extended, do not retract them unless it can be determined that the upper surface of the airfoil is clear of ice. Retracting the flaps will increase the AOA at a given airspeed.'));
  assert.match(i, /This applies to a roll upset caused by ice forward of the ailerons\. It is a different event from a tail stall\./);
});

test('icing: no cancelled AC 91-51A cite anywhere on the page', () => {
  assert.doesNotMatch(text('pages/learn/icing.html'), /91-51/);
});

test('icing: flap rule matches AC 91-74B 5-10e, the exit advice has a real paragraph, and the symptom list is sourced', () => {
  const i = text('pages/learn/icing.html');
  assert.doesNotMatch(i, /do not extend flaps if you suspect ice contamination on the tailplane/);
  assert.match(i, /"rarely occurs until flaps are fully extended on susceptible airplanes" \(¶5-10e\)/);
  assert.match(i, /"as expeditiously as possible" \(¶3-13c\(1\)\)/);
  assert.doesNotMatch(i, /AC 91-74B §5\.2/);
  assert.match(i, /coordinating with ATC and declaring an emergency if needed \(AC 91-74B ¶1-4b\)/);
  assert.match(i, /climbing or descending may exit it \(¶4-1h\)/);
  assert.doesNotMatch(i, /easily confused with wing buffet/);
  assert.match(i, /Lightening of the controls, difficulty trimming, or buffet in the control column, usually after flap extension \(NASA/);
});

test('icing: chord, boundary layer, and 2:1 claims are gone and the sourced sentences are there', () => {
  const i = text('pages/learn/icing.html');
  assert.doesNotMatch(i, /one-quarter to one-third|2:1 ratio|thinner boundary layer|smaller chord/);
  assert.equal((i.match(/Since the tailplane is ordinarily thinner than the wing, it is a more efficient collector of ice/g) || []).length, 2);
  assert.match(i, /because it is ordinarily thinner and a more efficient collector of ice \(AC 91-74B ¶3-7b\)/);
});

test('icing: ice type temperature guidance follows Handbook 20.3.4 (rime colder than -15 C, no -20 C floor)', () => {
  const i = text('pages/learn/icing.html');
  assert.doesNotMatch(i, /−15°C to −20°C/);
  assert.match(i, /Rime colder than −15°C\. The Handbook calls this "only general guidance\."/);
  assert.match(i, /Clear ice warmer than −10°C \(down to 0°C\)\. Mixed −10°C to −15°C\./);
  // the Handbook sentence these numbers come from
  const hb = 'In general, rime ice tends to occur at temperatures colder than -15°C, clear ice when the temperature is warmer than -10°C, and mixed ice at temperatures in between.';
  assert.ok(hb.includes('colder than -15') && hb.includes('warmer than -10'));
});

test('stability page: Handbook cites, and the lapse rates are about 10 and about 6 C/km', () => {
  const s = text('pages/learn/stability-lapse-rates.html');
  assert.match(s, /\(FAA-H-8083-28 §13\.3\)/);
  assert.match(s, /FAA-H-8083-28 §13\.3\.4 defines it as a lapse rate "less than the dry adiabatic lapse rate but greater than the moist adiabatic lapse rate\."/);
  assert.match(s, /FAA-H-8083-28 §13\.5\.2: "CAPE is the maximum amount of energy available to an ascending air parcel for convection\."/);
  assert.match(s, /DALR \(about 10°C\/km\) and MALR \(about 6°C\/km\)\. The moist rate varies with temperature/);
  assert.doesNotMatch(s, /DALR \(10°C\/km\)|MALR \(6°C\/km\)|MALR \(~6/);
});

test('product ladder: self-briefing callout cites AIM 7-1-5', () => {
  const p = text('pages/learn/weather-product-ladder.html');
  assert.match(p, /<strong>This is a self-briefing order, not the briefer's order\.<\/strong>/);
  assert.match(p, /"will automatically provide the following information in the sequence listed"[^]*\(AIM 7-1-5\)/);
  assert.doesNotMatch(p, /AIM 7-1-4's Standard Briefing/);
});

test('fog page: no unsourced 100 to 300 nm distance, and the Handbook section is cited', () => {
  const f = text('pages/learn/fog-formation.html');
  assert.doesNotMatch(f, /100–300 nm/);
  assert.ok((f.match(/FAA-H-8083-28 §18\.1\.1\.1\.4/g) || []).length >= 3, 'the three reworded claims cite it');
  assert.match(f, /Fog forms, often well ahead of the frontal surface, and it may extend over large areas/);
  assert.match(f, /often <strong>well ahead<\/strong> of the surface front and over a large area/);
  assert.match(f, /IFR conditions can extend well ahead of the frontal surface, over a large area/);
});

test('minimums page: the set-them-on-the-ground sentence is there with no em dash', () => {
  const m = text('pages/minimums.html');
  const s = 'Set them on the ground, and don\'t renegotiate them in the air when get-there-itis is doing the talking. That is the whole point of deciding now instead of then.';
  assert.ok(m.includes(s));
});

test('decoder legend: PROB30 matches NWSI 10-813 and PROB40 is explained for military and international TAFs', () => {
  const d = text('pages/decoder.html');
  assert.match(d, /A 30% chance of a thunderstorm or precipitation event and its associated wind, visibility, and sky conditions\. NWS PROB30 groups do not exceed 6 hours\. It is the only probability group NWS TAFs use \(NWSI 10-813\)\./);
  assert.match(d, /A 40% chance of these conditions\. NWS TAFs don't use PROB40, but U\.S\. military and international TAFs may \(FAA-H-8083-28 §27\.4\.2\.10\.3\)\./);
  assert.doesNotMatch(d, /30–39%|40–49%/);
});

test('text added in batch 3 has no em dashes', () => {
  const added = [
    ['pages/learn/icing.html', 'AC 91-74B does not list a tailplane stall recovery procedure. The steps below', '</p>'],
    ['pages/learn/icing.html', 'Follow the AFM or POH procedure for your airplane.', '</ul>'],
    ['pages/learn/icing.html', 'Roll upset guidance, not tail stall recovery', '</p>'],
    ['pages/learn/icing.html', 'Flap extension is the usual trigger', '</p>'],
    ['pages/learn/icing.html', 'Exit the icing conditions immediately', '</li>'],
    ['pages/learn/icing.html', 'Lightening of the controls, difficulty trimming', '</li>'],
    ['pages/learn/icing.html', 'The horizontal stabilizer is ordinarily thinner', '</p>'],
    ['pages/learn/icing.html', 'Temperature ranges (know these, FAA-H-8083-28', 'general guidance.'],
    ['pages/learn/stability-lapse-rates.html', 'The moist rate varies with temperature', 'The relationship'],
    ['pages/learn/weather-product-ladder.html', 'This is a self-briefing order', '</p>'],
    ['pages/learn/fog-formation.html', 'often well ahead of the frontal surface', '.'],
    ['pages/minimums.html', 'Set them on the ground', '</p>'],
    ['pages/decoder.html', 'A 30% chance of a thunderstorm', '</span>'],
    ['pages/decoder.html', 'A 40% chance of these conditions', '</span>'],
  ];
  for (const [file, start, end] of added) {
    const t = text(file);
    const at = t.indexOf(start);
    assert.ok(at >= 0, `${file}: ${start}`);
    const to = t.indexOf(end, at + start.length);
    assert.ok(to > at, `${file}: end ${end}`);
    assert.ok(!/—/.test(t.slice(at, to)), `${file}: em dash in new text starting "${start}"`);
  }
});
