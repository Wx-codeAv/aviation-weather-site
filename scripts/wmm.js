// World Magnetic Model declination, spherical harmonics to degree 12. Used only to build the data
// file, never by the site. tests/wind.test.js checks it against NOAA's published test values.
const fs = require('fs');
function load(cofPath) {
  const N = 12, mk = () => Array.from({ length: N + 1 }, () => Array(N + 1).fill(0));
  const g = mk(), h = mk(), gd = mk(), hd = mk();
  const lines = fs.readFileSync(cofPath, 'utf8').split(/\r?\n/);
  const epoch = parseFloat(lines[0]);
  for (const l of lines.slice(1)) {
    const p = l.trim().split(/\s+/).map(Number);
    if (p.length < 6 || isNaN(p[0]) || p[0] > 12) continue;
    const [n, m, a, b, c, d] = p; g[n][m] = a; h[n][m] = b; gd[n][m] = c; hd[n][m] = d;
  }
  return { epoch, g, h, gd, hd, N };
}
function declination(M, latDeg, lonDeg, altKm, year) {
  const a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f), Re = 6371.2, N = M.N;
  const phi = latDeg * Math.PI / 180, lam = lonDeg * Math.PI / 180;
  const Rc = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const pp = (Rc + altKm) * Math.cos(phi), zz = (Rc * (1 - e2) + altKm) * Math.sin(phi);
  const r = Math.hypot(pp, zz), phiP = Math.asin(zz / r);
  const ct = Math.sin(phiP), st = Math.cos(phiP), dt = year - M.epoch;
  const P = Array.from({ length: N + 1 }, () => Array(N + 1).fill(0));
  const dP = Array.from({ length: N + 1 }, () => Array(N + 1).fill(0));
  P[0][0] = 1;
  for (let n = 1; n <= N; n++) {
    const k = n === 1 ? 1 : Math.sqrt(1 - 1 / (2 * n));
    P[n][n] = k * st * P[n - 1][n - 1];
    dP[n][n] = k * (st * dP[n - 1][n - 1] + ct * P[n - 1][n - 1]);
    for (let m = 0; m < n; m++) {
      const den = Math.sqrt(n * n - m * m);
      const b = n >= 2 && m <= n - 2 ? Math.sqrt((n - 1) ** 2 - m * m) : 0;
      P[n][m] = ((2 * n - 1) * ct * P[n - 1][m] - (b ? b * P[n - 2][m] : 0)) / den;
      dP[n][m] = ((2 * n - 1) * (ct * dP[n - 1][m] - st * P[n - 1][m]) - (b ? b * dP[n - 2][m] : 0)) / den;
    }
  }
  let Br = 0, Bt = 0, Bp = 0;
  for (let n = 1; n <= N; n++) {
    const q = (Re / r) ** (n + 2);
    for (let m = 0; m <= n; m++) {
      const gt = M.g[n][m] + dt * M.gd[n][m], ht = M.h[n][m] + dt * M.hd[n][m];
      const c = Math.cos(m * lam), s = Math.sin(m * lam);
      Br += (n + 1) * q * (gt * c + ht * s) * P[n][m];
      Bt += -q * (gt * c + ht * s) * dP[n][m];
      Bp += q * m * (gt * s - ht * c) * P[n][m] / st;
    }
  }
  const Xs = -Bt, Ys = Bp, Zs = -Br, psi = phiP - phi;
  const X = Xs * Math.cos(psi) - Zs * Math.sin(psi);
  return Math.atan2(Ys, X) * 180 / Math.PI; // + = East
}
function decimalYear(isoDate) {
  const date = new Date(isoDate + 'T00:00:00Z');
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}
module.exports = { load, declination, decimalYear };
