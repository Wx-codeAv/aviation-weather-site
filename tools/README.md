# tools/

Local-only build scripts. Not deployed with the site — they generate static
assets (currently: Skew-T diagrams) that get committed into `assets/`.

## What's here

| File                    | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `generate_skewt.py`     | Render a Skew-T diagram from an SPC sounding using SHARPpy. |
| `requirements.txt`      | Python dependencies for the scripts.                        |
| `data/14061619.OAX`     | Bundled example sounding — Omaha, NE, 2014-06-16 19Z.       |

## One-time setup

You only do this once per machine.

### 1. Install Python

If you don't have Python yet, install **Python 3.11+** from the
**Microsoft Store** (search "Python 3.13", click *Get*) or from
[python.org](https://www.python.org/downloads/). The Microsoft Store version
is the simplest path — it self-contains and adds itself to PATH automatically.

Verify in a fresh terminal:

```bash
python --version
```

You should see `Python 3.11.x`, `3.12.x`, or `3.13.x`.

### 2. Create a virtual environment

From the project root:

```bash
cd tools
python -m venv .venv
```

This creates a self-contained Python install inside `tools/.venv/`.
The `.venv/` directory is gitignored.

### 3. Activate the venv and install dependencies

**Git Bash / WSL:**

```bash
source .venv/Scripts/activate
pip install --upgrade pip
pip install -r requirements.txt
```

**PowerShell:**

```powershell
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

The first install pulls SHARPpy from GitHub, plus NumPy and matplotlib.
Expect 1–3 minutes and ~150 MB of disk usage.

If PowerShell blocks the activation script with an execution policy error,
run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Running the script

With the venv active:

```bash
python generate_skewt.py
```

Output: `../assets/skewt/example-sounding.png` (and a printout of the
calculated CAPE / CIN / LCL / LFC / EL values for the figure caption).

To use a different sounding file:

```bash
python generate_skewt.py --sounding data/your-sounding.OAX --out ../assets/skewt/your-sounding.png
```

## When to re-run this

- You changed the bundled sounding file
- You want a new example for a different teaching case
- SHARPpy got an update and the rendering improved

The generated PNG is committed into the repo, so end users (and GitHub Pages)
never run any Python — they just see the image.

## Adding a new sounding

1. Drop an SPC-format sounding text file into `data/`.
2. Run `python generate_skewt.py --sounding data/your-file --out ../assets/skewt/your-file.png`.
3. Reference the new image from the relevant Learn page.

You can grab real soundings from
[University of Wyoming sounding archive](https://weather.uwyo.edu/upperair/sounding.html)
in "Text: Raw data" format. SHARPpy reads the SPC format directly; for Wyoming
soundings you may need to wrap the data in `%TITLE% / %RAW% / %END%` markers
matching the OAX example file.

## Credits

Plotting code adapted from
[`sharppy/SHARPpy` examples/plot_sounding.py](https://github.com/sharppy/SHARPpy/blob/main/examples/plot_sounding.py)
(BSD license).
