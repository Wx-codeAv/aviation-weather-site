#!/usr/bin/env python3
"""
generate_skewt.py — render the WX 301 teaching Skew-T for the CrosswindWX site.

Builds a synthetic, thermodynamically self-consistent atmospheric sounding
designed to land its surface-parcel LCL/LFC/EL at the textbook pressures from
the WX 301 example problem:

    LCL = 860 mb        (cumulus base)
    LFC = 700 mb        (free convection begins)
    EL  = 130 mb        (anvil top)

The original WX 301 problem also stated surface T = 26 °C and surface dew
point = 22 °C.  Those two numbers are not self-consistent: a 4 °C dew point
spread puts the LCL near 950 mb, not 860 mb.  To preserve the textbook
LCL/LFC/EL pressures (which are what students see and what the diagram is
teaching), this script keeps T_sfc = 26 °C and *derives* the surface dew
point that yields LCL = 860 mb exactly: Td_sfc ≈ 15.74 °C.  This is
documented in reference/skewt-generation.md.

The environmental temperature profile is then anchored to intersect the
moist-adiabat parcel path at 700 mb (LFC) and 130 mb (EL), with the parcel
warmer than the environment between them (CAPE) and cooler outside (CIN
below LFC, parcel-cooler-than-env above EL).

Output: assets/skewt/wx301-example.svg (vector, scales cleanly in browsers).

Usage (from the tools/ directory, with .venv activated):
    python generate_skewt.py
"""
from __future__ import annotations

import argparse
import os
import sys
import warnings
from datetime import datetime

warnings.filterwarnings("ignore")

import numpy as np
import matplotlib

matplotlib.use("Agg")  # headless backend — no display required

import matplotlib.pyplot as plt
import matplotlib.transforms as transforms
from matplotlib.ticker import ScalarFormatter, MultipleLocator

# Side-effect import: registers the 'skewx' matplotlib projection
import sharppy.plot.skew as _skewmod  # noqa: F401
import sharppy.sharptab.thermo as thermo
import sharppy.sharptab.profile as sb_profile

# matplotlib 3.7+ removed the `label` argument from `Tick.__init__` entirely,
# but SHARPpy's `SkewXAxis._get_tick` still passes a positional empty-string
# label. Patch the method to call SkewXTick without it.
def _patched_get_tick(self, major):
    return _skewmod.SkewXTick(self.axes, None, major=major)
_skewmod.SkewXAxis._get_tick = _patched_get_tick


# ---------- WX 301 problem targets ----------
P_SFC = 1000.0
T_SFC = 26.0
P_LCL_TARGET = 860.0
P_LFC_TARGET = 700.0
P_EL_TARGET = 130.0

# ---------- Site palette (sectional-chart aesthetic) ----------
BUFF = "#fffaf0"
INK = "#0c2541"
INK_SOFT = "#2d4360"
RUST = "#b53d1f"
SAGE = "#3a8a3a"
SKY = "#4a7ba6"
SUN = "#d9a521"
RULE = "#b9a87a"


# ---------- Synthetic profile construction ----------

def solve_td_for_lcl(t_sfc: float, p_sfc: float, p_lcl_target: float) -> float:
    """Binary-search the surface dew point that yields a given LCL pressure."""
    def lcl_pres(td: float) -> float:
        t_lcl = thermo.lcltemp(t_sfc, td)
        theta_sfc = thermo.theta(p_sfc, t_sfc)
        return thermo.thalvl(theta_sfc, t_lcl)
    # Higher Td → moister parcel → LCL lower in altitude → higher pressure
    lo, hi = -20.0, t_sfc - 0.01
    for _ in range(80):
        mid = (lo + hi) / 2.0
        if lcl_pres(mid) < p_lcl_target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def std_atm_height_m(p_mb: float) -> float:
    """ICAO standard-atmosphere height (m) from pressure (mb). Good enough for
    SHARPpy's profile machinery; we don't need cm-accurate altimetry here."""
    p0 = 1013.25
    if p_mb >= 226.32:  # troposphere
        return 44330.77 * (1.0 - (p_mb / p0) ** 0.190263)
    # lower stratosphere: 11–20 km isothermal slab
    return 11000.0 + 6341.6 * np.log(226.32 / p_mb)


