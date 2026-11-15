# CERBERUS — Team Roles, Checkpoint Ownership, and Work Breakdown

**Date:** 2026-11-12
**Status:** Proposed, **not applied**. No account, role, checkpoint, or task has been changed in production.
**Sources:**
- `F:\UserData\Desktop\proj\cerberus-workspace` at `fe25862` (clean, synced).
- Production D1 read-only inspection (users, roles, domains, checkpoints, tasks, `checkpoint_tasks`).
- `CERBERUS — Graduation Project Proposal.pdf` (10 pages): team structure p.1–2, five-layer architecture p.5, hardware p.6, three-phase work plan p.7, risks p.8, deliverables p.9.

**Scope rule:** this document assigns existing work. It does not add product features. Every step below uses UI or configuration that already exists in the deployed workspace.

---

## 0. Executive summary

The proposal defines **three sub-teams of two under one technical lead**. The workspace currently models **six engineering domains, each owned by one person**, which produces a mismatch: Wessam owns the Artificial Intelligence domain while the proposal assigns him testbed assembly and Wi-Fi/MQTT integration; Khamis owns Networking while the proposal assigns him detection-engine and RF/network-security support.

The fix is not a feature change. It is a **re-assignment of checkpoint ownership plus a rewrite of the 30 linked task definitions** so that:

1. Domains remain engineering areas (correct semantics), not people.
2. Each checkpoint is owned by the person who actually produces that work.
3. Each checkpoint's single linked task becomes a real, reviewable work package with measurable acceptance criteria.
4. Every member has a balanced, defensible deliverable set for the graduation report.

**Target ownership after applying this plan:**

| Member | Checkpoints owned | Work packages |
|---|---:|---|
| Mostafa Galal | 6 | Device security, Hybrid IDS, Response orchestration, Final security integration, Digital forensics agent, Adversarial validation agent |
| Khamis | 6 | AI/data foundation, ML IDS, Model/agent evaluation, Network security, Controlled security scenarios, Network defense |
| Wessam | 3 | Embedded foundation, Network foundation, Network visibility |
| Yousif | 5 | Wireless foundation, Wireless data collection, Feature extraction, Wireless resilience, Wireless integration |
| Nabil | 5 | Backend foundation, Data pipelines, Security platform APIs, System orchestration, Deployment and quality |
| Rozan | 5 | UI foundation, Live monitoring, Security operations, Analytics and reporting, Interface validation |
| Dr. Mai Shahin | 0 | Read-only supervision and written feedback |

Checkpoint count is **not** effort count. Wessam's three checkpoints carry the physical testbed, broker, and capture spine that every other package depends on.

---

## 1. What the workspace can and cannot assign

This matters because several "obvious" org-chart edits are impossible without new features, which are out of scope.

| Capability | Available? | Where / evidence |
|---|---|---|
| Change a checkpoint's owner | Yes, one checkpoint at a time | Members → selected member → **Reassign work** → select checkpoints + tasks → **Transfer selected work**. Route `POST /users/:id/reassign-work` moves `checkpoints.owner_id` and `tasks.assignee_id`; admin-only; target must be active and hold `task.work`; max 100 items. |
| Edit a checkpoint title, description, deliverable, criteria | **No** | `worker/routes/tasks.ts` exposes only `GET /checkpoints`, `GET /checkpoints/:id`, `POST /checkpoints/:id/submissions`. No PATCH/POST for checkpoint content. |
| Create or rename a domain / milestone | **No** | No route touches `engineering_domains` or `milestones` except setup seeding and read joins. |
| Create a task | Yes | Tasks page → **Define new task**. The create form exposes title, priority, assignee, description, acceptance criteria, validation procedure, and evidence requirements; prerequisites, inputs, steps, tools, deliverables, dates, and estimate are set afterward in the task detail editor. |
| Edit a task (all fields) | Yes | Task detail → **Edit**: title, description, priority, assignee, implementation steps, deliverables, prerequisites, inputs, required tools, expected outputs, acceptance criteria, validation procedure, evidence requirements, start/due dates, estimate hours. |
| Link an existing task to a checkpoint | **No** | `checkpoint_tasks` rows are written only at setup seed time and at task creation when a `checkpointId` is supplied; the UI create form does not send `checkpointId`. |
| Archive a task | Yes | Task detail; but see the warning in §10 — archiving a checkpoint's only linked task blocks that checkpoint (`TASKS_INCOMPLETE`), and there is no task-restore path in the UI. |
| Edit name / specialization / bio | Yes | Members → **Edit profile**. |
| Change roles | Yes | Members → role checkboxes. Roles are fixed: `super_admin`, `technical_lead`, `team_member`, `project_supervisor`. |
| Edit role permissions | **No** | No route or UI writes `role_permissions`; only `super_admin` holds `review.admin`. |

**Consequences that shape the plan:**

- The 30 seeded checkpoints are fixed labels. You cannot rename "Hybrid intrusion detection" or move it to another domain. You can only decide **who owns it**.
- The 30 seeded tasks (`Deliver <checkpoint>`) are the only tasks linked to checkpoints, and each checkpoint needs its linked task approved before the checkpoint can be submitted. **Edit them in place; never archive them.**
- New tasks are useful for cross-cutting work but do **not** gate any checkpoint.
- Domains will still be named after engineering areas while containing checkpoints owned by two people. That is correct, but the member list's "domain" chip is derived from one checkpoint (`LIMIT 1`), so it may show only one of a member's domains. Cosmetic only.

---

## 2. Organization derived from the proposal

Proposal, Work Plan (p.7): *"three sub-teams of two members each … under one technical lead who reviews integration across all three: a hardware & communications sub-team (testbed assembly, Wi-Fi/MQTT integration, RF telemetry), a security & AI sub-team (the hybrid IDS, the ML models, and the two LLM agents), and a backend & SOC dashboard sub-team (APIs, data storage, the live dashboard and investigation reports)."*

### 2.1 Sub-teams, leads, and decision rights

| Sub-team | Members | Lead | Owns | Must not do |
|---|---|---|---|---|
| Hardware & Communications | Wessam, Yousif | Wessam | Testbed assembly, device fleet firmware, AP/VLAN/broker baseline, packet/flow capture, CSI/RSSI telemetry, NRF24 resilience rig | Change detection logic, response policy, or production API contracts without review |
| Security & AI | Mostafa, Khamis | Mostafa (also project technical lead) | Threat model, device identity, hybrid IDS, ML models, both LLM agents, response policy, end-to-end security acceptance | Change hardware wiring, broker topology, or dashboard contracts unilaterally |
| Backend & SOC | Nabil, Rozan | Nabil | Backend service, schema, ingest, APIs, deployment, SOC dashboard, reports, exports | Change detection thresholds or response policy; execute containment |

**Cross-team decision rights:**

- **Architecture and interface changes:** Mostafa approves; affected lead must agree in writing (ADR or task comment).
- **Detection model, features, and metrics:** Khamis owns; Mostafa reviews.
- **Response policy and destructive actions:** Mostafa owns; Khamis performs the safety review.
- **Hardware, network topology, broker configuration:** Wessam owns; Khamis reviews security configuration.
- **RF experiments and enclosure safety:** Yousif owns; Mostafa approves the safety plan before execution.
- **API/schema changes:** Nabil owns; consumers (Mostafa, Khamis, Rozan) review.
- **UI and report presentation:** Rozan owns; Nabil reviews API alignment.
- **Release tag and demo readiness:** Mostafa approves; Nabil executes.

### 2.2 RACI for cross-cutting workstreams

R = responsible, A = accountable, C = consulted, I = informed.

| Workstream | Mostafa | Khamis | Wessam | Yousif | Nabil | Rozan | Supervisor |
|---|---|---|---|---|---|---|---|
| Testbed and device fleet | A/C | C | **R** | C | I | I | I |
| Lab network and MQTT broker | A | C | **R** | I | C | I | I |
| Device identity and hardening | **R/A** | C | C | I | I | I | I |
| Dataset and features | A | **R** | I | C | C | I | I |
| ML detection | A | **R** | I | C | I | I | I |
| Hybrid fusion and rules | **R/A** | C | I | C | I | I | I |
| Attack agent | **R/A** | C | C | C | C | I | I |
| Defense/forensics agent | **R/A** | C | I | I | C | I | I |
| Response orchestration | **R/A** | C | C | I | C | C | I |
| Wireless/RF telemetry | A | C | C | **R** | I | I | I |
| RF resilience experiment | A | C | C | **R** | I | I | I |
| Backend and data pipelines | A | C | C | C | **R** | C | I |
| SOC dashboard | A | C | I | I | C | **R** | I |
| Evaluation harness | A | **R** | I | C | C | I | I |
| Final integration and demo | **R/A** | C | C | C | C | C | I |
| Safety, ethics, NTRA dossier | A | **R** | C | C | I | I | C |
| Final report | **A** | R | R | R | R | R | C |

The supervisor is **not** R or A on any engineering package. `project_supervisor` holds only `feedback.create`; she cannot be assigned tasks.

---

## 3. Member dossiers

Each dossier lists the exact profile fields to apply (Members → **Edit profile**), the role to keep or add, the checkpoints owned after the move, and the definition of done for that person.

### 3.1 Mostafa Galal — Technical Lead

- **Account:** `mostafa@cerberus.local` · roles `super_admin`, `technical_lead`, `team_member` (keep).
- **Display name:** `Mostafa Galal` (keep).
- **Specialization:** `Technical Lead — Security Architecture, Hybrid IDS & AI Agents`
- **Bio:** `Leads CERBERUS security architecture and the design of the attack and defense agents. Owns device trust, hybrid detection fusion, policy-bounded response, and end-to-end security acceptance. eJPT-certified; background in reverse engineering, malware analysis, and exploit development.`
- **Sub-team:** Security & AI (lead); project technical lead across all three sub-teams.
- **Owns:** Device security, Hybrid intrusion detection, Response orchestration, Final security integration, Digital forensics agent, Adversarial validation agent.
- **Decision rights:** architecture and interface freeze, response policy, safety approval for RF experiments, release approval, reviewer for Khamis's submissions.
- **Definition of done:** six checkpoints approved with evidence; E2E scenario matrix signed; residual-risk register published; demo reproducible by a second operator.

### 3.2 Mohammed Khamis Barakat — Deputy Technical Lead

- **Account:** `khamis@cerberus.local` · roles `team_member` + **add `super_admin`** (see §5 for why).
- **Display name:** `Khamis` (keep; full name optional).
- **Specialization:** `Deputy Lead — Detection Engineering, ML/IDS & Network Security`
- **Bio:** `Owns the data foundation, ML anomaly detection, evaluation harness, and network security validation. CCNA and Linux Administration (NTI); embedded-systems background; supports the detection engine and RF/network security testing.`
- **Sub-team:** Security & AI.
- **Owns:** AI and data foundation, Machine-learning IDS, Model and agent evaluation, Network security, Controlled security scenarios, Network defense.
- **Decision rights:** model choice, feature set, thresholds and metrics, evaluation protocol, network hardening standard.
- **Definition of done:** six checkpoints approved; evaluation report with confidence intervals; coverage matrix shows every network scenario as detected or explicitly uncovered.

### 3.3 Wessam Emad Ismail — Hardware & Communications Lead

