"""
app.py
======
Flask API backend for the Microgrid RL Dashboard.
Serves the frontend and exposes REST endpoints for simulation data.

Run:
    python frontend/app.py
    # or from repo root:
    python -m frontend.app

Then open: http://localhost:5000
"""

import sys
import os
import json
import time
import math

# Make sure parent dir is on path (so microgrid_env is importable)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import numpy as np

from microgrid_env import MicrogridEnv
from rule_based_ems import RuleBasedEMS

# ── Optional: load trained RL model if it exists ──────────────────────── #
RL_MODEL = None
try:
    from stable_baselines3 import DQN
    model_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "dqn_microgrid"
    )
    if os.path.exists(model_path + ".zip"):
        RL_MODEL = DQN.load(model_path)
        print(f"[✓] DQN model loaded from {model_path}.zip")
    else:
        print("[!] No trained model found — RL Agent tab will use rule-based fallback.")
except ImportError:
    print("[!] stable_baselines3 not installed — RL Agent unavailable.")

# ──────────────────────────────────────────────────────────────────────── #

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))
ACTION_LABELS = ["CHARGE", "DISCHARGE", "IDLE", "GRID_CHARGE"]
ACTION_COLORS = ["#3498db", "#e74c3c", "#2ecc71", "#9b59b6"]


# ── Helpers ────────────────────────────────────────────────────────────── #

def run_simulation(controller_type="rule", seed=42, episode_length=168):
    """Run a full episode and return the history + summary."""
    env = MicrogridEnv(episode_length=episode_length, seed=seed)
    obs, _ = env.reset()
    done = False

    if controller_type == "rule":
        ctrl = RuleBasedEMS()
        while not done:
            action = ctrl.select_action(obs)
            obs, _, done, _, _ = env.step(action)
    elif controller_type == "rl" and RL_MODEL is not None:
        while not done:
            action, _ = RL_MODEL.predict(obs, deterministic=True)
            obs, _, done, _, _ = env.step(int(action))
    else:
        # Random fallback
        while not done:
            action = env.action_space.sample()
            obs, _, done, _, _ = env.step(action)

    return env.history, env.summary()


def simulate_step(hour, soc=0.5, seed=None):
    """Return a single-hour snapshot (for live mode)."""
    rng = np.random.default_rng(seed if seed else int(time.time()))
    env = MicrogridEnv(episode_length=1, seed=int(rng.integers(0, 9999)))
    env._battery_soc = soc
    env._current_hour = hour % 24
    obs = env._build_obs()

    ctrl = RuleBasedEMS()
    if RL_MODEL is not None:
        action, _ = RL_MODEL.predict(obs, deterministic=True)
        action = int(action)
    else:
        action = ctrl.select_action(obs)

    obs2, reward, _, _, info = env.step(action)
    r = env.history[-1]
    return {
        "hour": r["hour"],
        "pv_w": round(r["pv_w"], 1),
        "load_w": round(r["load_w"], 1),
        "soc": round(r["soc"] * 100, 1),
        "grid_w": round(r["grid_w"], 1),
        "solar_used_w": round(r["solar_used_w"], 1),
        "action": ACTION_LABELS[r["action"]],
        "action_id": r["action"],
        "price": r["price"],
        "grid_cost": round(r["grid_cost"], 5),
        "reward": round(r["reward"], 4),
    }


# ── Routes ─────────────────────────────────────────────────────────────── #

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory(os.path.join(FRONTEND_DIR, "static"), path)


# ── API: Full episode simulation ─────────────────────────────────────────

@app.route("/api/simulate", methods=["GET"])
def api_simulate():
    """Run a full 168-hour (1 week) episode for rule-based or RL controller."""
    controller = request.args.get("controller", "rule")  # "rule" | "rl"
    seed = int(request.args.get("seed", 42))
    episode_length = int(request.args.get("length", 168))

    history, summary = run_simulation(controller, seed=seed, episode_length=episode_length)

    # Serialise
    rows = []
    for r in history:
        rows.append({
            "step": r["step"],
            "hour": r["hour"],
            "pv_w": round(r["pv_w"], 1),
            "load_w": round(r["load_w"], 1),
            "soc": round(r["soc"] * 100, 1),
            "grid_w": round(r["grid_w"], 1),
            "solar_used_w": round(r["solar_used_w"], 1),
            "action": ACTION_LABELS[r["action"]],
            "action_id": r["action"],
            "price": r["price"],
            "grid_cost": round(r["grid_cost"], 5),
            "reward": round(r["reward"], 4),
        })

    return jsonify({
        "controller": controller,
        "seed": seed,
        "episode_length": episode_length,
        "history": rows,
        "summary": summary,
        "has_rl_model": RL_MODEL is not None,
    })


# ── API: Compare rule-based vs RL ───────────────────────────────────────