def parcel_path(t_sfc: float, td_sfc: float, p_sfc: float,
                p_lcl: float, t_lcl: float, p_top: float = 100.0):
    """Return (pres, temp) of the surface parcel at fine resolution.

    Below the LCL the parcel rises along its dry adiabat (constant potential
    temperature). At the LCL it kinks; above the LCL it rises along the moist
    adiabat starting from (p_lcl, t_lcl). We return parcel TEMPERATURE — not
    virtual temperature — because that's what students read on a Skew-T."""
    KAPPA = 0.2854  # R_d / cp_d for dry air
    theta_sfc_K = (t_sfc + 273.15) * (1000.0 / p_sfc) ** KAPPA  # in Kelvin
    # Dry-adiabat section: surface up to LCL (50 levels for a smooth curve)
    p_dry = np.linspace(p_sfc, p_lcl, 50)
    t_dry = theta_sfc_K * (p_dry / 1000.0) ** KAPPA - 273.15
    # Moist-adiabat section: LCL up past EL (80 levels, starts at LCL)
    p_moist = np.linspace(p_lcl, p_top, 80)
    t_moist = np.array([thermo.wetlift(p_lcl, t_lcl, float(p)) for p in p_moist])
    pres = np.concatenate([p_dry, p_moist[1:]])
    temp = np.concatenate([t_dry, t_moist[1:]])
    return pres, temp


def build_profile():
    """Construct a SHARPpy convective Profile that hits the WX 301 targets."""
    td_sfc = solve_td_for_lcl(T_SFC, P_SFC, P_LCL_TARGET)
    t_lcl = thermo.lcltemp(T_SFC, td_sfc)

    # Parcel temperature along the moist adiabat from LCL
    def t_parcel(p):
        return thermo.wetlift(P_LCL_TARGET, t_lcl, p)

    # Environmental temperature anchors.  Below LFC: env warmer than parcel
    # (CIN region).  Between LFC and EL: env cooler than parcel (CAPE region).
    # Above EL: env warmer than parcel.  At 700 and 130 mb, env == parcel.
    env_anchors = [
        # (pressure_mb, T_env_C, Td_env_C)
        (1000.0, T_SFC,                  td_sfc),
        ( 950.0, 23.0,                   14.5),
        ( 900.0, 19.5,                   12.5),
        ( 860.0, 15.5,                   11.0),  # just above parcel LCL temp 13.38
        ( 800.0, 12.0,                    6.0),  # parcel here is 10.56 — small cap (CIN layer)
        ( 700.0, t_parcel(700.0) + 1.0,  -8.0),  # LFC anchor: small bump above parcel-T offsets
                                                  # virtual-temperature effect (saturated parcel
                                                  # has higher Tv than its T-line; env is drier
                                                  # so its Tv rise is smaller — Tv crossover sits
                                                  # ~1°C above parcel-T crossover at this level)
                                                  # virtual-temperature effect (parcel saturated,
                                                  # env drier, so Tv_parcel > Tv_env at parcel-T match;
                                                  # the env T-curve sits slightly above the parcel
                                                  # path here even though Tv crossover is exactly at 700)
        ( 600.0, t_parcel(600.0) - 2.5, -22.0),  # CAPE
        ( 500.0, t_parcel(500.0) - 3.5, -32.0),
        ( 400.0, t_parcel(400.0) - 4.0, -45.0),
        ( 300.0, t_parcel(300.0) - 4.0, -58.0),
        ( 200.0, t_parcel(200.0) - 3.0, -75.0),
        ( 130.0, t_parcel(130.0),       -95.0),  # EL: env == parcel
        ( 100.0, t_parcel(100.0) + 6.0, -90.0),  # above EL: env warmer
    ]

    pres = np.array([a[0] for a in env_anchors])
    tmpc = np.array([a[1] for a in env_anchors])
    dwpc = np.array([a[2] for a in env_anchors])
    hght = np.array([std_atm_height_m(p) for p in pres])

    # Generic veering-with-height wind for visual realism. Doesn't drive the
    # parcel calculation but SHARPpy expects the columns.
    wdir = np.array([180.0, 195.0, 210.0, 220.0, 230.0,
                     245.0, 255.0, 260.0, 265.0, 270.0,
                     270.0, 270.0, 270.0])
    wspd = np.array([10.0, 15.0, 20.0, 25.0, 30.0,
                     40.0, 50.0, 60.0, 65.0, 70.0,
                     75.0, 60.0, 50.0])

    prof = sb_profile.create_profile(
        profile="convective",
        pres=pres, hght=hght, tmpc=tmpc, dwpc=dwpc,
        wspd=wspd, wdir=wdir,
        strictQC=False,
        date=datetime(2024, 6, 15, 18, 0),
        location="WX 301 example",
    )
    return prof, td_sfc


