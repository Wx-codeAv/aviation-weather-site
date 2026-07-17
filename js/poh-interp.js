/* POH Interpolation Engine — CrosswindWX
   Pure functions, no DOM access. Each function takes a poh data object as its
   first argument so the same engine works with any aircraft profile.
   Loaded as a plain global script; all functions exposed via window.pohInterp. */

window.pohInterp = (function () {

  /* ISA standard temperature at pressure altitude */
  function stdTempC(pa_ft) {
    return 15 - (pa_ft / 1000) * 2;
  }

  /* Linear interpolation — returns y0 when x0 === x1 to avoid division by zero */
  function lerp(x, x0, x1, y0, y1) {
    if (x1 === x0) return y0;
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }

  /* ── CLIMB ────────────────────────────────────────────────────────────────
     Returns cumulative climb values from sea level to pa_target_ft at oat_C.
     Returns null when pa_target_ft is outside the climb table bounds (no extrapolation).

     Temperature correction: +10% per 10°C above ISA standard (time/fuel/dist only;
     ROC and climb speed are not corrected). Applied only when OAT > ISA standard.

     Worked example:
       climbPerf(C172S_POH, 4000, 17)
       ISA std at 4000 ft = 7°C → temp_dev = +10°C → factor = 1.10
       Base (std): time=6 min, fuel=1.5 gal, dist=8 NM, roc=600 fpm, speed=73 KIAS
       Corrected:  time=7 min, fuel=1.7 gal, dist=9 NM  */
  function climbPerf(poh, pa_target_ft, oat_C) {
    const rows = poh.climb.rows;
    if (pa_target_ft < rows[0].pa_ft || pa_target_ft > rows[rows.length - 1].pa_ft) return null;

    let lo = rows[0], hi = rows[rows.length - 1];
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].pa_ft <= pa_target_ft && rows[i + 1].pa_ft >= pa_target_ft) {
        lo = rows[i]; hi = rows[i + 1]; break;
      }
    }

    const t = (hi.pa_ft === lo.pa_ft) ? 0 : (pa_target_ft - lo.pa_ft) / (hi.pa_ft - lo.pa_ft);
    const itp = (f) => lo[f] + (hi[f] - lo[f]) * t;

    let time_min  = itp('time_min');
    let fuel_gal  = itp('fuel_gal');
    let dist_nm   = itp('dist_nm');
    const roc     = itp('roc_fpm');
    const speed   = itp('climb_speed_KIAS');

    const temp_dev = oat_C - stdTempC(pa_target_ft);
    if (temp_dev > 0) {
      const factor = 1 + poh.climb.temp_correction_per_10C_above_std * (temp_dev / 10);
      time_min *= factor;
      fuel_gal *= factor;
      dist_nm  *= factor;
    }

    return {
      time_min:         Math.round(time_min),
      fuel_gal:         Math.round(fuel_gal * 10) / 10,
      dist_nm:          Math.round(dist_nm),
      roc_fpm:          Math.round(roc / 5) * 5,
      climb_speed_KIAS: Math.round(speed),
    };
  }

  /* ── CLIMB SEGMENT ────────────────────────────────────────────────────────
     Delta from field elevation to cruise altitude. Adds the POH start/taxi/
     takeoff allowance (1.4 gal for C172S) to the fuel figure.
     Returns null if either altitude is out of range or field_elev >= cruise_alt.

     Worked example (standard day):
       climbSegment(C172S_POH, 0, 4000, 15, 7)
       At SL (15°C std): time=0, fuel=0, dist=0
       At 4000 ft (7°C std): time=6, fuel=1.5, dist=8
       Delta: time=6 min, climb_fuel=1.5 gal, taxi_fuel=1.4 gal, dist=8 NM  */
  function climbSegment(poh, field_elev_ft, cruise_alt_ft, oat_at_field_C, oat_at_cruise_C) {
    if (field_elev_ft >= cruise_alt_ft) return null;
    const atField  = climbPerf(poh, field_elev_ft, oat_at_field_C);
    const atCruise = climbPerf(poh, cruise_alt_ft,  oat_at_cruise_C);
    if (!atField || !atCruise) return null;

    const climb_fuel = Math.max(0, atCruise.fuel_gal - atField.fuel_gal);
    const taxi_fuel  = poh.climb.start_taxi_takeoff_allowance_gal;

    return {
      time_min:         Math.max(0, atCruise.time_min - atField.time_min),
      climb_fuel_gal:   Math.round(climb_fuel * 10) / 10,
      taxi_fuel_gal:    taxi_fuel,
      fuel_gal:         Math.round((climb_fuel + taxi_fuel) * 10) / 10,
      dist_nm:          Math.max(0, atCruise.dist_nm - atField.dist_nm),
      climb_speed_KIAS: atField.climb_speed_KIAS,
    };
  }

  /* Internal: interpolate across temperature columns for one (altitude, RPM) cell.
     temp_dev is OAT − ISA_std at that table altitude, already bounds-checked by
     _interpAtAlt before this is called. Clamped here too as a safety net against
     NaN arithmetic inside the bracket, not as the out-of-bounds handling itself. */
  function _tempInterpCell(cell, temp_dev) {
    const dev = Math.max(-20, Math.min(20, temp_dev));
    const pick = (f) => {
      if (dev <= -20) return cell.m20[f];
      if (dev >=  20) return cell.p20[f];
      if (dev <=   0) return lerp(dev, -20, 0,  cell.m20[f], cell.std[f]);
                      return lerp(dev,   0, 20, cell.std[f], cell.p20[f]);
    };
    return { bhp: pick('bhp'), ktas: pick('ktas'), gph: pick('gph') };
  }

  /* Internal: interpolate within one altitude table at rpm_target.
     Returns null if rpm_target is outside the table's RPM range, or if temp_dev
     (OAT − ISA_std at this table's altitude) is outside the table's ±20°C columns —
     the table has no data past that, so returning a clamped-edge value here would
     be silent extrapolation dressed up as a real lookup. */
  function _interpAtAlt(altTable, oat_C, rpm_target) {
    const rpms = altTable.rpm_rows;
    if (!rpms.length) return null;

    const sorted = [...rpms].sort((a, b) => a.rpm - b.rpm);
    const minRPM = sorted[0].rpm;
    const maxRPM = sorted[sorted.length - 1].rpm;
    if (rpm_target < minRPM || rpm_target > maxRPM) return null;

    let loR = sorted[0], hiR = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].rpm <= rpm_target && sorted[i + 1].rpm >= rpm_target) {
        loR = sorted[i]; hiR = sorted[i + 1]; break;
      }
    }

    const temp_dev = oat_C - stdTempC(altTable.pa_ft);
    if (temp_dev < -20 || temp_dev > 20) return null;
    const cLo = _tempInterpCell(loR, temp_dev);
    const cHi = _tempInterpCell(hiR, temp_dev);

    if (hiR.rpm === loR.rpm) return cLo;
    return {
      bhp:  lerp(rpm_target, loR.rpm, hiR.rpm, cLo.bhp,  cHi.bhp),
      ktas: lerp(rpm_target, loR.rpm, hiR.rpm, cLo.ktas, cHi.ktas),
      gph:  lerp(rpm_target, loR.rpm, hiR.rpm, cLo.gph,  cHi.gph),
    };
  }

  /* ── CRUISE ───────────────────────────────────────────────────────────────
     3-axis interpolation: pressure altitude × RPM × temperature deviation.
     Returns null when inputs fall outside the populated table bounds.

     Algorithm:
       1. Bracket pa_target_ft between two altitude tables.
       2. Within each table, bracket rpm_target between two RPM rows.
       3. For each (altitude, RPM) cell, compute temp_dev = oat_C − ISA_std(table_alt)
          and linearly interpolate across the three temperature columns.
       4. Lerp the RPM results to rpm_target. Repeat for both altitudes.
       5. Lerp the two altitude results to pa_target_ft.

     Worked example — verified against POH Fig. 5-8:
       cruisePerf(C172S_POH, 4500, 16, 2400) → expect 106 kt, 8.2 GPH

       4000 ft table: ISA std = 7°C → temp_dev = 16−7 = +9°C
         2400 RPM std={61,109,8.5} p20={57,107,8.1}
         ktas = lerp(9,0,20,109,107) = 108.1
         gph  = lerp(9,0,20,8.5,8.1) = 8.32
       6000 ft table: ISA std = 3°C → temp_dev = 16−3 = +13°C
         2400 RPM std={57,108,8.2} p20={54,106,7.7}
         ktas = lerp(13,0,20,108,106) = 106.7
         gph  = lerp(13,0,20,8.2,7.7) = 7.875
       Lerp to 4500 ft (t=0.25):
         ktas = 108.1+(106.7-108.1)x0.25 = 107.75 → 108, minus 2 (no fairings) = 106 kt
         gph  = 8.32+(7.875-8.32)x0.25   = 8.21   → 8.2 GPH  */
  function cruisePerf(poh, pa_target_ft, oat_C, rpm_target) {
    const populated = poh.cruise.altitudes.filter(a => a.rpm_rows.length > 0);
    if (populated.length < 2) return null;

    const minAlt = populated[0].pa_ft;
    const maxAlt = populated[populated.length - 1].pa_ft;
    if (pa_target_ft < minAlt || pa_target_ft > maxAlt) return null;

    let loAlt = populated[0], hiAlt = populated[populated.length - 1];
    for (let i = 0; i < populated.length - 1; i++) {
      if (populated[i].pa_ft <= pa_target_ft && populated[i + 1].pa_ft >= pa_target_ft) {
        loAlt = populated[i]; hiAlt = populated[i + 1]; break;
      }
    }

    const atLo = _interpAtAlt(loAlt, oat_C, rpm_target);
    const atHi = _interpAtAlt(hiAlt, oat_C, rpm_target);
    if (!atLo || !atHi) return null;

    const f = (loAlt.pa_ft === hiAlt.pa_ft) ? 0
              : (pa_target_ft - loAlt.pa_ft) / (hiAlt.pa_ft - loAlt.pa_ft);

    // POH speeds are for speed fairings; subtract 2 kt for aircraft without fairings
    return {
      bhp_pct: Math.round( atLo.bhp  + (atHi.bhp  - atLo.bhp)  * f ),
      ktas:    Math.round( atLo.ktas + (atHi.ktas  - atLo.ktas) * f ) - 2,
      gph:     Math.round((atLo.gph  + (atHi.gph   - atLo.gph)  * f) * 10) / 10,
    };
  }

  /* ── TAKEOFF ──────────────────────────────────────────────────────────────
     Short-field technique (Figure 5-5). Not wired to UI — reserved for the
     future Takeoff/Landing Performance tool.
     Returns null when pa_ft or temp_C is outside the table bounds.

     Worked example:
       takeoffPerf(C172S_POH, 2000, 20, 0, 0, 'paved')
       PA 2000, 20°C = exact table cell → gnd_roll=1195 ft, total_50ft=2035 ft  */
  function takeoffPerf(poh, pa_ft, temp_C, headwind_kt, tailwind_kt, surface) {
    const data  = poh.takeoff_short_field;
    const rows  = data.rows;
    const temps = data.temps_C;
    if (pa_ft   < rows[0].pa_ft    || pa_ft   > rows[rows.length - 1].pa_ft)    return null;
    if (temp_C  < temps[0]         || temp_C  > temps[temps.length - 1])         return null;

    let loR = rows[0], hiR = rows[rows.length - 1];
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].pa_ft <= pa_ft && rows[i + 1].pa_ft >= pa_ft) {
        loR = rows[i]; hiR = rows[i + 1]; break;
      }
    }
    let ti = 0;
    for (let i = 0; i < temps.length - 1; i++) {
      if (temps[i] <= temp_C && temps[i + 1] >= temp_C) { ti = i; break; }
    }
    const tf = (temps[ti + 1] === temps[ti]) ? 0 : (temp_C - temps[ti]) / (temps[ti + 1] - temps[ti]);

    const grLo = loR.gnd_roll[ti]   + (loR.gnd_roll[ti + 1]   - loR.gnd_roll[ti])   * tf;
    const ftLo = loR.total_50ft[ti] + (loR.total_50ft[ti + 1]  - loR.total_50ft[ti]) * tf;
    const grHi = hiR.gnd_roll[ti]   + (hiR.gnd_roll[ti + 1]   - hiR.gnd_roll[ti])   * tf;
    const ftHi = hiR.total_50ft[ti] + (hiR.total_50ft[ti + 1]  - hiR.total_50ft[ti]) * tf;

    const pf = (hiR.pa_ft === loR.pa_ft) ? 0 : (pa_ft - loR.pa_ft) / (hiR.pa_ft - loR.pa_ft);
    let gnd_roll   = grLo + (grHi - grLo) * pf;
    let total_50ft = ftLo + (ftHi - ftLo) * pf;

    if (headwind_kt > 0) {
      const f = 1 + data.corrections.headwind_pct_per_9kt * (headwind_kt / 9);
      gnd_roll *= f; total_50ft *= f;
    }
    if (tailwind_kt > 0) {
      const f = 1 + data.corrections.tailwind_pct_per_2kt * (Math.min(tailwind_kt, 10) / 2);
      gnd_roll *= f; total_50ft *= f;
    }
    if (surface === 'dry_grass') {
      gnd_roll *= (1 + data.corrections.dry_grass_ground_roll_pct);
    }

    return { gnd_roll_ft: Math.round(gnd_roll), total_50ft_ft: Math.round(total_50ft) };
  }

  /* ── LANDING ──────────────────────────────────────────────────────────────
     Short-field technique (Figure 5-11). Not wired to UI — reserved for the
     future Takeoff/Landing Performance tool.
     flaps: 'full' | 'up'

     Worked example:
       landingPerf(C172S_POH, 0, 20, 0, 0, 'paved', 'full')
       PA 0, 20°C = exact table cell → gnd_roll=585 ft, total_50ft=1350 ft  */
  function landingPerf(poh, pa_ft, temp_C, headwind_kt, tailwind_kt, surface, flaps) {
    const data  = poh.landing_short_field;
    const rows  = data.rows;
    const temps = data.temps_C;
    if (pa_ft  < rows[0].pa_ft    || pa_ft  > rows[rows.length - 1].pa_ft)    return null;
    if (temp_C < temps[0]         || temp_C > temps[temps.length - 1])         return null;

    let loR = rows[0], hiR = rows[rows.length - 1];
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].pa_ft <= pa_ft && rows[i + 1].pa_ft >= pa_ft) {
        loR = rows[i]; hiR = rows[i + 1]; break;
      }
    }
    let ti = 0;
    for (let i = 0; i < temps.length - 1; i++) {
      if (temps[i] <= temp_C && temps[i + 1] >= temp_C) { ti = i; break; }
    }
    const tf = (temps[ti + 1] === temps[ti]) ? 0 : (temp_C - temps[ti]) / (temps[ti + 1] - temps[ti]);

    const grLo = loR.gnd_roll[ti]   + (loR.gnd_roll[ti + 1]   - loR.gnd_roll[ti])   * tf;
    const ftLo = loR.total_50ft[ti] + (loR.total_50ft[ti + 1]  - loR.total_50ft[ti]) * tf;
    const grHi = hiR.gnd_roll[ti]   + (hiR.gnd_roll[ti + 1]   - hiR.gnd_roll[ti])   * tf;
    const ftHi = hiR.total_50ft[ti] + (hiR.total_50ft[ti + 1]  - hiR.total_50ft[ti]) * tf;

    const pf = (hiR.pa_ft === loR.pa_ft) ? 0 : (pa_ft - loR.pa_ft) / (hiR.pa_ft - loR.pa_ft);
    let gnd_roll   = grLo + (grHi - grLo) * pf;
    let total_50ft = ftLo + (ftHi - ftLo) * pf;

    if (headwind_kt > 0) {
      const f = 1 + data.corrections.headwind_pct_per_9kt * (headwind_kt / 9);
      gnd_roll *= f; total_50ft *= f;
    }
    if (tailwind_kt > 0) {
      const f = 1 + data.corrections.tailwind_pct_per_2kt * (Math.min(tailwind_kt, 10) / 2);
      gnd_roll *= f; total_50ft *= f;
    }
    if (surface === 'dry_grass') {
      gnd_roll *= (1 + data.corrections.dry_grass_ground_roll_pct);
    }
    if (flaps === 'up') {
      gnd_roll   *= (1 + data.corrections.flaps_up_distance_pct);
      total_50ft *= (1 + data.corrections.flaps_up_distance_pct);
    }

    return { gnd_roll_ft: Math.round(gnd_roll), total_50ft_ft: Math.round(total_50ft) };
  }

  return { stdTempC, lerp, climbPerf, climbSegment, cruisePerf, takeoffPerf, landingPerf };
})();