- **Account:** `wessam@cerberus.local` · role `team_member` (keep).
- **Display name:** `Wessam` (keep).
- **Specialization:** `Hardware & Communications — Testbed, Wi-Fi/MQTT & Network Foundation`
- **Bio:** `Builds and runs the ESP32 testbed, the lab network, the Mosquitto broker, and the packet/flow capture spine. Internship experience in mobile-network radio and microwave units at Mobi Egypt; team-led Arduino embedded projects.`
- **Sub-team:** Hardware & Communications (lead).
- **Owns:** Embedded foundation, Network foundation, Network visibility.
- **Decision rights:** hardware BOM and wiring, network topology, broker baseline, capture points.
- **Definition of done:** five devices reproduce from a clean checkout; lab rebuilds from exported config in under 30 minutes; 24-hour capture soak within the loss budget.

### 3.4 Yousif Mamdouh Ramadan — Wireless & RF Lead

- **Account:** `youssef@cerberus.local` · role `team_member` (keep).
- **Display name:** `Yousif` (proposal spelling) or keep `Youssef`; pick one and use it everywhere.
- **Specialization:** `Wireless & RF — CSI/RSSI Telemetry, NRF24 Resilience`
- **Bio:** `Owns wireless measurement, CSI/RSSI collection, link-quality feature extraction, and the shielded NRF24L01 resilience experiment. Biomedical-engineering internship at Siemens Healthineers; coursework in signal modulation, wave propagation, and digital communications.`
- **Sub-team:** Hardware & Communications.
- **Owns:** all five Wireless Communications & CSI checkpoints.
- **Decision rights:** measurement methodology, calibration, experiment matrix, enclosure procedure (with Mostafa's safety approval).
- **Definition of done:** five checkpoints approved; link-quality dataset checksummed; resilience results reported with confidence intervals or the stretch goal formally cut with evidence.

### 3.5 Mohamed Nabil — Backend & Platform Lead

- **Account:** `nabil@cerberus.local` · role `team_member` (keep).
- **Display name:** `Nabil` (keep).
- **Specialization:** `Backend & Platform — APIs, Data Pipelines & Orchestration`
- **Bio:** `Owns the platform service, canonical event schema, ingest pipelines, security APIs, deployment, and release quality. Hands-on penetration testing (DEPI), IoT development, and full-stack work with Flask, SQLite, and real-time dashboards.`
- **Sub-team:** Backend & SOC (lead).
- **Owns:** all five Backend Engineering checkpoints.
- **Decision rights:** service stack, schema, API contracts, deployment topology, release mechanics.
- **Definition of done:** one-command bring-up on a clean host; migrations from empty DB; contract tests pass; backup restore verified; release tagged.

### 3.6 Ahmed Elsayed Rozan — SOC Dashboard Lead

- **Account:** `rozen@cerberus.local` · role `team_member` (keep).
- **Display name:** `Rozan` (proposal spelling) or keep `Rozen`; pick one and use it everywhere.
- **Specialization:** `SOC Dashboard — Frontend, Reporting & Interface Validation`
- **Bio:** `Owns the SOC dashboard, live monitoring, alert triage and investigation UI, analytics, exports, and interface acceptance testing. CCNA; ITI/DEPI Vulnerability Analyst track; prior NRF24-based embedded wireless project.`
- **Sub-team:** Backend & SOC.
- **Owns:** all five Frontend Engineering checkpoints.
- **Decision rights:** UI architecture, design system, interaction patterns, accessibility standard.
- **Definition of done:** five checkpoints approved; alert→incident→response path in five clicks or fewer; no Sev-1 UI defects; accessibility recheck passes.

### 3.7 Dr. Mai Shahin — Supervisor

- **Account:** `supervisor@cerberus.local` · role `project_supervisor` (keep; do not add `team_member`).
- **Display name:** change `Project Supervisor` → `Dr. Mai Shahin`.
- **Specialization:** `Academic Supervision`
- **Bio:** `Faculty supervisor for CERBERUS. Reviews scope, methodology, safety, and deliverables; provides written feedback through the workspace. Read-only on engineering work.`
- **Owns:** no checkpoints. Cannot be assigned tasks (`project_supervisor` lacks `task.work`; reassignment would fail with `TARGET_NOT_CONTRIBUTOR`).
- **Definition of done:** milestone reviews recorded as feedback; no engineering ownership.


---

## 4. Ownership map: current → target

### 4.1 The four moves

Only four reassignments are needed. Each move must include **the checkpoint and its linked task**; otherwise the checkpoint owner changes but the task stays with the old member, and the new owner cannot complete the checkpoint gate.

| # | From | To | Checkpoints to select | Linked tasks to select | Resulting count |
|---|---|---|---|---|---|
| M1 | Wessam | Khamis | AI and data foundation · Machine-learning IDS · Model and agent evaluation | Deliver AI and data foundation · Deliver Machine-learning IDS · Deliver Model and agent evaluation | Wessam 2, Khamis 8 |
| M2 | Wessam | Mostafa | Digital forensics agent · Adversarial validation agent | Deliver Digital forensics agent · Deliver Adversarial validation agent | Wessam 0, Mostafa 7 |
| M3 | Mostafa | Wessam | Embedded foundation | Deliver Embedded foundation | Mostafa 6, Wessam 1 |
| M4 | Khamis | Wessam | Network foundation · Network visibility | Deliver Network foundation · Deliver Network visibility | Khamis 6, Wessam 3 |

**Why this order:** M1 and M2 empty Wessam's original AI set before M3 gives him a new checkpoint; M4 then gives him the two network checkpoints. At no point does a target hold two members' full sets, so a mis-click cannot bulk-move the wrong work. Do them in the order shown and verify counts after each.

### 4.2 Final matrix

| Checkpoint ID | Domain | Checkpoint | Task ID | Before | After |
|---|---|---|---|---|---|
| `checkpoint_1_1` | Embedded Systems & Cybersecurity | Embedded foundation | `task_1_1` | Mostafa | **Wessam** |
| `checkpoint_1_2` | Embedded Systems & Cybersecurity | Device security | `task_1_2` | Mostafa | Mostafa |
| `checkpoint_1_3` | Embedded Systems & Cybersecurity | Hybrid intrusion detection | `task_1_3` | Mostafa | Mostafa |
| `checkpoint_1_4` | Embedded Systems & Cybersecurity | Response orchestration | `task_1_4` | Mostafa | Mostafa |
| `checkpoint_1_5` | Embedded Systems & Cybersecurity | Final security integration | `task_1_5` | Mostafa | Mostafa |
| `checkpoint_2_1` | Artificial Intelligence | AI and data foundation | `task_2_1` | Wessam | **Khamis** |
| `checkpoint_2_2` | Artificial Intelligence | Machine-learning IDS | `task_2_2` | Wessam | **Khamis** |
| `checkpoint_2_3` | Artificial Intelligence | Digital forensics agent | `task_2_3` | Wessam | **Mostafa** |
| `checkpoint_2_4` | Artificial Intelligence | Adversarial validation agent | `task_2_4` | Wessam | **Mostafa** |
| `checkpoint_2_5` | Artificial Intelligence | Model and agent evaluation | `task_2_5` | Wessam | **Khamis** |
| `checkpoint_3_1` | Networking & Network Security | Network foundation | `task_3_1` | Khamis | **Wessam** |
| `checkpoint_3_2` | Networking & Network Security | Network visibility | `task_3_2` | Khamis | **Wessam** |
| `checkpoint_3_3` | Networking & Network Security | Network security | `task_3_3` | Khamis | Khamis |
| `checkpoint_3_4` | Networking & Network Security | Controlled security scenarios | `task_3_4` | Khamis | Khamis |
| `checkpoint_3_5` | Networking & Network Security | Network defense | `task_3_5` | Khamis | Khamis |
| `checkpoint_4_1` | Wireless Communications & CSI | Wireless foundation | `task_4_1` | Yousif | Yousif |
| `checkpoint_4_2` | Wireless Communications & CSI | Wireless data collection | `task_4_2` | Yousif | Yousif |
| `checkpoint_4_3` | Wireless Communications & CSI | Feature extraction | `task_4_3` | Yousif | Yousif |
| `checkpoint_4_4` | Wireless Communications & CSI | Wireless resilience | `task_4_4` | Yousif | Yousif |
| `checkpoint_4_5` | Wireless Communications & CSI | Wireless integration | `task_4_5` | Yousif | Yousif |
| `checkpoint_5_1` | Backend Engineering | Backend foundation | `task_5_1` | Nabil | Nabil |
| `checkpoint_5_2` | Backend Engineering | Data pipelines | `task_5_2` | Nabil | Nabil |
| `checkpoint_5_3` | Backend Engineering | Security platform APIs | `task_5_3` | Nabil | Nabil |
| `checkpoint_5_4` | Backend Engineering | System orchestration | `task_5_4` | Nabil | Nabil |
| `checkpoint_5_5` | Backend Engineering | Deployment and quality | `task_5_5` | Nabil | Nabil |
| `checkpoint_6_1` | Frontend Engineering | UI foundation | `task_6_1` | Rozan | Rozan |
| `checkpoint_6_2` | Frontend Engineering | Live monitoring | `task_6_2` | Rozan | Rozan |
| `checkpoint_6_3` | Frontend Engineering | Security operations | `task_6_3` | Rozan | Rozan |
| `checkpoint_6_4` | Frontend Engineering | Analytics and reporting | `task_6_4` | Rozan | Rozan |
| `checkpoint_6_5` | Frontend Engineering | Interface validation | `task_6_5` | Rozan | Rozan |

**Totals:** Mostafa 6 · Khamis 6 · Wessam 3 · Yousif 5 · Nabil 5 · Rozan 5 = 30.

### 4.3 Why each move is correct

- **A1, A2, A5 → Khamis.** The proposal places ML models and detection in Security & AI; Khamis has the Python/CCNA/Linux profile and the detection-support role. AI/data foundation, ML IDS, and evaluation are one continuous pipeline and should not be split.
- **A3, A4 → Mostafa.** The proposal states he "leads … the design of the two LLM-driven agents." Keeping both agents with him also keeps the agent tool contracts and the response policy under one owner.
- **E1 → Wessam.** "Embedded foundation" is the device fleet and firmware baseline, which the proposal gives to Hardware & Communications (testbed assembly, Wi-Fi/MQTT).
- **N1, N2 → Wessam.** AP/VLAN/broker and capture are physical testbed work. Network *security* (N3), scenarios (N4), and defense validation (N5) stay with Khamis, matching the proposal's "RF/network security testing" support role.
- **No changes to Yousif, Nabil, Rozan.** Their domains already match the proposal and their profiles.

### 4.4 What the domain labels will look like afterward

Domains are engineering areas, not people. After the moves:

- **Embedded Systems & Cybersecurity** contains one Hardware checkpoint (E1, Wessam) and four Security checkpoints (E2–E5, Mostafa).
- **Artificial Intelligence** contains three Detection/ML checkpoints (Khamis) and two agent checkpoints (Mostafa).
- **Networking & Network Security** contains two Hardware/testbed checkpoints (Wessam) and three Network-security checkpoints (Khamis).
- **Wireless, Backend, Frontend** remain single-owner.

This is intentional and defensible. Do not try to "fix" it by moving checkpoints into person-shaped domains; the workspace cannot rename domains, and person-shaped domains would misrepresent the engineering areas.

---

## 5. Review and approval model

The workspace enforces two separate gates:

1. **Task gate:** a task must be submitted and approved before its checkpoint can be submitted. Checkpoint submission fails with `TASKS_INCOMPLETE` while any linked, non-archived task is not `approved`.
2. **Checkpoint gate:** the checkpoint owner (or an admin) submits a summary + evidence; a reviewer with `review.admin` approves it. Self-approval is rejected (`SELF_APPROVAL_FORBIDDEN`), and a submitter cannot be assigned as their own reviewer (`SELF_REVIEW_FORBIDDEN`).

**The single-admin problem:** production currently has exactly one account with `review.admin` — Mostafa (`super_admin`). He owns six checkpoints and their six tasks. If he submits them, nobody can approve them. The workspace has no role-permission editor, so the only UI-reachable fix is to give a second trusted member the `super_admin` role.

**Recommended configuration:**

- Add `super_admin` to **Khamis** and label him **Deputy Technical Lead / four-eyes reviewer** in his specialization and bio.
- Keep `team_member` on his account so he still appears as a contributor and can receive work.
- Mostafa reviews Khamis's six submissions; Khamis reviews Mostafa's six. Each remains accountable for their own work and cannot self-approve.
- Document the grant in the project log. It carries user-management and role-assignment power, so it is a deliberate trust decision, not a convenience. Revert to `team_member` after the final defense if the team prefers.

**Alternative if co-admin is unacceptable:** Mostafa owns zero checkpoints and only reviews. This is not recommended: the technical lead would have no tracked deliverables, and the graduation report needs evidence of his individual work. A second alternative — leaving his six checkpoints unapproved — defeats the purpose of the workspace.

**Reviewer assignment:** for each submission, the reviewer can be assigned explicitly in the review queue (Review → assign reviewer). Assign Khamis to Mostafa's submissions and Mostafa to Khamis's. Rubrics can be attached per review; use one rubric consistently across a checkpoint type so scores are comparable.


---

## 6. Work breakdown — the 30 linked work packages

These 30 tasks already exist and are each linked to one checkpoint. **Edit them in place** (Tasks → open task → Edit). Set the assignee only if the move did not already set it. Use the field values below verbatim; they are written to fit the edit dialog and the review rubric.

Conventions:

- **Priority:** `critical` = on the demo/critical path; `high` = blocks another team; `medium` = normal.
- **Estimate:** engineering hours, excluding meetings and report writing (those are the cross-cutting tasks in §7).
- **Phase:** proposal phase 1 = software-only/CICIoT2023; phase 2 = physical testbed and lab data; phase 3 = RF resilience stretch.

---

### 6.1 Embedded Systems & Cybersecurity

#### E1 · Embedded foundation — `checkpoint_1_1` / `task_1_1`

**Assignee:** Wessam · **Priority:** critical · **Estimate:** 26 h · **Phase:** 2 (procurement starts in phase 1)

**Title:** `Testbed firmware baseline and device fleet provisioning`

**Description:** `Build the reproducible ESP32 firmware baseline for the CERBERUS testbed: five endpoints with unique identities, Wi-Fi association to the lab AP, MQTT telemetry (heartbeat, state, RSSI, uptime), and a one-command flash/provision workflow. This is the hardware foundation every later phase depends on.`

**Prerequisites:** `Lab AP and Mosquitto broker reachable (N1); device inventory with MAC/serial; PlatformIO or ESP-IDF toolchain installed.`

**Inputs:** `Device list and labels; topic schema v0; lab Wi-Fi credentials from the secret store; board model and flash size.`

**Implementation steps:**
1. `Freeze the hardware BOM and label every board physically and in the inventory.`
2. `Create a PlatformIO/ESP-IDF project with one build environment per board type.`
3. `Implement Wi-Fi reconnect with backoff and NTP UTC time sync.`
4. `Implement MQTT publish with device_id, seq, UTC timestamp, message type, and payload.`
5. `Add a watchdog and a bounded offline buffer for broker outages.`
6. `Write a provisioning script that injects device_id and credentials without committing secrets.`
7. `Run a 60-minute, five-device soak and capture broker logs.`

**Required tools:** `PlatformIO or ESP-IDF, esptool, mosquitto_sub, Git, serial logger.`

**Expected outputs:** `Five provisioned devices publishing on a fixed cadence; reproducible build; inventory table.`

**Deliverables:** `Tagged firmware v0.1.0; per-device config; provisioning script; README with reflash procedure; broker capture from the soak.`

**Acceptance criteria:** `Five devices boot and publish for 60 minutes with less than 1% missed intervals; device_id is unique and stable across reboot; a clean checkout plus the provisioning script reproduces the same behavior; no credentials are present in the repository or firmware image.`

**Validation procedure:** `From a clean checkout, provision one device, join the lab AP, subscribe to cerberus/devices/#, confirm 60 minutes of captures, reboot the device, and confirm the identity and cadence are unchanged.`

**Evidence requirements:** `Commit or tag link; serial log excerpts; broker capture; device inventory table; statement of the measured missed-interval rate.`

---

#### E2 · Device security — `checkpoint_1_2` / `task_1_2`

**Assignee:** Mostafa · **Priority:** critical · **Estimate:** 16 h · **Phase:** 1 design, 2 implementation

**Title:** `Device identity, authenticated telemetry, and hardening baseline`

**Description:** `Define and implement the device trust baseline: per-device credentials, protected key storage, authenticated telemetry, replay resistance, and a documented secure-boot/flash-encryption position for the ESP32 fleet given development-board constraints.`

**Prerequisites:** `E1 firmware baseline; threat model v0; broker authentication design (N3).`

**Inputs:** `Device inventory; ESP32 eFuse constraints; broker auth options; lab threat model.`

**Implementation steps:**
1. `Choose the identity model (per-device PSK or client certificates) and record the tradeoff in an ADR.`
2. `Provision secrets into encrypted NVS; keep long-term secrets out of source and build artifacts.`
3. `Enforce broker-side authentication and per-device topic ACLs.`
4. `Add monotonic sequence numbers and a timestamp freshness window.`
5. `Test replay, spoofing, and cross-topic publish attempts.`
6. `Evaluate secure boot and flash encryption on one board; document eFuse irreversibility and decide whether to enable it.`
7. `Publish a device-hardening checklist for the fleet.`

**Required tools:** `ESP-IDF NVS encryption, OpenSSL, Mosquitto ACLs, espefuse, Wireshark, strings.`

**Expected outputs:** `Identity design note; provisioning changes; replay/spoof test log; hardening checklist.`

**Deliverables:** `Code changes; ADR; test transcript; documented secure-boot position and residual risk.`

**Acceptance criteria:** `No plaintext long-term secret exists in the firmware image or repository; a replayed MQTT message is rejected; a device cannot publish on another device's topic; the secure-boot/flash-encryption position is documented with an explicit limitation if not enabled.`

**Validation procedure:** `Capture a valid frame and replay it; attempt cross-device publish; inspect the image with strings; verify broker denial logs; run the checklist against two devices.`

**Evidence requirements:** `Replay and spoof transcripts; broker denial logs; image inspection output; ADR link; signed checklist.`

---

#### E3 · Hybrid intrusion detection — `checkpoint_1_3` / `task_1_3`

**Assignee:** Mostafa · **Priority:** critical · **Estimate:** 24 h · **Phase:** 1 with simulated traffic, 2 with lab traffic

**Title:** `Hybrid detection engine: rules, device fingerprinting, and score fusion`

**Description:** `Implement the rule and behavioral-fingerprint detection layer plus the fusion logic that combines it with the ML score into one calibrated, explainable alert with contributing evidence.`

**Prerequisites:** `A1 feature schema; A2 model artifact and inference contract; N2 flow/PCAP telemetry; E2 device identity.`

**Inputs:** `Labeled replay set; alert schema v1; benign soak baseline; initial thresholds.`

**Implementation steps:**
1. `Define the rule catalog: MQTT rate, duplicate, payload-size and topic anomalies, connection churn, and deauth floods where telemetry exists.`
2. `Define per-device fingerprint features: inter-arrival, payload-size distribution, topic set, sequence gaps, and RSSI.`
3. `Implement scoring and calibration against the benign baseline.`
4. `Implement the fusion policy: rule override, ML confidence, fingerprint mismatch, and confidence calibration.`
5. `Emit alerts with contributing rules/features and a human-readable explanation.`
6. `Build a regression suite with known attacks and benign load.`
7. `Document the false-positive budget and its measured value.`

**Required tools:** `Python, scikit-learn inference, pandas, pytest, tshark, Wireshark.`

**Expected outputs:** `Detection module; rule configuration; alert schema; regression results; example alerts.`

**Deliverables:** `Code and config; test report comparing rule-only, ML-only, and hybrid; ten annotated alert examples.`

**Acceptance criteria:** `Hybrid F1 is at least the best single approach plus the pre-registered margin on the replay set, or the margin is reported as not met with analysis; every alert carries at least one rule/feature explanation; benign-soak false positives stay within the agreed budget.`

**Validation procedure:** `Run the regression suite from a clean checkout; compare the three detection configurations; inspect ten alerts for correct explanation fields; rerun the benign soak.`

**Evidence requirements:** `Test output; metrics table with counts; sample alerts; false-positive measurement.`

---

#### E4 · Response orchestration — `checkpoint_1_4` / `task_1_4`

**Assignee:** Mostafa · **Priority:** critical · **Estimate:** 22 h · **Phase:** 1 dry-run, 2 live

**Title:** `Policy-bounded response orchestrator with rollback and audit`

**Description:** `Convert a confirmed incident into one reversible containment action (broker ACL revoke, AP deny-list/deauth, quarantine VLAN) with dry-run, cooldown, blast-radius limits, rollback, and an audit trail.`

**Prerequisites:** `E3 alerts; N3 broker/AP controls; B3 incident API.`

**Inputs:** `Response policy catalog; actuator capabilities; incident schema; approval rules.`

**Implementation steps:**
1. `Define the policy schema: action allowlist, target scope, maximum duration, cooldown, and required confidence.`
2. `Implement idempotent actuator adapters for broker ACL revoke, AP deny-list, and quarantine.`
3. `Implement dry-run and simulation modes.`
4. `Implement rollback, expiry, and a kill switch.`
5. `Require explicit confirmation for destructive actions.`
6. `Write audit events with actor, time, target, action, and reason.`
7. `Test with synthetic incidents and one live lab attack.`

**Required tools:** `Python, Mosquitto dynamic security or ACL reload, AP CLI/API, database audit log.`

**Expected outputs:** `Policy engine; actuator adapters; rollback tests; audit samples; latency measurements.`

**Deliverables:** `Code; policy config; operations runbook; test evidence.`

**Acceptance criteria:** `Only allowlisted actions execute; an out-of-scope target is rejected in testing; containment is applied within the agreed target (10 seconds or better) after confirmation; rollback restores the baseline; every action is auditable.`

**Validation procedure:** `Attempt a forbidden action and confirm rejection; measure detection-to-containment latency; roll back and verify the device reconnects; inspect audit rows.`

**Evidence requirements:** `Audit rows; latency measurement; before/after broker and AP state; rollback transcript.`

---

#### E5 · Final security integration — `checkpoint_1_5` / `task_1_5`

**Assignee:** Mostafa · **Priority:** critical · **Estimate:** 20 h · **Phase:** 2, refresher in 3

**Title:** `End-to-end security integration and adversarial acceptance test`

**Description:** `Integrate attack, detection, investigation, response, and dashboard into one reproducible flow; run the multi-layer scenario suite; produce the security acceptance report and the demo script.`

**Prerequisites:** `E3, E4, A3, A4, B3, F3, N5 complete or at release-candidate quality.`

**Inputs:** `Scenario suite (N4); API contracts; demo environment; release checklist.`

**Implementation steps:**
1. `Freeze interface contracts and record versions.`
2. `Run at least five multi-layer scenarios end to end.`
3. `Capture latency at each stage: alert, investigation, decision, containment.`
4. `Record failures, gaps, and manual interventions.`
5. `Fix integration defects and rerun the matrix.`
6. `Write the security acceptance report and residual-risk register.`
7. `Rehearse the demo twice, once with a second operator.`

**Required tools:** `Compose stack, scenario scripts, dashboard, screen recording, stopwatch or trace timestamps.`

**Expected outputs:** `End-to-end results matrix; latency table; defect log; demo script.`

**Deliverables:** `Integration report; recorded demo; tagged release candidate; residual-risk register.`

**Acceptance criteria:** `At least five scenarios complete without manual intervention except required approvals; detection-to-response latency is measured and within target; no open P0 defect; a second person can reproduce the demo from the runbook.`

**Validation procedure:** `A second operator runs the demo from the runbook without assistance; compare the results with the signed matrix.`

**Evidence requirements:** `Run logs; screen recording; signed matrix; latency table; residual-risk register.`

---

### 6.2 Artificial Intelligence

#### A1 · AI and data foundation — `checkpoint_2_1` / `task_2_1`

**Assignee:** Khamis · **Priority:** critical · **Estimate:** 22 h · **Phase:** 1

**Title:** `Dataset pipeline, label taxonomy, and leakage-free splits`

**Description:** `Build the reproducible data foundation for detection: CICIoT2023 ingestion, cleaning, label taxonomy, leakage-free splits, and a shared feature schema that the lab testbed will also populate.`

**Prerequisites:** `None; start of phase 1. B1 schema draft is helpful.`

**Inputs:** `CICIoT2023 raw files; lab schema v0; device inventory; class definitions.`

**Implementation steps:**
1. `Download the dataset and verify file hashes.`
2. `Map source columns to the canonical event/feature schema.`
3. `Remove duplicates and handle missing values with a documented policy.`
4. `Define the label taxonomy: benign plus attack families.`
5. `Split by capture/device/time to prevent leakage.`
6. `Compute class distribution and report imbalance.`
7. `Write the dataset card and feature dictionary.`
8. `Freeze a dataset version and record its hash.`

**Required tools:** `Python, pandas or polars, hashlib, Jupyter, Git LFS or DVC.`

**Expected outputs:** `Ingest scripts; feature artifacts; split files; dataset card; hash.`

**Deliverables:** `Versioned dataset and pipeline; dataset card; leakage-check script.`

**Acceptance criteria:** `The pipeline runs from raw data to features with one command; programmatic checks show no device/time overlap across splits; the dataset hash is recorded; class counts and imbalance handling are documented.`

**Validation procedure:** `Rerun the pipeline, compare the hash and split counts; run the leakage check; inspect ten random samples per class.`

**Evidence requirements:** `Pipeline log; hash; split report; dataset card link; leakage-check output.`

---

#### A2 · Machine-learning IDS — `checkpoint_2_2` / `task_2_2`

**Assignee:** Khamis · **Priority:** critical · **Estimate:** 30 h · **Phase:** 1

**Title:** `Isolation Forest / Autoencoder anomaly detection with calibrated explanations`

**Description:** `Train and calibrate the anomaly detector, compare Isolation Forest with an Autoencoder, expose inference behind the detection contract, and generate SHAP/LIME explanations for sampled alerts.`

**Prerequisites:** `A1 frozen dataset; inference contract from B3/E3.`

**Inputs:** `Frozen dataset and splits; compute budget; false-positive budget; model-serving contract.`

**Implementation steps:**
1. `Establish the rule-only baseline metrics.`
2. `Train Isolation Forest with a documented hyperparameter search.`
3. `Train an Autoencoder and compare, if time allows.`
4. `Calibrate the threshold to the false-positive budget.`
5. `Export the model and preprocessing artifact with a version.`
6. `Implement batch and online inference paths.`
7. `Add SHAP/LIME explanations for sampled alerts.`
8. `Log the model version with every alert.`

**Required tools:** `scikit-learn, PyTorch or TensorFlow, SHAP, LIME, MLflow or an artifact registry, pytest.`

**Expected outputs:** `Trained artifacts; training report; inference module; explanation samples; model card.`

**Deliverables:** `Model v1; reproducibility script; metrics report with confidence intervals.`

**Acceptance criteria:** `PR-AUC/F1 with 95% confidence intervals on the held-out split; inference p95 within the agreed latency budget; explanations produced for at least 20 sampled alerts; retraining from the recorded seed reproduces metrics within the stated tolerance.`

**Validation procedure:** `Retrain in a clean environment and compare metrics; call the inference path with known samples; inspect explanations for plausibility.`

**Evidence requirements:** `Metrics table; artifact hash; inference test output; explanation samples; model card.`

---

#### A3 · Digital forensics agent — `checkpoint_2_3` / `task_2_3`

**Assignee:** Mostafa · **Priority:** high · **Estimate:** 24 h · **Phase:** 1 simulated, 2 live

**Title:** `Defense agent: evidence-cited incident timeline and response recommendation`

**Description:** `Implement the defense agent that investigates each alert, assembles an evidence-cited timeline, states hypotheses and confidence, and recommends one response from the policy catalog without executing it. Enforce strict tool allowlisting, rate limits, and a deterministic fallback.`

**Prerequisites:** `E3 alerts; B3 APIs; A1 event schema; E4 policy catalog.`

**Inputs:** `Alert payload; device state; PCAP slice; MQTT logs; policy catalog.`

**Implementation steps:**
1. `Define the read-only tool set: get_alert, get_device, get_events, get_pcap_slice, get_policy_catalog.`
2. `Implement the tool-calling scaffold with JSON-schema validation.`
3. `Prompt for timeline, hypotheses, confidence, and a single recommendation.`
4. `Enforce step, time, and token budgets plus rate limits.`
5. `Persist the full trace with evidence citations.`
6. `Implement a deterministic fallback summarizer for API outages.`
7. `Evaluate on ten seeded incidents, including one prompt-injection attempt in an alert payload.`

**Required tools:** `Groq API, Python, JSON Schema, structured logging.`

**Expected outputs:** `Agent service; tool adapters; trace store; evaluation set.`

**Deliverables:** `Agent v1; prompt and tool documentation; trace samples; fallback behavior.`

**Acceptance criteria:** `On ten seeded incidents, the timeline cites at least three evidence IDs and identifies the correct incident window in at least eight; zero out-of-allowlist tool calls across tests; the fallback produces a usable summary without the API; latency and cost are logged.`

**Validation procedure:** `Replay the seeded incidents; inspect traces; inject an instruction-like string into an alert payload and confirm no tool escalation or scope change.`

**Evidence requirements:** `Trace exports; evaluation table; injection test; cost/latency log.`

---

#### A4 · Adversarial validation agent — `checkpoint_2_4` / `task_2_4`

**Assignee:** Mostafa · **Priority:** high · **Estimate:** 22 h · **Phase:** 1 scripts, 2 live

**Title:** `Attack agent with scope locking, rate limits, and a kill switch`

**Description:** `Implement the attack agent that selects and parameterizes attacks from an allowlisted catalog against lab targets only, with scope locking, rate limits, a kill switch, cleanup, and full action logging for reproducibility.`

**Prerequisites:** `N4 scenario scripts; isolated lab network; E1 devices.`

**Inputs:** `Target inventory and allowlist; attack catalog; safety constraints; scenario seeds.`

**Implementation steps:**
1. `Define the scope file and enforce target validation on every call.`
2. `Wrap each attack as a tool with parameters and preconditions.`
3. `Add rate limits, maximum concurrency, and a duration cap.`
4. `Implement the kill switch and cleanup procedure.`
5. `Log every action with seed, parameters, target, and result.`
6. `Run at least six scenarios.`
7. `Correlate actions with IDS alerts.`

**Required tools:** `DeepSeek API, Python, MQTT tooling, ESP32 injection firmware, tc/netem optionally.`

**Expected outputs:** `Agent service; attack wrappers; scope config; run logs; correlation report.`

**Deliverables:** `Agent v1; scope configuration; safety runbook; run logs.`

**Acceptance criteria:** `Out-of-scope targets are rejected in tests; rate and duration caps are enforced; each run is reproducible from its seed; every attack action has a log entry and time-correlates with at least one alert.`

**Validation procedure:** `Attempt an out-of-scope IP; exceed the rate limit; trigger the kill switch mid-run; replay one run from its seed.`

**Evidence requirements:** `Rejection test; cap test; kill-switch transcript; run logs; correlation table.`

---

#### A5 · Model and agent evaluation — `checkpoint_2_5` / `task_2_5`

**Assignee:** Khamis · **Priority:** high · **Estimate:** 22 h · **Phase:** 2, analysis in 3

**Title:** `Evaluation harness: detection baselines and agent quality metrics`

**Description:** `Build the evaluation harness that compares rule-only, ML-only, and hybrid detection on CICIoT2023 and lab data, and scores both agents on quality, latency, and cost with confidence intervals.`

**Prerequisites:** `A2, E3, A3, A4; lab data from phase 2.`

**Inputs:** `Frozen datasets; model versions; agent traces; scenario labels; pre-registered metrics.`

**Implementation steps:**
1. `Pre-register metrics, hypotheses, and exclusion rules.`
2. `Implement runners for each detector configuration.`
3. `Bootstrap confidence intervals for accuracy/F1/PR-AUC.`
4. `Quantify the lab-versus-public gap.`
5. `Define agent metrics: timeline completeness, recommendation correctness, latency, tokens and cost.`
6. `Generate tables and plots.`
7. `Write the evaluation report with limitations.`

**Required tools:** `Python, pandas, matplotlib, scipy or bootstrap, pytest.`

**Expected outputs:** `Harness; results JSON/CSV; plots; report.`

**Deliverables:** `One-command benchmark; evaluation report; results artifacts.`

**Acceptance criteria:** `All runs are logged and reproducible; confidence intervals are reported; the lab-versus-public difference is quantified; no configuration is excluded after seeing results.`

**Validation procedure:** `Run the benchmark twice and compare; audit the run log for completeness; recompute one metric manually.`

**Evidence requirements:** `Command output; results artifacts; report link; run log.`


---

### 6.3 Networking & Network Security

#### N1 · Network foundation — `checkpoint_3_1` / `task_3_1`

**Assignee:** Wessam · **Priority:** critical · **Estimate:** 20 h · **Phase:** 2 (procurement in 1)

**Title:** `Lab network, AP, VLAN segmentation, and Mosquitto broker baseline`

**Description:** `Build the lab network: AP, VLAN segmentation (IoT, attacker, management), DHCP reservations, a Mosquitto broker baseline, and gateway firewall rules so the testbed is isolated and reproducible.`

**Prerequisites:** `Access point and gateway hardware available; device inventory.`

**Inputs:** `Topology requirements; AP model capabilities; broker version; addressing plan.`

**Implementation steps:**
1. `Draw and review the topology before configuration.`
2. `Configure SSIDs and VLANs for IoT, attacker, and management.`
3. `Reserve a stable address per device.`
4. `Install Mosquitto with the required listeners.`
5. `Configure gateway firewall and NAT rules.`
6. `Verify isolation between VLANs.`
7. `Export the configuration and write a rebuild runbook.`

**Required tools:** `AP admin UI or OpenWrt, Mosquitto, nmap, tcpdump, DHCP reservations.`

**Expected outputs:** `Topology diagram; exported configs; rebuild runbook; isolation test results.`

**Deliverables:** `Network baseline v1; configuration exports; rebuild document.`

**Acceptance criteria:** `IoT VLAN reaches the broker only on the required ports; attacker VLAN cannot reach management; the network rebuilds from exports in under 30 minutes; every device has a stable reservation.`

**Validation procedure:** `Rebuild on a spare router or after a factory reset; run isolation tests from each VLAN; confirm device addresses after reboot.`

**Evidence requirements:** `Configuration files; nmap outputs per VLAN; rebuild log with timings.`

---

#### N2 · Network visibility — `checkpoint_3_2` / `task_3_2`

**Assignee:** Wessam · **Priority:** critical · **Estimate:** 22 h · **Phase:** 2

**Title:** `Packet capture and flow telemetry pipeline`

**Description:** `Implement packet and flow telemetry: capture points, rotation, flow records, UTC time synchronization, and ingestion into the backend with a defined loss budget.`

**Prerequisites:** `N1 network; B2 ingest contract.`

**Inputs:** `Capture hardware (gateway mirror or ESP32 sniffer); retention policy; flow schema.`

**Implementation steps:**
1. `Choose capture points and document what each one can and cannot see.`
2. `Enable NTP/UTC on every capture host and endpoint.`
3. `Configure tcpdump or tshark with size-based rotation.`
4. `Generate flow records with 5-tuple, bytes, packets, and duration.`
5. `Ship captures and flows to the backend with checksums.`
6. `Define retention and deletion.`
7. `Run a 24-hour soak and record loss.`

**Required tools:** `tcpdump, tshark, softflowd or Zeek, rsync, chrony/NTP.`

**Expected outputs:** `Capture service; flow schema; retention job; soak report.`

**Deliverables:** `Pipeline v1; runbook; 24-hour evidence.`

**Acceptance criteria:** `At least 95% of test sessions are observable; PCAP and flow timestamps agree within one second; the 24-hour soak stays within the loss budget; a capture restart does not lose configuration.`

**Validation procedure:** `Replay a known session set and compare counts; kill and restart the capture service; verify timestamp agreement on ten sessions.`

**Evidence requirements:** `Soak logs; count comparison; timestamp check; restart transcript.`

---

#### N3 · Network security — `checkpoint_3_3` / `task_3_3`

**Assignee:** Khamis · **Priority:** critical · **Estimate:** 20 h · **Phase:** 1 config, 2 validation

**Title:** `MQTT TLS, per-device authorization, and network hardening`

**Description:** `Harden the lab network and MQTT: TLS, per-device authentication and ACLs, broker limits, segmentation rules, and automated verification with before/after evidence.`

**Prerequisites:** `N1; E2 identity model.`

**Inputs:** `Identity design; broker version; certificate tooling; firewall platform.`

**Implementation steps:**
1. `Create a CA and per-device certificates, or per-device PSKs if that model was chosen.`
2. `Enable a TLS-only listener and disable anonymous access.`
3. `Write per-device topic ACLs.`
4. `Set connection, message-size, and rate limits.`
5. `Add firewall rules between VLANs.`
6. `Write a verification script that runs every check.`
7. `Record before/after results.`

**Required tools:** `OpenSSL, Mosquitto, iptables/nftables, nmap, testssl.sh.`

**Expected outputs:** `Certificates and broker config; ACLs; verification script; before/after report.`

**Deliverables:** `Hardened baseline; verification script; security configuration report.`

**Acceptance criteria:** `Anonymous publish is rejected; cross-topic publish is denied; TLS-only is enforced; a scan from the IoT VLAN exposes only the broker port; all checks are automated in one script.`

**Validation procedure:** `Run the verification script from the attacker and IoT VLANs; attempt anonymous and cross-topic publishes; scan the broker host.`

**Evidence requirements:** `Script output; broker denial logs; scan results; before/after diff.`

---

#### N4 · Controlled security scenarios — `checkpoint_3_4` / `task_3_4`

**Assignee:** Khamis · **Priority:** high · **Estimate:** 22 h · **Phase:** 1 scripts, 2 execution

**Title:** `Attack scenario library and safe execution runbook`

**Description:** `Build the controlled attack scenario library for protocol- and RF-layer attacks with preconditions, scripts, expected telemetry, blast radius, stop conditions, cleanup, and safety/regulatory notes.`

**Prerequisites:** `N3; E1 devices; Yousif's RF rig for RF scenarios.`

**Inputs:** `Attack catalog; lab isolation; NTRA constraints; device inventory.`

**Implementation steps:**
1. `List eight to ten scenarios across MQTT flooding, malformed payloads, topic injection, device spoofing, deauthentication, rogue AP, and replay.`
2. `Write a runbook per scenario with preconditions and expected telemetry.`
3. `Implement scripts with a dry-run mode.`
4. `Define stop conditions and cleanup.`
5. `Map each scenario to the alerts it should produce.`
6. `Rehearse each scenario twice.`
7. `Record actual telemetry and deviations.`

**Required tools:** `Python, mosquitto_pub/sub, ESP32 injection firmware, NRF24 only inside the enclosure.`

**Expected outputs:** `Scenario pack; runbooks; telemetry captures; alert mapping.`

**Deliverables:** `Versioned scenario pack; safety notes; dry-run evidence.`

**Acceptance criteria:** `Each scenario is reproducible from its runbook; no effect outside the lab is verified; cleanup restores the baseline; the scenario-to-alert mapping is backed by actual captures.`

**Validation procedure:** `Run each scenario from the runbook; verify isolation with an external monitor; compare telemetry with the expected mapping.`

**Evidence requirements:** `Run logs; captures; isolation check; cleanup verification.`

---

#### N5 · Network defense — `checkpoint_3_5` / `task_3_5`

**Assignee:** Khamis · **Priority:** high · **Estimate:** 20 h · **Phase:** 2

**Title:** `Network-layer detection rules and containment validation`

**Description:** `Implement network-layer detection rules and validate containment: ARP/scan/deauth/flood coverage, a coverage matrix against the scenario pack, and containment tests through the response orchestrator.`

**Prerequisites:** `N4; E3; E4.`

**Inputs:** `Scenario pack; flow and PCAP telemetry; response policy.`

**Implementation steps:**
1. `Implement network rules for scan, ARP anomaly, deauth flood, and traffic floods.`
2. `Tune against the benign soak.`
3. `Build the coverage matrix against N4.`
4. `Test containment for ACL revoke and quarantine.`
5. `Measure repeat-attack blocking.`
6. `Document uncovered scenarios explicitly.`
7. `Hand off the pack to final integration.`

**Required tools:** `Zeek or Suricata or custom Python, Wireshark, E4 orchestrator.`

**Expected outputs:** `Rules; coverage matrix; containment test results; FP measurement.`

**Deliverables:** `Detection pack; coverage report; containment evidence.`

**Acceptance criteria:** `Each network scenario is matched by at least one rule or ML path, or is explicitly marked uncovered with a reason; containment blocks repeat traffic in testing; false positives stay within budget.`

**Validation procedure:** `Replay every network scenario with detection enabled; verify containment; rerun the benign soak.`

**Evidence requirements:** `Coverage matrix; test logs; false-positive measurement; containment transcript.`

---

### 6.4 Wireless Communications & CSI

#### W1 · Wireless foundation — `checkpoint_4_1` / `task_4_1`

**Assignee:** Yousif · **Priority:** high · **Estimate:** 18 h · **Phase:** 2

**Title:** `Wireless measurement methodology and RF lab setup`

**Description:** `Define the wireless measurement methodology and RF lab setup: metrics (RSSI, SNR, link quality), calibration, hardware inventory (NRF24L01, ESP32, enclosure), and the safety plan.`

**Prerequisites:** `Hardware available; lab space; safety approval from Mostafa.`

**Inputs:** `NRF24 modules; ESP32 boards; enclosure plan; NTRA notes; measurement tools.`

**Implementation steps:**
1. `Define metrics and the sampling plan.`
2. `Calibrate radios at fixed distances.`
3. `Design the shielded enclosure and mounting.`
4. `Define the data schema.`
5. `Write the safety and regulatory checklist.`
6. `Take a baseline measurement.`

**Required tools:** `NRF24L01, ESP32, measuring tools, RF-absorbing material, calipers.`

**Expected outputs:** `Methodology; calibration curve; inventory; safety checklist; baseline data.`

**Deliverables:** `Measurement plan v1; calibration evidence; safety checklist.`

**Acceptance criteria:** `The baseline is repeatable within the stated tolerance; calibration is documented; the safety checklist is signed; the data schema is frozen.`

**Validation procedure:** `Repeat the baseline three times and compare; verify enclosure integrity; review the checklist with Mostafa.`

**Evidence requirements:** `Calibration data; photos; signed checklist; baseline runs.`

---

#### W2 · Wireless data collection — `checkpoint_4_2` / `task_4_2`

**Assignee:** Yousif · **Priority:** high · **Estimate:** 22 h · **Phase:** 2

**Title:** `RSSI/CSI telemetry collector with UTC time synchronization`

**Description:** `Build the RSSI/CSI telemetry collector with UTC timestamps, fixed cadence (50 ms), metadata, and checksummed storage.`

**Prerequisites:** `W1; N2 time synchronization.`

**Inputs:** `Collector hardware; schema; storage target.`

**Implementation steps:**
1. `Implement the sampling loop at the configured cadence.`
2. `Timestamp with UTC and a monotonic sequence.`
3. `Attach metadata: distance, orientation, interference state.`
4. `Write checksummed files.`
5. `Handle drops and backpressure.`
6. `Run 90-second captures.`
7. `Document the schema.`

**Required tools:** `ESP32/ESP-IDF, Python, SQLite or parquet, hashlib.`

**Expected outputs:** `Collector; dataset files; schema document; sample capture.`

**Deliverables:** `Collector v1; sample dataset; capture protocol.`

**Acceptance criteria:** `A 90-second capture at 50 ms loses less than 1% of samples; timestamps are monotonic; checksums verify; the schema is identical across runs.`

**Validation procedure:** `Rerun a capture and verify the checksum and rate; simulate a storage failure and confirm recovery.`

**Evidence requirements:** `Capture logs; checksum; dataset sample; schema link.`

---

#### W3 · Feature extraction — `checkpoint_4_3` / `task_4_3`

**Assignee:** Yousif · **Priority:** high · **Estimate:** 20 h · **Phase:** 2

**Title:** `Link-quality feature extraction and windowing`

**Description:** `Extract windowed link-quality features (mean, variance, skew, RSSI slope, SNR, dropout rate) with quality flags and a feature dictionary that matches the shared schema.`

**Prerequisites:** `W2; A1 schema.`

**Inputs:** `Raw captures; window policy; shared feature dictionary.`

**Implementation steps:**
1. `Define window size and stride.`
2. `Implement the feature set.`
3. `Define the missing-data policy.`
4. `Add quality flags per window.`
5. `Validate baseline versus interference.`
6. `Write the feature dictionary.`
7. `Export the feature dataset.`

**Required tools:** `Python, numpy, pandas, scipy.`

**Expected outputs:** `Feature pipeline; feature dataset; dictionary; effect-size report.`

**Deliverables:** `Pipeline; dataset; report.`

**Acceptance criteria:** `Features are reproducible; missing-data handling is documented; the baseline-versus-interference effect size is reported; the schema matches A1.`

**Validation procedure:** `Rerun on the same capture and diff; manually recompute one window; check schema compatibility.`

**Evidence requirements:** `Diff output; effect-size table; schema check.`

---

#### W4 · Wireless resilience — `checkpoint_4_4` / `task_4_4`

**Assignee:** Yousif · **Priority:** medium (stretch) · **Estimate:** 26 h · **Phase:** 3

**Title:** `NRF24L01 interference experiment inside the shielded enclosure`

**Description:** `Run the NRF24L01 interference experiment inside the shielded enclosure and measure detection accuracy and false alarms versus link quality, with a safety log. This is the proposal's explicit stretch goal and may be cut.`

**Prerequisites:** `W3; E3; enclosure ready; safety approval.`

**Inputs:** `NRF24 rig; RF subset of the scenario pack; detection pipeline.`

**Implementation steps:**
1. `Freeze the protocol: power, distance, duty cycle, and duration.`
2. `Run the full matrix.`
3. `Log link quality and detections per run.`
4. `Compute accuracy and false alarms versus quality with confidence intervals.`
5. `Verify no external emission.`
6. `Write the experiment report.`
7. `State the cut criteria and whether they were met.`

**Required tools:** `NRF24, shielded enclosure, detection stack, Python.`

**Expected outputs:** `Experiment data; curves; safety log; report.`

**Deliverables:** `Experiment report; dataset; safety evidence.`

**Acceptance criteria:** `All runs occur inside the enclosure and are verified; no external signal is detected; results include confidence intervals; stop conditions are honored; if the goal is cut, the decision and evidence are documented.`

**Validation procedure:** `Monitor externally during runs; rerun one matrix point; review the safety log.`

**Evidence requirements:** `Safety log; external monitor capture; results tables.`

---

#### W5 · Wireless integration — `checkpoint_4_5` / `task_4_5`

**Assignee:** Yousif · **Priority:** high · **Estimate:** 20 h · **Phase:** 2

**Title:** `RF and link-quality telemetry integration`

**Description:** `Join RF/link features with network and MQTT events by device and time, expose them to the backend, and surface link quality in the dashboard.`

**Prerequisites:** `W3; N2; B2; F2.`

**Inputs:** `Feature dataset or stream; device identity map; API contract.`

**Implementation steps:**
1. `Define join keys: device_id plus time window.`
2. `Implement the joiner with explicit ambiguity handling.`
3. `Push joined records to the backend.`
4. `Add dashboard tiles for link quality.`
5. `Validate join accuracy on a labeled set.`
6. `Document merge rules; never merge on MAC alone.`
7. `Hand off to integration.`

**Required tools:** `Python, SQL, backend API, dashboard components.`

**Expected outputs:** `Joiner; API payloads; dashboard views; accuracy report.`

**Deliverables:** `Integration v1; validation report; screenshots.`

**Acceptance criteria:** `Join accuracy is at least 99% on the labeled set; no silent identity merge occurs on MAC alone; the dashboard shows link quality next to detections.`

**Validation procedure:** `Run the labeled join test; inspect ambiguous cases; verify dashboard values against the API.`

**Evidence requirements:** `Accuracy report; merge-decision log; screenshots.`


---

### 6.5 Backend Engineering

#### B1 · Backend foundation — `checkpoint_5_1` / `task_5_1`

**Assignee:** Nabil · **Priority:** critical · **Estimate:** 24 h · **Phase:** 1

**Title:** `Platform service skeleton, schema, and access boundaries`

**Description:** `Stand up the platform backend: service skeleton, schema and migrations for devices, events, alerts, incidents, responses, and agents, configuration/secrets handling, health checks, and an OpenAPI contract.`

**Prerequisites:** `None; start of phase 1.`

**Inputs:** `Architecture contracts; event schema v0; deployment target.`

**Implementation steps:**
1. `Choose the stack and record the decision.`
2. `Define the schema and migrations.`
3. `Implement configuration and secret loading.`
4. `Add health and readiness endpoints.`
5. `Publish the OpenAPI contract.`
6. `Write a seed script.`
7. `Add CI for tests and migrations.`

**Required tools:** `FastAPI or Flask or Node, PostgreSQL or SQLite, Alembic, Docker, pytest.`

**Expected outputs:** `Service; migrations; OpenAPI; seed script; CI.`

**Deliverables:** `Backend v0.1; schema documentation; OpenAPI link.`

**Acceptance criteria:** `Migrations run from an empty database; health returns 200; ingest and read paths have distinct access boundaries; the schema is documented.`

**Validation procedure:** `Migrate and seed a clean database; run API smoke tests; check the OpenAPI contract against the implementation.`

**Evidence requirements:** `CI run; migration log; smoke-test output; OpenAPI link.`

---

#### B2 · Data pipelines — `checkpoint_5_2` / `task_5_2`

**Assignee:** Nabil · **Priority:** critical · **Estimate:** 26 h · **Phase:** 2 (schema in 1)

**Title:** `Ingest and normalize MQTT, PCAP/flow, and RF telemetry`

**Description:** `Ingest and normalize MQTT, PCAP/flow, and RF telemetry with deduplication, device enrichment, UTC normalization, retention, and backfill.`

**Prerequisites:** `B1; N2 capture schema; W2 RF schema.`

**Inputs:** `Stream contracts; retention policy; device identity map.`

**Implementation steps:**
1. `Implement one consumer per source.`
2. `Define the canonical event model.`
3. `Define deduplication keys.`
4. `Enrich with device identity.`
5. `Normalize all timestamps to UTC.`
6. `Implement retention and deletion.`
7. `Implement backfill.`

**Required tools:** `Python, MQTT client, optional Redis/NATS, SQL, cron or scheduler.`

**Expected outputs:** `Pipelines; canonical schema; retention and backfill jobs.`

**Deliverables:** `Pipeline v1; runbook; load-test report.`

**Acceptance criteria:** `Sustained ingest at the testbed rate with no loss beyond the budget; duplicates are suppressed; every timestamp is UTC; backfill reproduces counts.`

**Validation procedure:** `Run a load test; inject duplicates; compare backfill counts with the source; inspect time zones.`

**Evidence requirements:** `Metrics; test output; backfill comparison.`

---

#### B3 · Security platform APIs — `checkpoint_5_3` / `task_5_3`

**Assignee:** Nabil · **Priority:** critical · **Estimate:** 26 h · **Phase:** 1–2

**Title:** `Alerts, incidents, devices, responses, and agent APIs`

**Description:** `Expose alerts, incidents, devices, responses, agents, and metrics through REST and streaming APIs with role-based access, pagination, audit, rate limits, and Telegram/webhook notifications.`

**Prerequisites:** `B2; agent tool contracts.`

**Inputs:** `API contract; auth model; notification configuration.`

**Implementation steps:**
1. `Implement the core resources.`
2. `Enforce role-based access.`
3. `Add pagination and filtering.`
4. `Implement the streaming endpoint.`
5. `Write audit records.`
6. `Implement the notifier with retries and idempotency.`
7. `Write contract tests.`

**Required tools:** `FastAPI or Flask, pytest, httpx, Telegram Bot API.`

**Expected outputs:** `Endpoints; contract tests; notifier.`

**Deliverables:** `API v1; documentation; test report.`

**Acceptance criteria:** `Unauthorized access is denied; incident lifecycle transitions are enforced; notifications are idempotent; p95 latency is within budget.`

**Validation procedure:** `Run contract tests; test the authorization matrix; send duplicate events and verify one notification.`

**Evidence requirements:** `Test report; API docs; authorization matrix.`

---

#### B4 · System orchestration — `checkpoint_5_4` / `task_5_4`

**Assignee:** Nabil · **Priority:** high · **Estimate:** 22 h · **Phase:** 2

**Title:** `One-command deployment, backup, and observability`

**Description:** `Package the broker, backend, database, and dashboard with compose, environment templates, backups, logs/metrics, and a runbook for one-command bring-up.`

**Prerequisites:** `B1–B3; F1 shell.`

**Inputs:** `Deployment target (gateway or mini-PC); secrets policy; backup policy.`

**Implementation steps:**
1. `Write Dockerfiles.`
2. `Write the compose stack.`
3. `Create environment templates with no secrets.`
4. `Implement backup and restore.`
5. `Add logging and metrics.`
6. `Write the runbook.`
7. `Add the build to CI.`

**Required tools:** `Docker/compose, systemd, optional Prometheus/Grafana, restic or pg_dump.`

**Expected outputs:** `Compose stack; runbook; CI build; backup scripts.`

**Deliverables:** `Deployable release; restore evidence.`

**Acceptance criteria:** `A clean host comes up with one command; services survive restart; backup restore is verified; health is observable.`

**Validation procedure:** `Provision a clean VM; deploy; restore a backup; restart the host and verify recovery.`

**Evidence requirements:** `Deployment log; restore test; health screenshots.`

---

#### B5 · Deployment and quality — `checkpoint_5_5` / `task_5_5`

**Assignee:** Nabil · **Priority:** high · **Estimate:** 20 h · **Phase:** 2–3

**Title:** `Integration QA, performance, and versioned release`

**Description:** `Run integration QA, performance and load tests, and produce a versioned release with a test plan, known issues, and release notes.`

**Prerequisites:** `B4; F5.`

**Inputs:** `Test plan; service-level objectives; defect log.`

**Implementation steps:**
1. `Write the test plan.`
2. `Automate critical end-to-end paths.`
3. `Run load tests.`
4. `Run authorization and input-validation checks.`
5. `Complete the release checklist.`
6. `Tag the release.`
7. `Publish known issues.`

**Required tools:** `pytest, Playwright, k6 or locust, optional trivy.`

**Expected outputs:** `Test reports; release tag; release notes.`

**Deliverables:** `Release; QA report; known-issues list.`

**Acceptance criteria:** `Critical end-to-end tests pass in CI; the load target is met; no P0 defect is open; the release is reproducible from the tag.`

**Validation procedure:** `Rerun CI on the tag; deploy the release and run the smoke suite.`

**Evidence requirements:** `CI run; load report; release notes; smoke output.`

---

### 6.6 Frontend Engineering

#### F1 · UI foundation — `checkpoint_6_1` / `task_6_1`

**Assignee:** Rozan · **Priority:** critical · **Estimate:** 22 h · **Phase:** 1

**Title:** `SOC dashboard shell, design system, and role-aware navigation`

**Description:** `Build the SOC dashboard shell: routing, design system, authentication, role-aware navigation, loading/error/empty states, and an accessibility baseline.`

**Prerequisites:** `B1 auth contract.`

**Inputs:** `Brand guidelines; API contract; wireframes.`

**Implementation steps:**
1. `Set up the app shell and routing.`
2. `Implement the theme and base components.`
3. `Implement login and role-aware navigation.`
4. `Add loading, error, and empty states.`
5. `Establish the accessibility baseline.`
6. `Add a mock API for parallel work.`
7. `Document components.`

**Required tools:** `React/Next/Vite, TypeScript, testing library, axe.`

**Expected outputs:** `Shell; components; mocks; component documentation.`

**Deliverables:** `UI v0.1; preview build.`

**Acceptance criteria:** `Keyboard navigable; responsive at three breakpoints; no console errors; zero critical axe issues.`

**Validation procedure:** `Run axe; complete a keyboard walkthrough; check three viewport sizes.`

**Evidence requirements:** `Screenshots; axe report; keyboard checklist.`

---

#### F2 · Live monitoring — `checkpoint_6_2` / `task_6_2`

**Assignee:** Rozan · **Priority:** high · **Estimate:** 24 h · **Phase:** 2

**Title:** `Live device and event monitoring with streaming updates`

**Description:** `Implement live device and event monitoring with streaming updates, filters, connection-state handling, and charts.`

**Prerequisites:** `F1; B3 streaming endpoint.`

**Inputs:** `Stream contract; device schema; event schema.`

**Implementation steps:**
1. `Build the device inventory view.`
2. `Connect the live stream.`
3. `Add filters.`
4. `Implement reconnect and backoff.`
5. `Add charts.`
6. `Add stale-data indicators.`
7. `Load-test the view.`

**Required tools:** `React, WebSocket/SSE, chart library.`

**Expected outputs:** `Views; hooks; tests.`

**Deliverables:** `Live monitoring module; test evidence.`

**Acceptance criteria:** `Updates appear within two seconds; reconnect works after a drop; stale data is clearly indicated; the view is stable at five devices and ten events per second.`

**Validation procedure:** `Throttle and kill the stream; reconnect; run the load scenario.`

**Evidence requirements:** `Recordings; test output; load results.`

---

#### F3 · Security operations — `checkpoint_6_3` / `task_6_3`

**Assignee:** Rozan · **Priority:** high · **Estimate:** 26 h · **Phase:** 2

**Title:** `Alert triage and incident investigation UI`

**Description:** `Build alert triage and incident investigation: queue, evidence-linked detail, timeline, response actions with confirmation, and an audit view.`

**Prerequisites:** `F2; B3; E4; A3.`

**Inputs:** `Alert and incident contracts; policy catalog; audit schema.`

**Implementation steps:**
1. `Build the alert queue.`
2. `Build the detail view with evidence links.`
3. `Render the incident timeline.`
4. `Add the response action panel.`
5. `Require confirmation for destructive actions.`
6. `Add the audit view.`
7. `Enforce permissions in the UI.`

**Required tools:** `React, API client, testing library.`

**Expected outputs:** `Triage and investigation UI; UX notes; tests.`

**Deliverables:** `Security operations module; walkthrough recording.`

**Acceptance criteria:** `An analyst can go alert → incident → response in five clicks or fewer; destructive actions require confirmation; UI permissions match API permissions.`

**Validation procedure:** `Run the scripted analyst walkthrough; test with a member account and confirm denied actions.`

**Evidence requirements:** `Recording; click count; permission test.`

---

#### F4 · Analytics and reporting — `checkpoint_6_4` / `task_6_4`

**Assignee:** Rozan · **Priority:** high · **Estimate:** 20 h · **Phase:** 2–3

**Title:** `Detection and response metrics, reports, and export`

**Description:** `Add detection and response KPIs, charts, incident reports, CSV/PDF export, and the case-study view.`

**Prerequisites:** `F3; B3 metrics.`

**Inputs:** `Metric definitions; report template; export requirements.`

**Implementation steps:**
1. `Add KPI cards.`
2. `Add charts.`
3. `Build the incident report view.`
4. `Implement CSV and PDF export.`
5. `Build the case-study page.`
6. `Reconcile numbers with the backend.`
7. `Document the metrics.`

**Required tools:** `React, chart library, CSV/PDF libraries.`

**Expected outputs:** `Analytics views; exports; metric documentation.`

**Deliverables:** `Reporting module; reconciliation table.`

**Acceptance criteria:** `Displayed numbers reconcile with backend aggregates; exports are reproducible; reports include methodology and limitations.`

**Validation procedure:** `Compare UI values with API aggregates; export and diff two runs.`

**Evidence requirements:** `Screenshots; reconciliation table; export samples.`

---

#### F5 · Interface validation — `checkpoint_6_5` / `task_6_5`

**Assignee:** Rozan · **Priority:** high · **Estimate:** 16 h · **Phase:** 3

**Title:** `Usability and interface acceptance testing`

**Description:** `Run task-based usability and interface acceptance sessions, fix defects, and produce the UI acceptance report.`

**Prerequisites:** `F4.`

**Inputs:** `Task list; five participants; accessibility checklist.`

**Implementation steps:**
1. `Write the test protocol.`
2. `Run the sessions.`
3. `Maintain the defect log.`
4. `Fix Sev-1 and Sev-2 defects.`
5. `Re-test.`
6. `Recheck accessibility.`
7. `Write the acceptance report.`

**Required tools:** `Screen recording, SUS/SEQ questionnaire, axe.`

**Expected outputs:** `Findings; fixes; acceptance report.`

**Deliverables:** `UI acceptance report; defect log.`

**Acceptance criteria:** `All critical tasks are completed without assistance; no Sev-1 UI defect remains; the accessibility recheck passes.`

**Validation procedure:** `Rerun the sessions with two users after fixes; compare task success and time.`

**Evidence requirements:** `Recordings; defect log; scores.`


---

## 7. Cross-cutting tasks to create separately

The 30 linked tasks cover the checkpoint gates. The following work is real but has no checkpoint, so create it as ordinary tasks (**Define new task**). They will appear on the board and in planning but will not gate any checkpoint.

| ID | Title | Assignee | Priority | Estimate | Acceptance (short) |
|---|---|---|---:|---:|---|
| X1 | Architecture decision records and interface control | Mostafa | high | 12 h | Every cross-team interface has a versioned ADR; changes are approved and recorded. |
| X2 | Weekly integration review and risk register | Mostafa | high | 20 h | One review per week with decisions, owners, and dates; risk register current. |
| X3 | Safety, ethics, and NTRA compliance dossier | Khamis | critical | 10 h | RF confinement, authorized-target policy, and data-handling rules documented and approved. |
| X4 | Procurement and hardware bring-up log | Wessam | high | 12 h | Every component received, labeled, tested, and mapped to a task. |
| X5 | Dataset release package and reproducibility kit | Khamis | medium | 10 h | A third party can reproduce the dataset build from the README and hashes. |
| X6 | Final report: architecture and security chapters | Mostafa | critical | 16 h | Chapters match the implemented system and cite evidence. |
| X7 | Final report: testbed and RF chapters | Yousif | high | 14 h | Chapters match the measurements and safety constraints. |
| X8 | Final report: platform and dashboard chapters | Rozan | high | 14 h | Chapters match the deployed UI and API behavior. |

Create these **after** the 30 edits. If you create them first, the board becomes noisy and the checkpoint-linked tasks are harder to find.

Suggested descriptions and validation text can be short; the acceptance column above is enough to satisfy the create form (acceptance and validation each need at least 10 characters).

---

## 8. Dependencies and critical path

### 8.1 Hard dependencies

| Work package | Depends on | Why |
|---|---|---|
| E1 Embedded foundation | N1 lab network (partial), hardware | Devices need an AP and broker to publish. |
| E2 Device security | E1, N3 auth design | Identity must exist before broker ACLs can be per-device. |
| E3 Hybrid IDS | A1 schema, A2 model, N2 telemetry, E2 identity | Fusion consumes features, model scores, and flow data. |
| E4 Response | E3 alerts, N3 controls, B3 incident API | No alert, no action; no control, no actuator. |
| E5 Final integration | E3, E4, A3, A4, B3, F3, N5 | It is the integration gate. |
| A1 Dataset | None | Phase-1 start. |
| A2 ML IDS | A1 | Training data and schema. |
| A3 Defense agent | E3, B3, A1 | Needs alerts, APIs, and event schema. |
| A4 Attack agent | N4 scripts, N1 isolation | Needs a safe, isolated target set. |
| A5 Evaluation | A2, E3, A3, A4, lab data | Compares all methods and agents. |
| N1 Network | Hardware | Physical prerequisite. |
| N2 Visibility | N1, B2 contract | Capture needs a network and an ingest target. |
| N3 Network security | N1, E2 identity | TLS/ACL depend on identity. |
| N4 Scenarios | N3, E1 | Scenarios need hardened, reachable devices. |
| N5 Network defense | N4, E3, E4 | Rules and containment need scenarios and response. |
| W1 Wireless foundation | Hardware, safety approval | Physical and regulatory prerequisite. |
| W2 Data collection | W1, N2 time sync | Measurement needs calibration and UTC. |
| W3 Features | W2, A1 schema | Features feed the shared schema. |
| W4 Resilience | W3, E3, enclosure | Detection must exist before degradation can be measured. |
| W5 Wireless integration | W3, N2, B2, F2 | Join and display need all four. |
| B1 Backend | None | Phase-1 start. |
| B2 Pipelines | B1, N2, W2 | Sources must exist. |
| B3 APIs | B2, agent contracts | Data and contracts must exist. |
| B4 Orchestration | B1–B3, F1 | Needs services and a shell. |
| B5 QA/release | B4, F5 | Release after UI acceptance. |
| F1 UI shell | B1 auth | Login and roles. |
| F2 Live monitoring | F1, B3 stream | Needs the stream. |
| F3 Security operations | F2, B3, E4, A3 | Needs alerts, incidents, and response API. |
| F4 Analytics | F3, B3 metrics | Needs data and incidents. |
| F5 Interface validation | F4 | Final UI. |

### 8.2 Critical path

`Hardware → N1 → E1 → E2 → E3 → E4 → E5`, with two parallel feeders:

- **Data/ML feeder:** `A1 → A2 → A3/A4 → A5`, which needs `B3` for storage and APIs.
- **Platform feeder:** `B1 → B2 → B3`, which needs `N2` and `W2` for telemetry.

`F1 → F2 → F3 → F4 → F5` runs in parallel but `F3` cannot finish before `E4` and `B3`.

**Earliest demo-ready point:** E5 plus F3 plus B4. Everything else strengthens the evaluation but is not required for a minimal end-to-end demo.

### 8.3 Merge points (interface freezes)

| Freeze | Owner | Consumers | Artifact |
|---|---|---|---|
| Event schema v1 | Nabil | Khamis, Mostafa, Yousif | JSON schema + sample payloads |
| Alert schema v1 | Mostafa | Nabil, Rozan, A3 | fields, confidence, evidence, explanation |
| Device identity map | Wessam | Mostafa, Khamis, Yousif, Nabil | device_id, MAC, IP, topic prefix |
| Response policy catalog | Mostafa | Khamis, Nabil, Rozan | action, scope, duration, rollback |
| Agent tool contract | Mostafa | Nabil | tool names, inputs, outputs, limits |
| Scenario label set | Khamis | A5, E5, F4 | scenario_id, expected alerts, labels |

Freeze each artifact once, version it, and record the version in the dependent task. Uncontrolled schema drift is the most likely cause of integration failure in a six-person project.

---

## 9. Phase plan aligned with the proposal

The proposal deliberately sequences **software first** so a hardware or enclosure delay cannot block the core contribution. Apply that to the task set:

### Phase 1 — Software core on public data and simulated traffic

**Goal:** detection, agents, response logic, backend, and dashboard work without physical hardware.

- Mostafa: E2 design, E3 on simulated traffic, E4 dry-run, A3/A4 on simulated incidents.
- Khamis: A1, A2, A5 harness skeleton, N3 configuration draft, N4 script authoring.
- Wessam: procurement, N1 design, E1 firmware skeleton on the bench.
- Yousif: W1 methodology, W2 collector prototype, W3 feature code on synthetic captures.
- Nabil: B1, B2 schema, B3 APIs with synthetic data.
- Rozan: F1, F2 with mock/streamed data.

**Exit gate:** a reproducible simulated incident flows from alert to dashboard and produces a dry-run response recommendation; CICIoT2023 baseline metrics exist.

### Phase 2 — Physical testbed and lab-collected data

**Goal:** the same pipeline runs on real ESP32 traffic and real attacks.

- Wessam: E1 complete, N1 complete, N2 complete.
- Mostafa: E2 implementation, E3 on lab data, E4 live, A3/A4 live, E5 first pass.
- Khamis: N3 validation, N4 execution, N5, A5 lab evaluation.
- Yousif: W2, W3, W5; W4 preparation.
- Nabil: B2 with real telemetry, B3 complete, B4.
- Rozan: F2 live, F3, F4.

**Exit gate:** at least five scenarios run end to end on real hardware; lab-versus-public detection gap measured; demo runs without manual data injection.

### Phase 3 — RF resilience (stretch) and hardening

**Goal:** measure detection degradation under controlled interference, then freeze the release.

- Yousif: W4, with safety oversight.
- Khamis: A5 final analysis; N5 coverage closure.
- Mostafa: E5 final acceptance; residual-risk register.
- Nabil: B5 release; Rozan: F5 acceptance.
- All: report chapters (X6–X8).

**Exit gate:** release candidate tagged; report evidence complete; demo rehearsed; stretch goal either measured or formally cut with evidence.

**Sequencing note:** the workspace has start/due fields on every task. Set dates only after confirming the exam schedule. Use the estimates above to compute load per person per week; the six packages deliberately total roughly 100–140 hours per member plus the cross-cutting tasks, which is realistic for a two-semester graduation project but not for a single month.

---

## 10. Risks in this assignment plan

| Risk | Impact | Mitigation |
|---|---|---|
| Co-admin grant to Khamis is broader than review authority | He can manage users and roles | Deliberate four-eyes control; document it; revert after defense if desired. |
| Checkpoint labels cannot be renamed | Some labels are broader than the actual package (e.g., "Embedded foundation") | The task title and description carry the precise scope; the checkpoint is the gate, not the specification. |
| Moving a checkpoint without its task | New owner cannot submit the checkpoint (`TASKS_INCOMPLETE`) | Always select both, as listed in §4.1; verify counts after each move. |
| Archiving a seeded task | Checkpoint cannot be submitted again through the UI | Never archive the 30 linked tasks; edit them. |
| New tasks do not gate checkpoints | Work can look complete on the board while the gate is not | Keep the 30 linked tasks as the source of truth for gates; extras are supplementary. |
| Single reviewer if co-admin is refused | Mostafa's six checkpoints cannot be approved | Accept co-admin or accept untracked lead work; do not fake approvals. |
| Wessam's three checkpoints look light | Perceived imbalance | Communicate that E1/N1/N2 are the physical spine; their estimates and dependencies are the heaviest per checkpoint. |
| Domain chip shows one domain per member | Cosmetic confusion | Explain that domains are areas; the member page's chip is derived from one checkpoint. |
| Too many parallel schema changes | Integration failures late | Enforce the six freezes in §8.3 with versioned artifacts. |
| RF experiment scope creep | Regulatory and safety risk | W4 is explicitly stretch; enclosure and safety approval are prerequisites; cut criteria are written before starting. |


---

## 11. Execution runbook — apply this in the workspace

Do these steps in order. The whole sequence is UI-only; no deployment, migration, or code change is required.

### Step 0 — Preconditions

- [ ] Six member accounts and the supervisor account are `active`.
- [ ] You are logged in as `mostafa@cerberus.local` (`super_admin`).
- [ ] The repo is clean at `fe25862`; this document is the only new file.
- [ ] You have the proposal open for reference.

### Step 1 — Profiles and names (7 edits)

Members → select member → **Edit profile** → set the values from §3.

1. Mostafa: specialization and bio.
2. Khamis: specialization and bio.
3. Wessam: specialization **and** bio (the AI/ML wording must go).
4. Yousif: specialization and bio; decide `Yousif` vs `Youssef` and use it everywhere.
5. Nabil: specialization and bio.
6. Rozan: specialization and bio; decide `Rozan` vs `Rozen` and use it everywhere.
7. Supervisor: display name `Dr. Mai Shahin`, specialization `Academic Supervision`, bio from §3.7.

Do **not** change the supervisor's role. Do **not** add `team_member` to her.

### Step 2 — Add the reviewer role

Members → select Khamis → roles → keep `team_member`, add `super_admin` → save.

Verify: Khamis's role list shows both; the review queue becomes reachable for him.

If the team rejects co-admin, stop here and decide the alternative in §5 before continuing.

### Step 3 — The four ownership moves

For each move: Members → select the **source** member → **Reassign work** → choose the target → tick the listed checkpoints **and** their tasks → **Transfer selected work** → confirm the toast shows the expected counts.

**M1 — Wessam → Khamis**

- Checkpoints: `AI and data foundation`, `Machine-learning IDS`, `Model and agent evaluation`.
- Tasks: `Deliver AI and data foundation`, `Deliver Machine-learning IDS`, `Deliver Model and agent evaluation`.
- Expected toast: 3 tasks and 3 checkpoints.

**M2 — Wessam → Mostafa**

- Checkpoints: `Digital forensics agent`, `Adversarial validation agent`.
- Tasks: `Deliver Digital forensics agent`, `Deliver Adversarial validation agent`.
- Expected toast: 2 tasks and 2 checkpoints.

**M3 — Mostafa → Wessam**

- Checkpoint: `Embedded foundation`.
- Task: `Deliver Embedded foundation`.
- Expected toast: 1 task and 1 checkpoint.

**M4 — Khamis → Wessam**

- Checkpoints: `Network foundation`, `Network visibility`.
- Tasks: `Deliver Network foundation`, `Deliver Network visibility`.
- Expected toast: 2 tasks and 2 checkpoints.

**After all four:** Wessam 3, Mostafa 6, Khamis 6, Yousif 5, Nabil 5, Rozan 5.

If a toast count differs, stop and inspect the member's roadmap before continuing. The most common error is selecting a checkpoint but not its task.

### Step 4 — Rewrite the 30 linked tasks

Tasks → open a task → **Edit**. For each `task_*` in §6:

1. Confirm the assignee matches the target owner.
2. Replace the title, description, priority.
3. Fill implementation steps, deliverables, prerequisites, inputs, required tools, expected outputs.
4. Fill acceptance criteria, validation procedure, evidence requirements.
5. Set estimate hours and, if dates are agreed, start/due dates.
6. Save and confirm the task remains linked to its checkpoint (the checkpoint card should still list one task).

Work domain by domain so you can verify each owner's set before moving on. Do not create new tasks in this step.

**Bulk workload warning:** 30 tasks × 12 fields is several hours of UI work. Do it in four sittings (Embedded+AI, Networking+Wireless, Backend+Frontend, review pass). Keep this document open beside the browser; copy field by field.

### Step 5 — Create the eight cross-cutting tasks

Tasks → **Define new task** for X1–X8 in §7. The create form only takes title, assignee, priority, description, acceptance, validation, and evidence. Create each one with those fields, then open it → **Edit** to set the estimate, and add the short implementation note from the table. Leave them unlinked; they are supplementary.

### Step 6 — Set dates and estimates (optional but recommended)

Only after the exam schedule is confirmed. Use §9 to derive week windows, then set start/due per task. Keep the estimate values from §6; they are the basis for workload balance and for the report's effort table.

### Step 7 — First review cycle

1. Each member marks their first task `in_progress` when they start.
2. On completion, the assignee submits the task with a summary and evidence.
3. The reviewer (Khamis for Mostafa's tasks, Mostafa for everyone else's) approves or requests changes with rubric scores.
4. When all tasks under a checkpoint are approved, the checkpoint owner submits the checkpoint with consolidated evidence.
5. The other admin approves the checkpoint.

Do not approve your own submission; the workspace blocks it and the audit trail records the attempt.

---

## 12. Verification checklist

### In the UI

- [ ] Members list: six members plus `Dr. Mai Shahin`; Khamis shows `team_member` + `super_admin`; supervisor shows `project_supervisor`.
- [ ] Each member's roadmap shows the expected checkpoint count: Mostafa 6, Khamis 6, Wessam 3, Yousif 5, Nabil 5, Rozan 5.
- [ ] Each checkpoint card shows exactly one linked task.
- [ ] Tasks board: 30 linked tasks plus 8 cross-cutting tasks; no seeded task archived.
- [ ] Each task's assignee matches §4.2.
- [ ] No task still carries the generated text "Implement the scoped ... work for ...".
- [ ] Reports → member progress shows non-zero checkpoint totals for all six members.

### Optional read-only SQL verification

Run from the repo with Wrangler; these statements only read.

```sql
SELECT u.display_name, COUNT(c.id) AS checkpoints
FROM users u
LEFT JOIN checkpoints c ON c.owner_id = u.id AND c.archived_at IS NULL
WHERE u.archived_at IS NULL
GROUP BY u.id
ORDER BY u.display_name;
```

```sql
SELECT c.title AS checkpoint, u.display_name AS owner, t.title AS task, t.assignee_id = c.owner_id AS aligned
FROM checkpoints c
JOIN checkpoint_tasks ct ON ct.checkpoint_id = c.id
JOIN tasks t ON t.id = ct.task_id
JOIN users u ON u.id = c.owner_id
WHERE c.archived_at IS NULL
ORDER BY c.title;
```

`aligned` must be `1` for all 30 rows. A `0` means the checkpoint moved without its task.

```sql
SELECT COUNT(*) AS tasks, SUM(CASE WHEN title LIKE 'Deliver %' THEN 1 ELSE 0 END) AS still_generated
FROM tasks
WHERE archived_at IS NULL;
```

`still_generated` must be `0` after step 4.

---

## 13. What this plan deliberately does not do

- **No domain or milestone rename.** The workspace has no route for it; the proposal's sub-team names live in this document and in member specializations.
- **No new role or permission editor.** The only reachable four-eyes fix is the co-admin grant; inventing a reviewer role would be a feature.
- **No task-to-checkpoint linking UI.** The 30 seeded links are preserved by editing in place; new tasks remain supplementary.
- **No change to acceptance authority for the supervisor.** She remains read-only with written feedback, as the proposal and the workspace role intend.
- **No claim that any of this is applied.** Production is unchanged until you execute §11.

---

## Appendix A — Assignment card (one row per person)

| Member | Checkpoints | Tasks to edit | Extras to create |
|---|---|---|---|
| Mostafa | Device security · Hybrid IDS · Response orchestration · Final security integration · Digital forensics agent · Adversarial validation agent | `task_1_2`, `task_1_3`, `task_1_4`, `task_1_5`, `task_2_3`, `task_2_4` | X1, X2, X6 |
| Khamis | AI and data foundation · Machine-learning IDS · Model and agent evaluation · Network security · Controlled security scenarios · Network defense | `task_2_1`, `task_2_2`, `task_2_5`, `task_3_3`, `task_3_4`, `task_3_5` | X3, X5 |
| Wessam | Embedded foundation · Network foundation · Network visibility | `task_1_1`, `task_3_1`, `task_3_2` | X4 |
| Yousif | Wireless foundation · Wireless data collection · Feature extraction · Wireless resilience · Wireless integration | `task_4_1`–`task_4_5` | X7 |
| Nabil | Backend foundation · Data pipelines · Security platform APIs · System orchestration · Deployment and quality | `task_5_1`–`task_5_5` | — |
| Rozan | UI foundation · Live monitoring · Security operations · Analytics and reporting · Interface validation | `task_6_1`–`task_6_5` | X8 |

## Appendix B — Glossary

- **Checkpoint:** a milestone-level gate with one owner, one linked task per seed, and an approval record. Cannot be renamed in the current UI.
- **Task:** the reviewable unit of work. The 30 seeded tasks are the only ones linked to checkpoints.
- **Gate:** the rule that a checkpoint cannot be submitted until all its non-archived linked tasks are `approved`.
- **Four-eyes review:** the submitter cannot approve their own work; a second admin must review.
- **Dry-run:** executing the response decision without touching the network, used in phase 1.
- **Scope locking:** enforcing an allowlist of targets and actions for the attack agent.
- **Stretch goal:** the RF resilience experiment (W4), which can be cut without touching the core contribution.

## Appendix C — Source facts used

- Production users and roles: 7 active accounts, one `super_admin` (Mostafa), five `team_member`, one `project_supervisor`; only `super_admin` holds `review.admin`.
- Domains: 6; checkpoints: 30; tasks: 30; `checkpoint_tasks`: 30 rows; each checkpoint has exactly one linked task.
- Current ownership: Mostafa 5 (Embedded), Wessam 5 (AI), Khamis 5 (Networking), Yousif 5 (Wireless), Nabil 5 (Backend), Rozan 5 (Frontend).
- Proposal: three sub-teams of two under one technical lead; five-layer architecture; three build phases with RF resilience as a stretch goal; supervisor Dr. Mai Shahin.


