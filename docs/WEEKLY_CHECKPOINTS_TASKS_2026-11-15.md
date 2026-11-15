# CERBERUS — Weekly Checkpoints Task Breakdown (6 Weeks)

> Period: 16 Nov – 27 Dec 2026 · Supervisor checkpoints: weekly, deliverable-based
> Phases mapping: C1–C3 = Phase 1 (software-first, no hardware) · C4–C5 = Phase 2 (real testbed) · C6 = Phase 3 (RF stretch, has fallback)

---

## Checkpoint 1 — Foundation & Data Pipeline (16–22 Nov)

**Goal:** Environment + simulated traffic pipeline + CICIoT2023 understood. No hardware required.

| ID | Task | Output | Depends on |
|----|------|--------|-----------|
| C1-T01 | Create project repo structure (`src/`, `data/`, `tests/`, `docs/`) + `.gitignore` | Repo pushed to GitHub | — |
| C1-T02 | Write `README.md` + `docs/ARCHITECTURE.md` (Simulator → Mosquitto → SQLite → future layers) | Docs | C1-T01 |
| C1-T03 | Install + configure Mosquitto locally (`listener 1883`, `allow_anonymous true`), verify with `mosquitto_pub`/`mosquitto_sub` | Working broker | — |
| C1-T04 | Define device profiles with behavioral parameters (topics, publish intervals, payload sizes, MAC) | `src/simulator/devices.py` | — |
| C1-T05 | Build traffic generator: publishes realistic MQTT events per profile, jittered intervals | `src/simulator/traffic_gen.py` | C1-T03, C1-T04 |
| C1-T06 | Build SQLite storage layer with UTC timestamps + indexes on `ts_utc`, `topic` | `src/storage/db.py` | — |
| C1-T07 | Unit test: events written for all devices, schema correct | `tests/test_traffic_gen.py` passing | C1-T05, C1-T06 |
| C1-T08 | Download CICIoT2023 (partitioned/small files first, full set in background) | `data/raw/` populated | — |
| C1-T09 | EDA notebook: label/category distribution, feature columns, nulls, normal-traffic distributions, target-category selection | `src/notebooks/01_ciciot_eda.ipynb` | C1-T08 |
| C1-T10 | Live demo dry-run (<5 min): run generator → query DB stats | Demo rehearsal | C1-T05..T07 |

**Acceptance:** Repo live · broker running · 3+ devices with distinct profiles publishing · DB populated with UTC timestamps · pytest green · EDA notebook with summary.

---

## Checkpoint 2 — Detection Engine v1 + First Benchmark (23–29 Nov)

**Goal:** Rules vs ML vs Hybrid, benchmarked on CICIoT2023 with real numbers. Critical path of the whole project.

| ID | Task | Output | Depends on |
|----|------|--------|-----------|
| C2-T01 | Feature extraction module: convert raw events/flows into feature vectors (packet rates, byte rates, inter-arrival stats, topic entropy, per-device deviation) | `src/detection/features.py` | C1-T05 |
| C2-T02 | Label mapping for CICIoT2023: select target attack categories (MQTT-related, flooding, brute force), normal/benign subset | `src/detection/dataset.py` | C1-T09 |
| C2-T03 | Rule-based baseline engine: threshold rules on publish rate, payload size, connection rate, topic scanning | `src/detection/rules_engine.py` | C2-T01 |
| C2-T04 | Train Isolation Forest (and/or Autoencoder) on benign CICIoT2023 traffic; tune `contamination` | `src/detection/ml_model.py` + saved model artifact | C2-T02 |
| C2-T05 | Behavioral fingerprinting v1: per-device baseline profile + deviation score | `src/detection/fingerprint.py` | C2-T01 |
| C2-T06 | Hybrid combiner: rule verdict + ML score + fingerprint deviation → single calibrated alert with confidence + explanation string | `src/detection/hybrid.py` | C2-T03..T05 |
| C2-T07 | Benchmark harness: same train/test split, leakage-free, metrics (accuracy/precision/recall/FPR/F1) + confusion matrices for each method | `src/evaluation/benchmark.py` | C2-T06 |
| C2-T08 | Run benchmark: Rules alone vs ML alone vs Hybrid on CICIoT2023 test subset | `results/benchmark_ciciot_v1.md` with tables + matrices | C2-T07 |
| C2-T09 | Sanity pass on simulated traffic: inject synthetic anomalous events into simulator, verify all three detectors fire | Test script + screenshot/log evidence | C2-T06 |