# ---------- Plotting ----------

def _label_at_pressure(ax, label: str, pres_mb: float, *, color=INK):
    if pres_mb is None or np.ma.is_masked(pres_mb) or not np.isfinite(pres_mb):
        return
    trans = transforms.blended_transform_factory(ax.transAxes, ax.transData)
    ax.plot([0.0, 1.0], [pres_mb, pres_mb], transform=trans,
            color=color, lw=0.7, ls=":", alpha=0.55, zorder=3)
    ax.text(0.985, pres_mb, label, transform=trans,
            ha="right", va="center",
            fontsize=10, fontweight="bold", color=color,
            bbox=dict(boxstyle="round,pad=0.25", fc=BUFF, ec=color, lw=0.6, alpha=0.94),
            zorder=10)


def plot_skewt(prof, output_path: str, td_sfc: float):
    """Render the Skew-T to ``output_path`` (extension chooses format)."""
    fig = plt.figure(figsize=(8.5, 9.5), facecolor=BUFF)
    ax = fig.add_subplot(1, 1, 1, projection="skewx")
    ax.set_facecolor("#fffefa")

    title = "WX 301 example sounding   ·   surface-based parcel"
    ax.set_title(title, fontsize=12.5, color=INK, pad=12, fontweight="bold")

    tmask = ~prof.tmpc.mask
    dmask = ~prof.dwpc.mask

    # Icing-zone reference lines: 0°C and -20°C
    ax.axvline(0,   color=SKY, ls="--", lw=0.9, alpha=0.55, zorder=2)
    ax.axvline(-20, color=SKY, ls="--", lw=0.9, alpha=0.55, zorder=2)

    # Environmental traces
    ax.semilogy(prof.tmpc[tmask], prof.pres[tmask],
                color=RUST, lw=2.4, zorder=6, label="Temperature")
    ax.semilogy(prof.dwpc[dmask], prof.pres[dmask],
                color=SAGE, lw=2.4, zorder=6, label="Dew point")

    # Surface parcel trace — computed at fine resolution so the DALR-to-MALR
    # kink at the LCL is visible. SHARPpy's sfcpcl.ttrace stores virtual
    # temperature at sounding levels only; we want parcel T at every level so
    # the curve renders smoothly.
    sfcpcl = prof.sfcpcl
    p_lcl = float(sfcpcl.lclpres)
    t_lcl = thermo.lcltemp(T_SFC, td_sfc)
    parcel_p, parcel_t = parcel_path(T_SFC, td_sfc, P_SFC, p_lcl, t_lcl)
    ax.semilogy(parcel_t, parcel_p,
                color=INK, lw=1.8, ls=(0, (5, 4)),
                zorder=5, label="Parcel path (surface)")

    # CAPE shading between LFC and EL, using the dense parcel trace.
    try:
        lfc_p = float(sfcpcl.lfcpres)
        el_p = float(sfcpcl.elpres)
        mask = (parcel_p <= lfc_p) & (parcel_p >= el_p)
        if mask.any():
            shade_p = parcel_p[mask]
            shade_t = parcel_t[mask]
            env_p = np.asarray(prof.pres[tmask])
            env_t = np.asarray(prof.tmpc[tmask])
            order = np.argsort(env_p)
            env_at_parcel = np.interp(np.log(shade_p),
                                      np.log(env_p[order]),
                                      env_t[order])
            ax.fill_betweenx(shade_p, env_at_parcel, shade_t,
                             where=(shade_t > env_at_parcel),
                             facecolor=SUN, alpha=0.22, zorder=4,
                             label="CAPE")
    except Exception as exc:
        print(f"warn: CAPE shading skipped: {exc}", file=sys.stderr)

    _label_at_pressure(ax, f"LCL  ·  {int(round(float(sfcpcl.lclpres)))} mb", sfcpcl.lclpres)
    _label_at_pressure(ax, f"LFC  ·  {int(round(float(sfcpcl.lfcpres)))} mb", sfcpcl.lfcpres)
    _label_at_pressure(ax, f"EL  ·  {int(round(float(sfcpcl.elpres)))} mb",   sfcpcl.elpres)

    # Axis cosmetics
    ax.yaxis.set_major_formatter(ScalarFormatter())
    ax.set_yticks(np.linspace(100, 1000, 10))
    ax.set_ylim(1050, 100)
    ax.xaxis.set_major_locator(MultipleLocator(10))
    ax.set_xlim(-50, 50)
    ax.grid(True, color=RULE, alpha=0.4, lw=0.5)
    ax.tick_params(axis="both", which="both", colors=INK_SOFT, labelsize=10)
    ax.set_xlabel("Temperature (°C)", color=INK, fontsize=11, fontweight="bold")
    ax.set_ylabel("Pressure (mb)", color=INK, fontsize=11, fontweight="bold")
    for spine in ax.spines.values():
        spine.set_color(INK)
        spine.set_linewidth(0.8)

    leg = ax.legend(loc="lower left", frameon=True, fontsize=9.5,
                    facecolor=BUFF, edgecolor=RULE, framealpha=0.95)
    for text in leg.get_texts():
        text.set_color(INK)

    # Footer note documenting the derived dew point
    fig.text(0.5, 0.01,
             f"Surface T = {T_SFC:.0f} °C, surface Td = {td_sfc:.1f} °C "
             f"(derived to place LCL at {P_LCL_TARGET:.0f} mb)",
             ha="center", color=INK_SOFT, fontsize=9, style="italic")

    fig.tight_layout(rect=(0, 0.025, 1, 1))
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    fig.savefig(output_path, bbox_inches="tight", facecolor=BUFF)
    plt.close(fig)
    print(f"Wrote {output_path}")


