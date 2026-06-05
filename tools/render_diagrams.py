"""
Dev-only helper: extract each <figure class="diagram"> from a learn page and
screenshot it with headless Edge so diagrams can be visually verified.
Not part of the site. Usage:
    python tools/render_diagrams.py pages/learn/thunderstorm-life-cycle.html
Outputs PNGs to tools/_diag_preview/.
"""
import os, re, sys, subprocess, tempfile, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(ROOT, "css", "main.css").replace("\\", "/")
OUT = os.path.join(ROOT, "tools", "_diag_preview")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

os.makedirs(OUT, exist_ok=True)

def viewbox_aspect(svg):
    m = re.search(r'viewBox="[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)"', svg)
    if m:
        w, h = float(m.group(1)), float(m.group(2))
        return w, h
    return 680.0, 325.0

def main(page_rel):
    page = os.path.join(ROOT, page_rel)
    with open(page, encoding="utf-8") as f:
        html = f.read()
    figs = re.findall(r'<figure class="diagram">.*?</figure>', html, re.DOTALL)
    base = os.path.splitext(os.path.basename(page))[0]
    print(f"{base}: {len(figs)} diagram(s)")
    W = 760
    for i, fig in enumerate(figs, 1):
        svg = re.search(r'<svg.*?</svg>', fig, re.DOTALL)
        vbw, vbh = viewbox_aspect(svg.group(0) if svg else "")
        H = math.ceil(W * vbh / vbw) + 150
        harness = (
            f'<!doctype html><html><head><meta charset="utf-8">'
            f'<link rel="stylesheet" href="file:///{CSS}">'
            f'<style>body{{margin:0;padding:14px;background:#f4ecd6}}'
            f'.diagram{{margin:0}}</style></head><body>{fig}</body></html>'
        )
        tmp = os.path.join(tempfile.gettempdir(), f"_diag_{base}_{i}.html")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(harness)
        out_png = os.path.join(OUT, f"{base}_{i}.png")
        subprocess.run([
            EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--force-device-scale-factor=2", f"--window-size={W},{H}",
            f"--screenshot={out_png}", f"file:///{tmp.replace(chr(92),'/')}"
        ], check=True, capture_output=True)
        print("  ->", out_png)

if __name__ == "__main__":
    for arg in sys.argv[1:]:
        main(arg)