**Acceptance:** One benchmark table with real numbers + confusion matrices, re-runnable via one command. This artifact is the backbone of the final report.

**Risk note:** This is the critical path. If it slips, everything after shifts.

---

## Checkpoint 3 — Agents + Response + Dashboard, End-to-End on Simulated (30 Nov – 6 Dec)

**Goal:** The full closed loop works with zero hardware. Most demoable checkpoint for Dr. Mai.

| ID | Task | Output | Depends on |
|----|------|--------|-----------|
| C3-T01 | Policy layer skeleton: allowlist of response actions, scope rules, rate limits, audit log schema. **No execution path bypasses it** | `src/policy/` | — |
| C3-T02 | Evidence collection tools (server-side, deterministic): PCAP excerpt pull, MQTT log query, fingerprint deviation report | `src/agents/tools/` | C2-T01 |
| C3-T03 | Incident schema + timeline model: detection → evidence entries → decision → action → outcome | `src/incidents/` | C3-T01 |
| C3-T04 | Defense agent (Groq API, tool-calling): takes each detection, calls evidence tools, produces incident timeline + response recommendation. Model proposes; policy disposes | `src/agents/defense_agent.py` | C3-T02, C3-T03 |
| C3-T05 | Attack agent (DeepSeek API): generates attack plans against simulated testbed (MQTT flood, injection, spoofed identity), executes only through the same policy layer | `src/agents/attack_agent.py` | C3-T01 |
| C3-T06 | Response layer: automatic isolation of confirmed attacker (block/step-down action in simulator world) + audit trail | `src/response/` | C3-T01 |
| C3-T07 | SOC dashboard v1: live alerts, device status, incident view with timeline | `src/dashboard/` | C3-T03 |
| C3-T08 | Wire the closed loop: attack agent → traffic → detection → defense agent → response → dashboard feedback | Integration | C3-T04..T07 |
| C3-T09 | Failure-mode tests: LLM API down / rate-limited → deterministic fallback (rules-only response), no crash | `tests/` | C3-T08 |
| C3-T10 | Full E2E demo rehearsal: attack generated → detected → investigated → isolated → dashboard shows everything | Demo script | C3-T08 |

**Acceptance:** Live end-to-end demo in ~10 min, works with API keys, degrades gracefully without them.

---

## Checkpoint 4 — Real Testbed Online, Lab Dataset v1 (7–13 Dec)

**Goal:** Swap simulated world for real ESP32 + AP + gateway. First measured gap: CICIoT2023 vs lab.

| ID | Task | Output | Depends on |
|----|------|--------|-----------|
| C4-T01 | ESP32 firmware: MQTT client (PubSubClient) publishing per-device realistic payloads, matching simulator profiles | Firmware sketches for 2–3 devices | — |
| C4-T02 | Assemble testbed: AP/router + gateway machine running Mosquitto + capture stack | Testbed running on isolated SSID | C4-T01 |
| C4-T03 | Packet capture pipeline: `dumpcap`/`tshark` rolling captures with UTC filenames, synced clock | `src/capture/` | C4-T02 |
| C4-T04 | Collect lab normal traffic baseline (sustained run, multiple hours if possible) | `data/lab/normal/` + metadata sheet | C4-T03 |
| C4-T05 | Implement real protocol attacks: MQTT flood, publish injection, identity spoofing from ESP32/laptop | `src/attacks/` scripts | C4-T02 |
| C4-T06 | Collect lab attack dataset v1 (labeled, tens to low hundreds of instances as the proposal expects) | `data/lab/attacks/` + labels file | C4-T04, C4-T05 |
| C4-T07 | RF-layer attack enablement: deauth/disassociation via `esp_wifi_80211_tx()` (references [4],[5] in proposal), legal-enclosure-safe execution plan | Working deauth generation | C4-T02 |
| C4-T08 | Re-run detection stack on lab data (no retraining on lab attacks — train on CICIoT2023 benign, evaluate on lab) | Lab evaluation run | C4-T06 |
| C4-T09 | First gap report: CICIoT2023 accuracy vs lab accuracy, side by side, per attack type | `results/gap_report_v1.md` | C4-T08 |

