/* Cessna 172S NAV III POH Performance Data
   Source: Section 5, document 172SPHBUS-00
   Loaded as a plain global script — pohInterp functions receive this as the 'poh' argument.
   Schema is aircraft-agnostic: future profiles follow the same structure. */

const C172S_POH = {
  meta: {
    aircraft: 'Cessna 172S NAV III',
    weight_lb: 2550,
    source: 'Cessna 172S POH Section 5, document 172SPHBUS-00',
    note: 'Cruise speeds in this table are for airplane with speed fairings. pohInterp.cruisePerf() subtracts 2 kt at output for aircraft without fairings.'
  },

  /* ── CLIMB  Figure 5-7 ──────────────────────────────────────────────────
     Conditions: Flaps UP, Full Throttle, Standard Temperature, Zero Wind
     Cumulative values from sea level.
     Add 1.4 gal for start/taxi/takeoff. Lean above 3000 ft.
     Increase time/fuel/distance 10% per 10°C above standard. */
  climb: {
    conditions: 'Flaps UP, Full Throttle, Standard Temperature, Zero Wind',
    start_taxi_takeoff_allowance_gal: 1.4,
    temp_correction_per_10C_above_std: 0.10,
    rows: [
      { pa_ft: 0,     std_temp_C: 15, climb_speed_KIAS: 74, roc_fpm: 730, time_min: 0,  fuel_gal: 0.0, dist_nm: 0  },
      { pa_ft: 1000,  std_temp_C: 13, climb_speed_KIAS: 73, roc_fpm: 695, time_min: 1,  fuel_gal: 0.4, dist_nm: 2  },
      { pa_ft: 2000,  std_temp_C: 11, climb_speed_KIAS: 73, roc_fpm: 655, time_min: 3,  fuel_gal: 0.8, dist_nm: 4  },
      { pa_ft: 3000,  std_temp_C: 9,  climb_speed_KIAS: 73, roc_fpm: 620, time_min: 4,  fuel_gal: 1.2, dist_nm: 6  },
      { pa_ft: 4000,  std_temp_C: 7,  climb_speed_KIAS: 73, roc_fpm: 600, time_min: 6,  fuel_gal: 1.5, dist_nm: 8  },
      { pa_ft: 5000,  std_temp_C: 5,  climb_speed_KIAS: 73, roc_fpm: 550, time_min: 8,  fuel_gal: 1.9, dist_nm: 10 },
      { pa_ft: 6000,  std_temp_C: 3,  climb_speed_KIAS: 73, roc_fpm: 505, time_min: 10, fuel_gal: 2.2, dist_nm: 13 },
      { pa_ft: 7000,  std_temp_C: 1,  climb_speed_KIAS: 73, roc_fpm: 455, time_min: 12, fuel_gal: 2.6, dist_nm: 16 },
      { pa_ft: 8000,  std_temp_C: -1, climb_speed_KIAS: 72, roc_fpm: 410, time_min: 14, fuel_gal: 3.0, dist_nm: 19 },
      { pa_ft: 9000,  std_temp_C: -3, climb_speed_KIAS: 72, roc_fpm: 360, time_min: 17, fuel_gal: 3.4, dist_nm: 22 },
      { pa_ft: 10000, std_temp_C: -5, climb_speed_KIAS: 72, roc_fpm: 315, time_min: 20, fuel_gal: 3.9, dist_nm: 27 },
      { pa_ft: 11000, std_temp_C: -7, climb_speed_KIAS: 72, roc_fpm: 265, time_min: 24, fuel_gal: 4.4, dist_nm: 32 },
      { pa_ft: 12000, std_temp_C: -9, climb_speed_KIAS: 72, roc_fpm: 220, time_min: 28, fuel_gal: 5.0, dist_nm: 38 },
    ]
  },

  /* ── CRUISE  Figure 5-8 ─────────────────────────────────────────────────
     Conditions: 2550 lb, Recommended Lean Mixture
     3-axis table: pressure altitude × RPM × temperature deviation from ISA.
     Temperature columns: m20 = −20°C from ISA, std = ISA standard, p20 = +20°C from ISA.
     8000/10000/12000 ft rows are reserved; populate rpm_rows when data is available. */
  cruise: {
    conditions: '2550 lb, Recommended Lean Mixture',
    altitudes: [
      {
        pa_ft: 2000,
        rpm_rows: [
          { rpm: 2550, m20: { bhp: 83, ktas: 117, gph: 11.1 }, std: { bhp: 77, ktas: 118, gph: 10.5 }, p20: { bhp: 72, ktas: 117, gph: 9.9  } },
          { rpm: 2500, m20: { bhp: 78, ktas: 115, gph: 10.6 }, std: { bhp: 73, ktas: 115, gph: 9.9  }, p20: { bhp: 68, ktas: 115, gph: 9.4  } },
          { rpm: 2400, m20: { bhp: 69, ktas: 111, gph: 9.6  }, std: { bhp: 64, ktas: 110, gph: 9.0  }, p20: { bhp: 60, ktas: 109, gph: 8.5  } },
          { rpm: 2300, m20: { bhp: 61, ktas: 105, gph: 8.6  }, std: { bhp: 57, ktas: 104, gph: 8.1  }, p20: { bhp: 53, ktas: 102, gph: 7.7  } },
          { rpm: 2200, m20: { bhp: 53, ktas: 99,  gph: 7.7  }, std: { bhp: 50, ktas: 97,  gph: 7.3  }, p20: { bhp: 47, ktas: 95,  gph: 6.9  } },
          { rpm: 2100, m20: { bhp: 47, ktas: 92,  gph: 6.9  }, std: { bhp: 44, ktas: 90,  gph: 6.6  }, p20: { bhp: 42, ktas: 89,  gph: 6.3  } },
        ]
      },
      {
        pa_ft: 4000,
        rpm_rows: [
          { rpm: 2600, m20: { bhp: 83, ktas: 120, gph: 11.1 }, std: { bhp: 77, ktas: 120, gph: 10.4 }, p20: { bhp: 72, ktas: 119, gph: 9.8  } },
          { rpm: 2550, m20: { bhp: 79, ktas: 118, gph: 10.6 }, std: { bhp: 73, ktas: 117, gph: 9.9  }, p20: { bhp: 68, ktas: 117, gph: 9.4  } },
          { rpm: 2500, m20: { bhp: 74, ktas: 115, gph: 10.1 }, std: { bhp: 69, ktas: 115, gph: 9.5  }, p20: { bhp: 64, ktas: 114, gph: 8.9  } },
          { rpm: 2400, m20: { bhp: 65, ktas: 110, gph: 9.1  }, std: { bhp: 61, ktas: 109, gph: 8.5  }, p20: { bhp: 57, ktas: 107, gph: 8.1  } },
          { rpm: 2300, m20: { bhp: 58, ktas: 104, gph: 8.2  }, std: { bhp: 54, ktas: 102, gph: 7.7  }, p20: { bhp: 51, ktas: 101, gph: 7.3  } },
          { rpm: 2200, m20: { bhp: 51, ktas: 98,  gph: 7.4  }, std: { bhp: 48, ktas: 96,  gph: 7.0  }, p20: { bhp: 45, ktas: 94,  gph: 6.7  } },
          { rpm: 2100, m20: { bhp: 45, ktas: 91,  gph: 6.6  }, std: { bhp: 42, ktas: 89,  gph: 6.4  }, p20: { bhp: 40, ktas: 87,  gph: 6.1  } },
        ]
      },
      {
        pa_ft: 6000,
        rpm_rows: [
          { rpm: 2650, m20: { bhp: 83, ktas: 122, gph: 11.1 }, std: { bhp: 77, ktas: 122, gph: 10.4 }, p20: { bhp: 72, ktas: 121, gph: 9.8  } },
          { rpm: 2600, m20: { bhp: 78, ktas: 120, gph: 10.6 }, std: { bhp: 73, ktas: 119, gph: 9.9  }, p20: { bhp: 68, ktas: 118, gph: 9.4  } },
          { rpm: 2500, m20: { bhp: 70, ktas: 115, gph: 9.6  }, std: { bhp: 65, ktas: 114, gph: 9.0  }, p20: { bhp: 60, ktas: 112, gph: 8.5  } },
          { rpm: 2400, m20: { bhp: 62, ktas: 109, gph: 8.6  }, std: { bhp: 57, ktas: 108, gph: 8.2  }, p20: { bhp: 54, ktas: 106, gph: 7.7  } },
          { rpm: 2300, m20: { bhp: 54, ktas: 103, gph: 7.8  }, std: { bhp: 51, ktas: 101, gph: 7.4  }, p20: { bhp: 48, ktas: 99,  gph: 7.0  } },
          { rpm: 2200, m20: { bhp: 48, ktas: 96,  gph: 7.1  }, std: { bhp: 45, ktas: 94,  gph: 6.7  }, p20: { bhp: 43, ktas: 92,  gph: 6.4  } },
        ]
      },
      { pa_ft: 8000,  rpm_rows: [] },
      { pa_ft: 10000, rpm_rows: [] },
      { pa_ft: 12000, rpm_rows: [] },
    ]
  },

  /* ── SHORT FIELD TAKEOFF  Figure 5-5 ────────────────────────────────────
     Conditions: Flaps 10°, Full Throttle prior to brake release,
     Paved/Level/Dry, Zero Wind. Liftoff 51 KIAS, 50 ft 56 KIAS.
     Not wired to nav log UI yet — populated for future takeoff/landing tool. */
  takeoff_short_field: {
    conditions: 'Flaps 10°, Full Throttle prior to brake release, Paved/Level/Dry, Zero Wind',
    liftoff_KIAS: 51,
    speed_at_50ft_KIAS: 56,
    temps_C: [0, 10, 20, 30, 40],
    rows: [
      { pa_ft: 0,    gnd_roll: [860,  925,  995,  1070, 1150], total_50ft: [1465, 1575, 1690, 1810, 1945] },
      { pa_ft: 1000, gnd_roll: [940,  1010, 1090, 1170, 1260], total_50ft: [1600, 1720, 1850, 1990, 2135] },
      { pa_ft: 2000, gnd_roll: [1025, 1110, 1195, 1285, 1380], total_50ft: [1755, 1890, 2035, 2190, 2355] },
      { pa_ft: 3000, gnd_roll: [1125, 1215, 1310, 1410, 1515], total_50ft: [1925, 2080, 2240, 2420, 2605] },
      { pa_ft: 4000, gnd_roll: [1235, 1335, 1440, 1550, 1660], total_50ft: [2120, 2295, 2480, 2685, 2880] },
      { pa_ft: 5000, gnd_roll: [1355, 1465, 1585, 1705, 1825], total_50ft: [2345, 2545, 2755, 2975, 3205] },
      { pa_ft: 6000, gnd_roll: [1495, 1615, 1745, 1875, 2010], total_50ft: [2605, 2830, 3075, 3320, 3585] },
      { pa_ft: 7000, gnd_roll: [1645, 1785, 1920, 2065, 2215], total_50ft: [2910, 3170, 3440, 3730, 4045] },
      { pa_ft: 8000, gnd_roll: [1820, 1970, 2120, 2280, 2450], total_50ft: [3265, 3575, 3880, 4225, 4615] },
    ],
    corrections: {
      headwind_pct_per_9kt:        -0.10,
      tailwind_pct_per_2kt:        +0.10,
      dry_grass_ground_roll_pct:   +0.15
    }
  },

  /* ── SHORT FIELD LANDING  Figure 5-11 ───────────────────────────────────
     Conditions: Flaps FULL, Power IDLE, Maximum Braking,
     Paved/Level/Dry, Zero Wind. 50 ft 61 KIAS.
     Not wired to nav log UI yet — populated for future takeoff/landing tool. */
  landing_short_field: {
    conditions: 'Flaps FULL, Power IDLE, Maximum Braking, Paved/Level/Dry, Zero Wind',
    speed_at_50ft_KIAS: 61,
    temps_C: [0, 10, 20, 30, 40],
    rows: [
      { pa_ft: 0,    gnd_roll: [545, 565, 585, 605, 625], total_50ft: [1290, 1320, 1350, 1380, 1415] },
      { pa_ft: 1000, gnd_roll: [565, 585, 605, 625, 650], total_50ft: [1320, 1350, 1385, 1420, 1450] },
      { pa_ft: 2000, gnd_roll: [585, 610, 630, 650, 670], total_50ft: [1355, 1385, 1420, 1455, 1490] },
      { pa_ft: 3000, gnd_roll: [610, 630, 655, 675, 695], total_50ft: [1385, 1425, 1460, 1495, 1530] },
      { pa_ft: 4000, gnd_roll: [630, 655, 675, 700, 725], total_50ft: [1425, 1460, 1495, 1535, 1570] },
      { pa_ft: 5000, gnd_roll: [655, 680, 705, 725, 750], total_50ft: [1460, 1500, 1535, 1575, 1615] },
      { pa_ft: 6000, gnd_roll: [680, 705, 730, 755, 780], total_50ft: [1500, 1540, 1580, 1620, 1660] },
      { pa_ft: 7000, gnd_roll: [705, 730, 760, 785, 810], total_50ft: [1545, 1585, 1625, 1665, 1705] },
      { pa_ft: 8000, gnd_roll: [735, 760, 790, 815, 840], total_50ft: [1585, 1630, 1670, 1715, 1755] },
    ],
    corrections: {
      headwind_pct_per_9kt:        -0.10,
      tailwind_pct_per_2kt:        +0.10,
      dry_grass_ground_roll_pct:   +0.45,
      flaps_up_speed_increase_KIAS: 9,
      flaps_up_distance_pct:       +0.35
    }
  }
};
