// Audit port, batch 2. Run with: node --test
// Each page fix was checked against its source (AIM Change 3 effective 2026-07-09, eCFR, AC 91-74B,
// FAA-H-8083-28, NWS SCN 26-85, NOAA, AOPA). These tests keep the wrong claims from coming back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readRepoFile } = require('./load-site');

const page = (name) => readRepoFile(`pages/${name}`);
const text = (name) => page(name).replace(/\r\n/g, '\n');

test('turbulence: departure advice follows AIM 7-4-6 and 7-4-9, and the waiver is stated', () => {
  const t = text('learn/turbulence.html');
  assert.match(t, /Note the lead aircraft's rotation point and rotate before it\. Continue climbing above its climb path until you can turn clear of its wake/);
  assert.match(t, /ATC provides 2 minutes behind a heavy and 3 minutes behind a super for same-runway departures \(AIM 7-4-9\)/);
  assert.match(t, /ask for it on ground control before taxiing onto the runway \(AIM 7-4-9\)/);
  assert.match(t, /ATC can waive that 3-minute interval only on your specific request \(AIM 7-4-9\)\. Don't ask for the waiver/);
  assert.doesNotMatch(t, /Climb at VX or Vy and turn upwind/);
});

test('winds aloft: issued four times daily, and the high-wind rule is 51 to 86 everywhere', () => {
  const w = text('learn/winds-aloft-jet-stream.html');
  assert.match(w, /It is issued four times daily and comes in/);
  assert.doesNotMatch(w, /twice daily/);
  assert.doesNotMatch(w, /45 or higher|≥ ?50|50 or above|\(above 36\) is the trigger/);
  assert.equal((w.match(/51 to 86/g) || []).length >= 7, true);
  assert.match(w, /9900/);
  assert.match(w, /99 is a separate flag for light and variable winds/);
});

test('winds aloft scenario: westbound KMCI to KDEN with an even-thousand IFR altitude', () => {
  const w = text('learn/winds-aloft-jet-stream.html');
  assert.match(w, /westbound IFR flight from Kansas City \(KMCI\) to Denver \(KDEN, elevation 5,433 ft\)/);
  assert.match(w, /Option A: File for 10,000 ft/);
  assert.match(w, /540 nm \/ 132 kt = 4\.1 hours/);
  assert.match(w, /about 1\.0 hour more than at 10,000 ft/);
  assert.doesNotMatch(w, /gallons/);
  assert.match(w, /At your 10,000 ft cruise altitude the interpolated FB temperature is about −7°C, and the cloud base is at 11,000 ft, where it is colder still, so every altitude in the cloud layer is below freezing\./);
  assert.match(w, /assume your Cessna T182T \(turbocharged\) cruises at 155 kt TAS at every altitude below/);
  assert.doesNotMatch(w, /Cessna 182T/);
  assert.match(w, /"The briefer will interpolate wind directions and speeds between levels and stations as necessary to provide expected conditions at planned altitudes" \(AIM 7-1-5\)/);
  assert.doesNotMatch(w, /for more than 30 minutes as a required crew member/);
  assert.match(w, /if the bases are at or below 10,000 ft/);
  assert.doesNotMatch(w, /from Denver \(KDEN/);
  assert.doesNotMatch(w, /540 nm \/ 137 kt/);
});

test('the scenario arithmetic is right', () => {
  const wind10 = 18 + (32 - 18) / 3; // interpolated between 9,000 and 12,000 ft
  assert.equal(Math.round(wind10), 23);
  assert.equal(Math.round(-5 + (-12 - -5) / 3), -7);
  assert.equal((540 / (155 - 23)).toFixed(1), '4.1');
  assert.equal((540 / (155 - 48)).toFixed(1), '5.0');
  assert.equal((540 / 107 - 540 / 132).toFixed(1), '1.0');
  // westbound IFR level cruise below 18,000 ft: even thousands (14 CFR 91.179(a)(1)(ii))
  assert.equal(10000 / 1000 % 2, 0);
  // 12,000 and 18,000 ft are also even
  assert.equal(12000 / 1000 % 2, 0);
  assert.equal(18000 / 1000 % 2, 0);
});

test('pireps: UUA list, NEG, SEV, EXTRM, MSL, and the BE36', () => {
  const p = text('learn/pireps.html');
  assert.match(p, /<li>Hail<\/li>/);
  assert.match(p, /<li>Volcanic ash clouds<\/li>/);
  assert.match(p, /<li>Tornadoes, funnel clouds, and waterspouts<\/li>/);
  assert.match(p, /within 2,000 ft of the surface/);
  assert.match(p, /FAA-H-8083-28 §24\.5\.1\.1\.1/);
  assert.match(p, /<span class="hazard-label">NEG<\/span>/);
  assert.equal((p.match(/<span class="hazard-label">SEV<\/span>/g) || []).length, 2);
  assert.match(p, /<span class="hazard-label">EXTRM<\/span>/);
  assert.doesNotMatch(p, /hazard-label">(SVR|EXTM|NIL)/);
  assert.doesNotMatch(p, /\bSVR\b/);
  assert.match(p, /bases at 4,500 ft MSL, tops at 6,500 ft MSL/);
  assert.match(p, /NEG is entered when turbulence was forecast but not encountered/);
  assert.doesNotMatch(p, /pressurized, de-ice equipped/);
});

test('wind shear page uses the PIREP codes', () => {
  const s = text('learn/wind-shear-mountain-wave.html');
  assert.doesNotMatch(s, /MOG TRB|SVR TRB/);
  assert.match(s, /\/TB MOD or \/TB SEV PIREPs/);
  assert.match(s, /\/TB MOD reported at 12,000 ft; \/TB SEV reported at 9,500 ft with a 2,000-ft altitude deviation/);
  assert.doesNotMatch(s, /two reports of|one report of/, 'the counts were invented scenario data with no source');
});

test('icing: Handbook section cites, friction heating, droplet-size weight, tailplane cites', () => {
  const i = text('learn/icing.html');
  assert.doesNotMatch(i, /Aerodynamic cooling/);
  assert.match(i, /airframe icing is negligible above 575 kt, far above general aviation speeds \(FAA-H-8083-28 §20\.3\.4\)/);
  assert.match(i, /below 70°F \(21°C\) and the relative humidity is above 80 percent/);
  assert.match(i, /FAA-H-8083-28 §20\.3\.2\)/);
  assert.doesNotMatch(i, /Droplet size is the primary driver/);
  assert.doesNotMatch(i, /The smaller and more numerous the droplets, the more rapidly/);
  assert.match(i, /Supercooled liquid water content and temperature matter most/);
  assert.match(i, /providing downward lift \(AC 91-74B ¶3-7\)/);
  assert.doesNotMatch(i, /pushing the tail up/);
  // AC 91-74B has no paragraph 4.4: every tailplane cite now points at a real paragraph, or was removed.
  assert.doesNotMatch(i, /AC 91-74B §4\.4/);
  assert.equal((i.match(/AC 91-74B ¶3-7/g) || []).length, 5, 'Ref line, two flap cites, the lift sentence, the diagram comment');
  assert.match(i, /AC 91-74B says the tailplane is a better ice collector than the wings because it presents a thinner surface to the airstream \(AC 91-74B ¶3-1\)/);
  assert.match(i, /retracting flaps could lead to a stall, so configuration changes should be made only per manufacturer guidance \(AC 91-74B ¶5-10a\(2\)\)/);
  assert.match(i, /<strong>Do not recover by reflex\.<\/strong>/);
  assert.doesNotMatch(i, /Tailplane Icing Program · FAA-H-8083-28/);
});

test('icing: no universal flap retraction or reflex recovery advice, and the AFM or POH governs', () => {
  const i = text('learn/icing.html');
  assert.doesNotMatch(i, /retract(?:ing)? (?:the )?flaps immediately|Immediately retract the flaps/i);
  assert.doesNotMatch(i, /recovery is (?:the )?opposite|the response is opposite|apply nose-up trim|back pressure|Do not re-extend flaps|entire chapter/i);
  assert.doesNotMatch(i, /push the yoke forward|Pushing forward in a tailplane stall/);
  assert.match(i, /Do not treat flap retraction as a universal first step/);
  assert.match(i, /For other aircraft, retracting the flaps or slats at this stage could lead to a stall\./);
  assert.match(i, /"similar to those for wing stall recovery, and in some respects opposite from those for recovery from the ICTS" \(AC 91-74B ¶5-13a\)/);
  assert.match(i, /Wing stall and tailplane stall are not recovered the same way\. The AC says its roll upset procedures, which include "Reduce the AOA by reducing the aircraft pitch"/);
  assert.match(i, /It does not say which respects\./);
  assert.doesNotMatch(i, /makes it worse/);
  assert.match(i, /"adhere to AFM limitations and procedures for flap use in icing, if any" \(AC 91-74B ¶5-10e\(1\)\)/);
  assert.match(i, /"consider a partial- or no-flap landing" \(AC 91-74B ¶5-10e\(2\)\)/);
  // each of the lines that used to give a flap or stall recovery action now defers to the AFM or POH and cites 5-10
  assert.ok((i.match(/AC 91-74B ¶5-10a\(2\)/g) || []).length >= 7);
  assert.doesNotMatch(i, /\(AC 91-74B ¶3-7\)<\/p>|retract flaps immediately\. \(AC 91-74B ¶3-7\)/);
});

test('winds aloft Option C: the oxygen sentence names (a)(1), (a)(2), and (a)(3) for an 18,000 ft flight', () => {
  const w = text('learn/winds-aloft-jet-stream.html');
  assert.match(w, /more than 30 minutes at cabin pressure altitudes above 12,500 ft MSL up to and including 14,000 ft MSL \(a\)\(1\)/);
  assert.match(w, /during the entire flight time at cabin pressure altitudes above 14,000 ft MSL \(a\)\(2\)/);
  assert.match(w, /above 15,000 ft MSL \(a\)\(3\)/);
  assert.match(w, /\(14 CFR 91\.211\(a\)\(1\), \(a\)\(2\), and \(a\)\(3\)\)/);
});

test('thunderstorm page: VFR into IMC statement, convective SIGMET criteria and validity', () => {
  const t = text('learn/thunderstorm-life-cycle.html');
  assert.match(t, /AOPA, citing the Nall Report, reports VFR into IMC as the most fatal weather-related accident category, with more than 75 percent resulting in a fatality/);
  assert.match(t, /heavy-precipitation thunderstorms affecting 40 percent or more of an area of at least 3,000 square miles \(AIM 7-1-6\)/);
  assert.match(t, /Valid for 2 hours until about December 1, 2026; the NWS is changing the valid time to 1 hour on or about that date \(NWS SCN 26-85; AIM 7-1-6\)/);
  assert.doesNotMatch(t, /≥40% coverage with hail or tornadoes/);
});

test('weather charts: data time column, forecast sentence, isobar and bombogenesis', () => {
  const c = text('learn/weather-charts.html');
  assert.doesNotMatch(c, /<th>Issued<\/th>/);
  assert.match(c, /<th>Data time<\/th>/);
  assert.equal((c.match(/<td>00Z and 12Z \(radiosonde observations\)<\/td>/g) || []).length, 5);
  assert.doesNotMatch(c, /4x daily/);
  assert.match(c, /Radiosondes are assigned observation times of 1200 UTC and 0000 UTC \(FAA-H-8083-28 §24\.8\.1\)/);
  assert.match(c, /The GFS and NAM produce constant pressure level forecasts four times per day, with initial times of 00, 06, 12, and 18 UTC \(FAA-H-8083-28 §27\.11\.1\.1\)/);
  assert.doesNotMatch(c, /between 4 mb isobars/);
  assert.match(c, /about 17\.8 mb over 24 hours at the latitude of New York City/);
  assert.doesNotMatch(c, /1 mb\/hr/);
});

test('airmets-sigmets: Convective SIGMET valid time has both dates and the sources', () => {
  const a = text('learn/airmets-sigmets.html');
  assert.match(a, /valid for 2 hours until about December 1, 2026 \(FAA-H-8083-28 §26\.2\.4\.2\.3\)\. The NWS is changing the valid time to 1 hour on or about that date \(NWS SCN 26-85; AIM 7-1-6\)/);
  assert.match(a, /Valid for 2 hours until about December 1, 2026, then 1 hour \(NWS SCN 26-85; AIM 7-1-6\)/);
  assert.match(a, /valid 2 hours until about December 1, 2026, then 1 hour \(NWS SCN 26-85; AIM 7-1-6\)/);
  assert.doesNotMatch(a, /valid for up to 2 hours|Valid only 2 hours/);
});

test('navlog: hemispheric rule messages say MSL and name the 3,000 ft above the surface condition', () => {
  const n = text('navlog.html');
  assert.match(n, /more than 3,000 ft above the surface; altitude is MSL \(14 CFR §91\.159\)/);
  assert.match(n, /IFR uses odd or even thousands with no 500 ft \(14 CFR 91\.179\)/);
});

test('the text added in batch 2 has no em dashes', () => {
  const added = [
    ['learn/turbulence.html', 'Note the lead aircraft\'s rotation point', '</li>'],
    ['learn/turbulence.html', 'ATC can waive that 3-minute interval', '</li>'],
    ['learn/winds-aloft-jet-stream.html', 'Option A: File for 10,000 ft', '</summary>'],
    ['learn/winds-aloft-jet-stream.html', 'The FB has no 10,000 ft entry', '</p>'],
    ['learn/winds-aloft-jet-stream.html', 'That\'s about 1.0 hour more', '. At 18,000'],
    ['learn/winds-aloft-jet-stream.html', 'Start with the altitude that has the least headwind', '</p>'],
    ['learn/pireps.html', 'The Handbook lists these as urgent', '</ul>'],
    ['learn/pireps.html', 'A BE36 is a piston single', 'This PIREP is 2 hours old'],
    ['learn/icing.html', 'It is most likely when temperatures are below 70', '.)'],
    ['learn/icing.html', 'At high speeds, friction heats', '</li>'],
    ['learn/icing.html', 'Supercooled liquid water content and temperature matter most', '</p>'],
    ['learn/icing.html', 'providing downward lift (AC 91-74B', 'and to do so'],
    ['learn/thunderstorm-life-cycle.html', 'Weather also matters most when a VFR pilot', '</p>'],
    ['learn/thunderstorm-life-cycle.html', 'Issued for severe thunderstorms (surface winds', '</li>'],
    ['learn/thunderstorm-life-cycle.html', 'Valid for 2 hours until about December 1, 2026', '</li>'],
    ['learn/weather-charts.html', 'Radiosondes are assigned observation times', '</p>'],
    ['learn/weather-charts.html', 'Closely spaced isobars mean', '</li>'],
    ['learn/weather-charts.html', 'Models also forecast these levels', '</p>'],
    ['learn/airmets-sigmets.html', 'Valid for 2 hours until about December 1, 2026, then', '</li>'],
    ['learn/airmets-sigmets.html', 'valid 2 hours until about December 1, 2026, then', '</li>'],
    ['learn/icing.html', 'AC 91-74B does not list a tailplane stall recovery', 'General guidance:'],
    ['learn/winds-aloft-jet-stream.html', 'At your 10,000 ft cruise altitude', '</p>'],
    ['learn/winds-aloft-jet-stream.html', 'At 18,000 ft you\'re also well inside', 'this isn\'t the answer'],
    ['navlog.html', 'The hemispheric check applies to VFR cruise', '"'],
  ];
  for (const [file, start, end] of added) {
    const t = text(file);
    const at = t.indexOf(start);
    assert.ok(at >= 0, `${file}: ${start}`);
    const to = t.indexOf(end, at);
    assert.ok(to > at, `${file}: end ${end}`);
    assert.ok(!/—/.test(t.slice(at, to)), `${file}: em dash in new text starting "${start}"`);
  }
});