**Acceptance:** Real devices on real AP · labeled lab dataset on disk · side-by-side numbers public-vs-lab. A measured drop is a scientific result, not a failure.

---

## Checkpoint 5 — Closed Loop on Real Testbed + Evaluation Report (14–20 Dec)

**Goal:** The whole system running live on the real network, evaluated with confidence intervals.

| ID | Task | Output | Depends on |
|----|------|--------|-----------|
| C5-T01 | Closed-loop live demo on real testbed: attack agent attacks real ESP32 → detect → investigate → isolate | Integrated run | C3-T08, C4-T02 |
| C5-T02 | Adversarial validation pass: attack agent adapts after isolation, loop repeats, log what changed | Adaptation log | C5-T01 |
| C5-T03 | Statistical evaluation: lab results reported with confidence intervals (bootstrap), not point estimates | `src/evaluation/stats.py` + updated report | C4-T08 |
| C5-T04 | Telegram/webhook alerting wired to incidents | Alert integration | C3-T07 |
| C5-T05 | Dashboard finalization: incident drill-down, isolation history, RF/telemetry panel placeholder | Dashboard v2 | C5-T04 |
| C5-T06 | Case study draft: one full incident from first packet to isolation, evidence chain documented | `docs/case_study_01.md` | C5-T01 |
| C5-T07 | Full demo script (15–20 min) written and rehearsed for Dr. Mai | Demo script + rehearsal | C5-T05 |

**Acceptance:** 15–20 min live demo for the supervisor · evaluation report draft with CIs · case study draft.

---

## Checkpoint 6 — RF Resilience (Stretch) + Final Deliverables (21–27 Dec)

**Goal:** Measured link-quality vs accuracy relationship + final report. Fallback path defined in advance.

| ID | Task | Output | Depends on |
|----|------|--------|-----------|
| C6-T01 | RF experiment setup: NRF24L01 TX + ESP32 victims inside isolated/shielded enclosure, NTRA-compliant, no external emission | Experiment rig | C4-T07 |
| C6-T02 | Fallback path (pre-built): controlled link degradation without NRF24 — distance/attenuation steps or ESP32-managed interference, same measurement protocol | Fallback script | C4-T08 |
| C6-T03 | Measurement campaign: step-degrade link quality → record detection accuracy + FPR per level | Results table per degradation level | C6-T01 (or C6-T02) |
| C6-T04 | RF results analysis: curve of link quality vs accuracy/FPR, confidence intervals | `results/rf_resilience.md` | C6-T03 |
| C6-T05 | Final report: architecture, methodology, benchmark tables (C2), gap report (C4), closed-loop findings (C5), RF results or documented fallback, limitations | `docs/FINAL_REPORT.md` | C2-T08, C4-T09, C5-T03, C6-T04 |
| C6-T06 | Demo video (short) of the full system | Video file | C5-T07 |
| C6-T07 | Final presentation deck for the defense | Deck | C6-T05 |
| C6-T08 | Optional open-data release: clean, anonymized lab attack dataset package | `data/release/` + README | C4-T06 |

**Acceptance:** Final report complete · RF results or documented fallback · video + deck. If RF failed, the report documents why and shows the fallback measurement — academically acceptable per the proposal.

---

## Cross-Checkpoint Tasks (every week)

| ID | Task |
|----|------|
| WK-T01 | Push all code to GitHub with a tagged commit per checkpoint (`checkpoint-1` … `checkpoint-6`) |
| WK-T02 | Update `docs/PROGRESS.md`: what shipped, what slipped, evidence links |
| WK-T03 | One-page weekly evidence pack for Dr. Mai: screenshot/table/log per deliverable |
| WK-T04 | Run full test suite + lint before each checkpoint review |

---

## Dependency Map (critical path)

```
C1 (pipeline) ──► C2 (benchmark) ──► C3 (loop on sim) ──► C5 (loop on real)
                        │                  │
                        │                  └──► C4 (testbed) ──┘
                        │                                        │
                        └──────────────────────────────────────► C6 (RF stretch)
```

- Critical path: C1-T05 → C2-T07 → C3-T08 → C5-T01. If any of these slips one week, the whole chain shifts; C6 absorbs the slack (it is a stretch goal by design).
- Hardware risk lives only in C4–C6; C1–C3 need nothing but a laptop.
