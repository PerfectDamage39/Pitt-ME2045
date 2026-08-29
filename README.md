# ME 2045 Controls Lab

An interactive teaching and learning tool for **ME 2045 – Linear Control
Systems** at the University of Pittsburgh — a growing collection of
hands-on tools built up over the course of the semester, not a single
fixed demo.

Right now: type in a transfer function (or click a preset) and see its
step/impulse response, performance metrics, pole–zero map, and modal
decomposition update live — or switch to the **Pole-Zero Editor** tab and
build a system by clicking poles and zeros directly onto the s-plane. New
tools get added as the class progresses.

![Typing a new denominator instantly updates the transfer function, response curve, and pole–zero map; switching to the Pole-Zero Editor tab and clicking to place a pole updates them the same way](docs/assets/explorer-demo.gif)

## Features

- Step and impulse response with rise time, settling time, overshoot,
  peak, and steady-state value
- Live pole–zero map and step-response decomposition into individual modes
- Stability classification (stable / marginally stable / unstable)
- Interactive pole-zero editor: click to place poles/zeros, adjust gain,
  and see the derived transfer function and step response instantly
- Light/dark theme, no build step, no external accounts required

## Tutorial: Run It on Your Own Machine

You're encouraged to **fork this repository to your own GitHub account**
and follow along below — this is the best way to keep your own copy,
experiment freely, and (if you want) track your changes with git.

### 1. Fork the repository

Click **Fork** in the top-right corner of this repo's GitHub page, and
fork it into your own account.

### 2. Clone your fork

```bash
git clone https://github.com/<your-username>/Pitt-ME2045.git
cd Pitt-ME2045
```

### 3. Check your Python version

You'll need **Python 3.9 or newer**.

```bash
python3 --version
```

### 4. (Recommended) Create a virtual environment

Keeps this project's dependencies separate from everything else on your
machine.

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
```

### 5. Install dependencies

```bash
pip install -r requirements.txt
```

### 6. Run the app

```bash
python app.py
```

### 7. Open it in your browser

Go to **http://localhost:5000**.

> **macOS note:** if you see "Address already in use," macOS's AirPlay
> Receiver is likely using port 5000. Either turn it off (System
> Settings → General → AirDrop & Handoff), or run on a different port:
> `python -c "from app import app; app.run(port=5050)"` and open
> `http://localhost:5050` instead.

### 8. (Optional) Run the tests

Confirms your setup is working correctly.

```bash
pytest test_app.py -v
```

## Notes

- Numerator/denominator coefficients are entered highest power first,
  comma-separated (e.g. `1, 1, 4` for `s^2 + s + 4`).
- Unstable and marginally-stable systems are simulated over a capped time
  window sized to the system's own dynamics, and performance metrics
  (rise time, settling time, etc.) aren't shown, since they aren't
  well-defined for a response that never settles.

## License

MIT — see [LICENSE](LICENSE). Free to use, fork, and modify for coursework,
teaching, or your own learning.