def verify_targets(prof, tolerance_mb: float = 8.0) -> None:
    """Fail loudly if the synthesized profile drifted off the WX 301 targets.
    Tolerance is generous (±8 mb) because SHARPpy resolves LFC/EL on a coarse
    moist-adiabat lift table and snaps to nearby sounding levels."""
    pcl = prof.sfcpcl
    targets = {
        "LCL": (float(pcl.lclpres), P_LCL_TARGET),
        "LFC": (float(pcl.lfcpres), P_LFC_TARGET),
        "EL":  (float(pcl.elpres),  P_EL_TARGET),
    }
    print("\n=== Surface parcel — verification ===")
    drifted = []
    for name, (got, want) in targets.items():
        delta = got - want
        flag = "  OK  " if abs(delta) <= tolerance_mb else " DRIFT"
        print(f"  {name:>3}: got {got:7.2f} mb   target {want:7.2f} mb   Δ {delta:+6.2f} mb  [{flag}]")
        if abs(delta) > tolerance_mb:
            drifted.append((name, got, want, delta))
    print(f"  CAPE: {float(pcl.bplus):.0f} J/kg    CIN: {float(pcl.bminus):.0f} J/kg")
    if drifted:
        msg = "; ".join(f"{n} off by {d:+.1f} mb (got {g:.1f}, want {w:.1f})"
                        for n, g, w, d in drifted)
        raise SystemExit(f"ERROR: profile drifted off targets: {msg}")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="Generate the WX 301 teaching Skew-T")
    parser.add_argument(
        "--out",
        default=os.path.join(here, "..", "assets", "skewt", "wx301-example.svg"),
        help="Output image path. Extension picks format (.svg recommended, .png also fine).",
    )
    args = parser.parse_args()

    # Force UTF-8 stdout so degree signs and deltas don't choke cp1252.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    prof, td_sfc = build_profile()
    print(f"Derived surface Td = {td_sfc:.3f} °C  (T_sfc = {T_SFC:.1f} °C, target LCL = {P_LCL_TARGET:.0f} mb)")
    verify_targets(prof)
    plot_skewt(prof, args.out, td_sfc)


if __name__ == "__main__":
    main()
