class TemperatureGaugeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._dragging = false;
  }

  // ---- Configuration ----
  setConfig(config) {
    if (!config.entity) {
      throw new Error("Il faut définir 'entity' (le capteur de température)");
    }
    if (!config.target_entity) {
      throw new Error("Il faut définir 'target_entity' (l'input_number cible)");
    }
    this.config = {
      name: "Température",
      min: 0,
      max: 30,
      threshold: 20,
      step: 0.1,
      colors: {
        cold: "#2196F3",
        hot: "#F44336",
        track: "#333333",
        target_dot: "#FFFFFF",
        target_dot_border: "#888888",
        text: "#FFFFFF",
        label: "#AAAAAA",
        btn_bg: "#333333",
        reset_bg: "#222222",
      },
      ...config,
      colors: { ...{
        cold: "#2196F3",
        hot: "#F44336",
        track: "#333333",
        target_dot: "#FFFFFF",
        target_dot_border: "#888888",
        text: "#FFFFFF",
        label: "#AAAAAA",
        btn_bg: "#333333",
        reset_bg: "#222222",
      }, ...(config.colors || {}) },
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() {
    return 4;
  }

  // ---- Rendu initial (structure fixe, une seule fois) ----
  _render() {
    const c = this.config;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          height: 280px;
          background: transparent;
          box-shadow: none;
          border: none;
          position: relative;
        }
        .name {
          position: absolute;
          bottom: 8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 24px;
          font-weight: 500;
          color: ${c.colors.text};
        }
        .gauge-wrap {
          position: absolute;
          width: 190px;
          height: 190px;
          left: 50%;
          top: 40%;
          transform: translate(-50%, -50%);
        }
        .value {
          position: absolute;
          left: 50%;
          top: 38%;
          transform: translate(-50%, -50%);
          font-size: 32px;
          font-weight: bold;
          color: ${c.colors.text};
          pointer-events: none;
        }
        .target-label {
          position: absolute;
          left: 50%;
          top: 52%;
          transform: translateX(-50%);
          font-size: 14px;
          color: ${c.colors.label};
          pointer-events: none;
        }
        .target-dot {
          cursor: grab;
          touch-action: none;
        }
        .target-dot:active {
          cursor: grabbing;
        }
        .controls {
          position: absolute;
          bottom: 40px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 40px;
        }
        .btn {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: ${c.colors.btn_bg};
          border: none;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
        }
        .btn.reset {
          width: 40px;
          height: 40px;
          background: ${c.colors.reset_bg};
          color: ${c.colors.label};
        }
        .btn ha-icon {
          --mdc-icon-size: 26px;
        }
        .btn.reset ha-icon {
          --mdc-icon-size: 20px;
        }
      </style>
      <ha-card>
        <div class="gauge-wrap">
          <svg width="190" height="190" viewBox="0 0 190 190">
            <circle class="track" cx="95" cy="95" r="80" fill="none"
              stroke="${c.colors.track}" stroke-width="12"
              stroke-dasharray="${2 * Math.PI * 80 * 0.75} ${2 * Math.PI * 80}"
              transform="rotate(135 95 95)" />
            <circle class="blue-arc" cx="95" cy="95" r="80" fill="none"
              stroke="${c.colors.cold}" stroke-width="12" stroke-linecap="round"
              transform="rotate(135 95 95)" />
            <circle class="red-arc" cx="95" cy="95" r="80" fill="none"
              stroke="${c.colors.hot}" stroke-width="12" stroke-linecap="round" />
            <circle class="target-dot" cx="95" cy="95" r="9"
              fill="${c.colors.target_dot}" stroke="${c.colors.target_dot_border}" stroke-width="2" />
            <circle class="value-dot" cx="95" cy="95" r="9"
              fill="${c.colors.cold}" stroke="white" stroke-width="3" />
          </svg>
        </div>
        <div class="value"></div>
        <div class="target-label"></div>
        <div class="name">${c.name}</div>
        <div class="controls">
          <button class="btn minus"><ha-icon icon="mdi:minus"></ha-icon></button>
          <button class="btn reset"><ha-icon icon="mdi:leaf"></ha-icon></button>
          <button class="btn plus"><ha-icon icon="mdi:plus"></ha-icon></button>
        </div>
      </ha-card>
    `;

    this._els = {
      blueArc: this.shadowRoot.querySelector(".blue-arc"),
      redArc: this.shadowRoot.querySelector(".red-arc"),
      targetDot: this.shadowRoot.querySelector(".target-dot"),
      valueDot: this.shadowRoot.querySelector(".value-dot"),
      valueText: this.shadowRoot.querySelector(".value"),
      targetLabel: this.shadowRoot.querySelector(".target-label"),
      svg: this.shadowRoot.querySelector("svg"),
    };

    this.shadowRoot.querySelector(".minus").addEventListener("click", () => this._step(-1));
    this.shadowRoot.querySelector(".plus").addEventListener("click", () => this._step(1));
    this.shadowRoot.querySelector(".reset").addEventListener("click", () => this._reset());

    this._els.targetDot.addEventListener("pointerdown", (e) => this._onDragStart(e));
  }

  // ---- Mise à jour à chaque changement d'état ----
  _update() {
    if (!this._hass || !this.config || this._dragging) return;
    const c = this.config;
    const stateObj = this._hass.states[this.config.entity];
    const targetObj = this._hass.states[this.config.target_entity];
    if (!stateObj) return;

    const value = Number(stateObj.state);
    const target = targetObj ? Number(targetObj.state) : null;

    this._paint(value, target);
  }

  _paint(value, target) {
    const c = this.config;
    const min = c.min, max = c.max, threshold = c.threshold;
    const radius = 80;
    const circumference = 2 * Math.PI * radius;
    const arc = circumference * 0.75;

    const percent = this._clampPercent(value, min, max);
    const thresholdPercent = this._clampPercent(threshold, min, max);
    const color = value >= threshold ? c.colors.hot : c.colors.cold;

    const bluePercent = Math.min(percent, thresholdPercent);
    const blueArcLen = arc * (bluePercent / 100);
    this._els.blueArc.setAttribute("stroke-dasharray", `${blueArcLen} ${circumference}`);

    if (percent > thresholdPercent) {
      const redPercent = percent - thresholdPercent;
      const redArcLen = arc * (redPercent / 100);
      const startAngle = 135 + thresholdPercent * 2.7;
      this._els.redArc.setAttribute("stroke-dasharray", `${redArcLen} ${circumference}`);
      this._els.redArc.setAttribute("transform", `rotate(${startAngle} 95 95)`);
      this._els.redArc.style.display = "";
    } else {
      this._els.redArc.style.display = "none";
    }

    const { x: dotX, y: dotY } = this._pointAt(percent, radius);
    this._els.valueDot.setAttribute("cx", dotX);
    this._els.valueDot.setAttribute("cy", dotY);
    this._els.valueDot.setAttribute("fill", color);

    if (target !== null && !isNaN(target)) {
      const targetPercent = this._clampPercent(target, min, max);
      const { x: tx, y: ty } = this._pointAt(targetPercent, radius);
      this._els.targetDot.setAttribute("cx", tx);
      this._els.targetDot.setAttribute("cy", ty);
      this._els.targetDot.style.display = "";
      this._els.targetLabel.textContent = ` ${target.toFixed(1)}°C`;
    } else {
      this._els.targetDot.style.display = "none";
      this._els.targetLabel.textContent = " —";
    }

    this._els.valueText.textContent = isNaN(value) ? "—" : `${value.toFixed(1)}°C`;
  }

  _clampPercent(v, min, max) {
    return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  }

  _pointAt(percent, radius) {
    const angle = 135 + percent * 2.7;
    const rad = (angle * Math.PI) / 180;
    return { x: 95 + radius * Math.cos(rad), y: 95 + radius * Math.sin(rad) };
  }

  // ---- Boutons +/- et reset ----
  _step(direction) {
    if (!this._hass) return;
    const service = direction > 0 ? "increment" : "decrement";
    this._hass.callService("input_number", service, {
      entity_id: this.config.target_entity,
    });
  }

  _reset() {
    if (!this._hass) return;
    const value = this.config.reset_value !== undefined ? this.config.reset_value : this.config.threshold;
    this._hass.callService("input_number", "set_value", {
      entity_id: this.config.target_entity,
      value: value,
    });
  }

  // ---- Glisser-déposer natif (pointer events, fiable) ----
  _onDragStart(evt) {
    evt.preventDefault();
    this._dragging = true;
    const dot = this._els.targetDot;
    dot.setPointerCapture(evt.pointerId);
    this._lastDragValue = null;

    const onMove = (e) => {
      const rect = this._els.svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const scaleX = 190 / rect.width;
      const scaleY = 190 / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const dx = x - 95;
      const dy = y - 95;
      let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (ang < 0) ang += 360;
      let rel = ang - 135;
      if (rel < 0) rel += 360;
      if (rel > 270) rel = rel > 315 ? 0 : 270;
      const pct = Math.max(0, Math.min(100, rel / 2.7));

      const min = this.config.min, max = this.config.max, step = this.config.step;
      let val = min + (pct / 100) * (max - min);
      val = Math.round(val / step) * step;
      val = Math.round(val * 100) / 100;
      if (isNaN(val)) return;
      this._lastDragValue = val;

      const { x: nx, y: ny } = this._pointAt(pct, 80);
      dot.setAttribute("cx", nx);
      dot.setAttribute("cy", ny);
      this._els.targetLabel.textContent = ` ${val.toFixed(1)}°C`;
    };

    const onUp = (e) => {
      dot.removeEventListener("pointermove", onMove);
      dot.removeEventListener("pointerup", onUp);
      dot.removeEventListener("pointercancel", onUp);
      this._dragging = false;
      if (this._lastDragValue !== null && this._hass) {
        this._hass.callService("input_number", "set_value", {
          entity_id: this.config.target_entity,
          value: this._lastDragValue,
        });
      }
    };

    dot.addEventListener("pointermove", onMove);
    dot.addEventListener("pointerup", onUp);
    dot.addEventListener("pointercancel", onUp);
  }
}

customElements.define("temperature-gauge-card", TemperatureGaugeCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "temperature-gauge-card",
  name: "Temperature Gauge Card",
  description: "Jauge de température avec cible glissable",
});