@app.route("/api/compare", methods=["GET"])
def api_compare():
    """Run both controllers on the same seed and return both histories."""
    seed = int(request.args.get("seed", 42))
    episode_length = int(request.args.get("length", 168))

    rb_history, rb_summary = run_simulation("rule", seed=seed, episode_length=episode_length)
    rl_history, rl_summary = run_simulation("rl",   seed=seed, episode_length=episode_length)

    def serialise(history):
        return [{
            "step": r["step"],
            "hour": r["hour"],
            "pv_w": round(r["pv_w"], 1),
            "load_w": round(r["load_w"], 1),
            "soc": round(r["soc"] * 100, 1),
            "grid_w": round(r["grid_w"], 1),
            "solar_used_w": round(r["solar_used_w"], 1),
            "action": ACTION_LABELS[r["action"]],
            "action_id": r["action"],
            "price": r["price"],
            "grid_cost": round(r["grid_cost"], 5),
            "reward": round(r["reward"], 4),
        } for r in history]

    return jsonify({
        "seed": seed,
        "rule_based": {"history": serialise(rb_history), "summary": rb_summary},
        "rl_agent":   {"history": serialise(rl_history), "summary": rl_summary},
        "has_rl_model": RL_MODEL is not None,
    })


# ── API: Live single-step snapshot ──────────────────────────────────────

@app.route("/api/live", methods=["GET"])
def api_live():
    """Return current-hour snapshot (for real-time ticker)."""
    hour = int(request.args.get("hour", int(time.strftime("%H"))))
    soc  = float(request.args.get("soc", 0.5))
    return jsonify(simulate_step(hour, soc))


# ── API: Environment constants ──────────────────────────────────────────

@app.route("/api/info", methods=["GET"])
def api_info():
    return jsonify({
        "battery_capacity_wh": MicrogridEnv.BATTERY_CAPACITY_WH,
        "battery_max_power_w": MicrogridEnv.BATTERY_MAX_POWER_W,
        "battery_efficiency":  MicrogridEnv.BATTERY_EFFICIENCY,
        "pv_max_w":            MicrogridEnv.PV_MAX_W,
        "load_min_w":          MicrogridEnv.LOAD_MIN_W,
        "load_max_w":          MicrogridEnv.LOAD_MAX_W,
        "grid_peak_price":     MicrogridEnv.GRID_PEAK_PRICE,
        "grid_offpeak_price":  MicrogridEnv.GRID_OFFPEAK_PRICE,
        "soc_min":             MicrogridEnv.SOC_MIN,
        "soc_max":             MicrogridEnv.SOC_MAX,
        "action_labels":       ACTION_LABELS,
        "action_colors":       ACTION_COLORS,
        "has_rl_model":        RL_MODEL is not None,
    })


# ── API: Multi-episode metrics ───────────────────────────────────────────

@app.route("/api/metrics", methods=["GET"])
def api_metrics():
    """Run N episodes for both controllers and return aggregate metrics."""
    n = int(request.args.get("n", 5))
    episode_length = int(request.args.get("length", 168))

    rb_costs, rb_sscs, rb_rewards = [], [], []
    rl_costs, rl_sscs, rl_rewards = [], [], []

    for i in range(n):
        rh, rs = run_simulation("rule", seed=i * 7, episode_length=episode_length)
        rb_costs.append(rs["total_grid_cost_$"])
        rb_sscs.append(rs["solar_self_consumption_%"])
        rb_rewards.append(sum(r["reward"] for r in rh))

        lh, ls = run_simulation("rl", seed=i * 7, episode_length=episode_length)
        rl_costs.append(ls["total_grid_cost_$"])
        rl_sscs.append(ls["solar_self_consumption_%"])
        rl_rewards.append(sum(r["reward"] for r in lh))

    def stats(vals):
        arr = np.array(vals)
        return {"mean": round(float(arr.mean()), 4),
                "std":  round(float(arr.std()),  4),
                "min":  round(float(arr.min()),  4),
                "max":  round(float(arr.max()),  4),
                "all":  [round(v, 4) for v in vals]}

    return jsonify({
        "n_episodes": n,
        "rule_based": {
            "grid_cost": stats(rb_costs),
            "solar_ssc": stats(rb_sscs),
            "reward":    stats(rb_rewards),
        },
        "rl_agent": {
            "grid_cost": stats(rl_costs),
            "solar_ssc": stats(rl_sscs),
            "reward":    stats(rl_rewards),
        },
        "has_rl_model": RL_MODEL is not None,
    })


# ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 55)
    print("  Microgrid RL Dashboard — Flask API")
    print("=" * 55)
    print("  Open: http://localhost:5000")
    print("  RL model:", "LOADED ✓" if RL_MODEL else "NOT FOUND (rule-based mode)")
    print("=" * 55 + "\n")
    app.run(debug=True, host="0.0.0.0", port=5000)
