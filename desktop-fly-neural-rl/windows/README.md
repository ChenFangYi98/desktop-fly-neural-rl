# DesktopFly for Windows

The Windows port of DesktopFly: the same 3D fruit fly on a transparent
desktop overlay, driven by the same 1 kHz leaky-integrate-and-fire simulation
of 668 real brain neurons from the FlyWire connectome (FAFB v783), coupled
to a walking circuit extracted from the MaleCNS brain-and-nerve-cord dataset.

The brain, nerve cord, and leg mechanics mirror the Swift implementation.
Walking uses six sets of antagonist motor outputs, articulated legs, foot
contact and load feedback. Grounded foot motion supplies body translation
and yaw. The whole feedback loop runs at a fixed 120 Hz, so 60 Hz and 120 Hz
displays produce the same simulation. The legacy body path remains available for old bundles and extra
flies without a simulated brain.

The extracted anatomy and synapse counts are measured data. Coupling the
female FlyWire brain to the male circuit by descending-neuron type, neuron
dynamics, muscle actuation, rhythm generation and body mechanics are modeling
assumptions, not a measured complete digital fly. The brain window still
shows the FlyWire brain rather than the separate MaleCNS nerve-cord network.

## Why a port and not a rebuild

macOS DesktopFly links `Cocoa` and `SceneKit`, neither of which exists on
Windows — the open-source Swift toolchain ships only stdlib, Foundation,
Dispatch and WinSDK. Everything that draws or touches the system had to be
rewritten; everything that computes came over unchanged in behavior.

| macOS | Windows |
|---|---|
| SceneKit | three.js (WebGL) |
| AppKit `NSPanel`, borderless + `ignoresMouseEvents` | Electron `BrowserWindow`, `transparent` + `setIgnoreMouseEvents` |
| `NSStatusItem` menu bar | `Tray` |
| `CGWindowListCopyWindowInfo` | `EnumWindows` + `DwmGetWindowAttribute` via koffi |
| `NSEvent` global mouse monitor | `GetAsyncKeyState(VK_LBUTTON/VK_RBUTTON)` |
| `CGEventSource` idle | `powerMonitor.getSystemIdleTime()` |
| `ProcessInfo.thermalState` | CPU load (no Windows equivalent without vendor drivers) |
| one `NSScreen`, hop via menu | one overlay across the whole virtual desktop |

## Run

For the normal user-facing laboratory mode, double-click
`../一键启动果蝇实验室.vbs`. It keeps the transparent desktop-pet overlay
hidden while the same neural renderer continues running in the background.
The tray menu can show it again on demand.

```sh
npm install
npm start              # tray icon; quit from there
npm run simtest        # circuit invariants (MUST pass after sim changes)
npm run behaviortest   # existing end-to-end brain -> behavior checks
npm run locomotortest  # MaleCNS causal paths, joints, contact, steering and reverse
npm test               # all core suites, including connectome neural RL
npm run ecosystemsmoke # ecology page -> verify standalone training entry
npm run trainingpagesmoke # real training page -> run and verify a policy
```

## Connectome reinforcement learning

The independent training page now uses the loaded FlyWire circuit instead of a
tabular policy. Environment observations enter explicit sensory adapters,
activity propagates through an aggregate of all 18,968 signed circuit edges,
and the policy/value heads can read only descending-neuron populations. Reward
produces a TD dopamine signal. That signal multiplies local eligibility traces
to update bounded population-shared synaptic gains, following the three-factor
learning design used by FlyDoom. Connectome A2C and clipped PPO readout modes
use the same neural path and retain this local plasticity.

An exported model contains a circuit fingerprint, changed synaptic-group gains,
descending readout weights and the complete world/reward specification. Ecology
deployment verifies the fingerprint, maps each learned gain back onto the exact
LIF edges, and attaches that LIF + MaleCNS runtime to the selected fly. A
deployed policy is not allowed to set body speed or heading directly: sensory
input, descending activity, MaleCNS motor output and body mechanics form the
execution path. The assumptions are explicit: the environment-to-sensory
adapter, population-shared plasticity and neuronal dynamics are engineered and
are not measured learning physiology from a living fly.

## Ecology lab

The ecology and neural views now form one combined observation project. The
left side shows the complete habitat, the upper-right view is a live camera
aligned with fly #1's heading, and the lower-right view renders the real-time
LIF activity of that exact same actor. Each ecology fly owns independent brain
state; if fly #1 is removed, both the camera and neural view follow the new
first actor. The highlighted ring and translucent wedge in the habitat show
which fly is being followed and the direction it can see.

- Choose a frog, spider, mantis, banana, apple, or sugar drop, then click the
  left habitat view to place it.
- Food attracts nearby flies. When a fly reaches it, the fly stops to feed and
  the food is gradually consumed.
- Predators roam and pursue nearby flies. A close predator triggers an escape
  flight, which is also visible through the fly-view camera.
- Click a predator or press **Tab** to take control. Use **WASD** to move,
  **Shift** to sprint, and **Space** (or the Hunt button) to attack. A close,
  correctly timed attack removes the captured fly and increases the hunt count.
- The Chinese "fly thought translator" turns the followed fly's current
  stimulus and behavior into a first-person sentence. It is explicitly a model
  interpretation of observable state, not a measurement of subjective thought.
- Use **Add Fly**, **Pause**, and **Clear placed objects** to change or reset
  the experiment. The mouse wheel zooms the habitat overview.
- Closing the lab hides it. Reopen it from the tray menu with
  **打开/隐藏生态观察室**.

## Embodied intelligence training center

The standalone training center gathers embodied neural-policy experiments in
one window. It provides an editable Three.js 3D environment plus task presets
and three neural learning modes: biologically inspired three-factor learning,
Connectome A2C and Connectome PPO. Every experiment can configure observations,
actions, arbitrary reward rules, termination conditions, learning rate,
discount, exploration, episode budget and random seed. Runs export a JSON
manifest containing the neural plasticity, policy, results and configuration.

Use the 3D scene toolbar to place or remove obstacles and hazard cells, move
the start and target, and change the world dimensions. The exported package
preserves this map, its real-world cell resolution, domain-randomization
settings and robot action mapping. A generic safety-gated ROS 2 runtime lives
at `deploy/ros2_policy_node.py`; configure its pose, laser scan, velocity and
emergency-stop topics in the training center before export. Real hardware must
still be calibrated and validated at low speed in a closed test area.

Measured topology and synapse signs remain fixed; bounded gain factors on those
edges are trainable and are restored during deployment. Use the ecology or
neural window header, or the tray menu, to open the training center.

## Separate project launchers

- `../启动生态大脑观察.cmd` launches only the combined ecology,
  first-person and neural-activity project.
- `../启动具身训练中心.cmd` launches only the 3D training and
  deployment project.
- The original one-click launcher now opens the combined observation project
  for compatibility. The two projects use different Electron user-data roots
  and can run at the same time.

`DESKTOPFLY_DEBUG=1 npm start` logs window terrain, overlay geometry and
renderer console output to stderr.

The suites run on bare Node — three.js builds the fly's scene graph headlessly,
so behavior is testable without a GPU.

## What the fly senses

Everything is poll-only and needs no permission dialog. As on macOS, the fly
learns *when* things happen, never *what*:

- **Cursor** — position and velocity become a looming stimulus, split between
  the two eyes by bearing, fed to 314 LC4/LPLC2 neurons. A lunge drives the
  DNp01 giant fiber and the fly takes off ~4 ms later. Fast motion nearby is
  an air puff on the sensory pathway.
- **Clicks** — a global mouse-button press is a tap on the fly's substrate,
  stimulating sensory neurons with a strength that falls off with distance.
- **Windows** — top edges of real windows are walkable ledges; a window
  appearing near the fly is a looming object. Only geometry is read: the
  pixels underneath the fly are never sampled.
- **Typing** — the system idle timer says an input device was touched; if the
  cursor did not move and no button went down, that was the keyboard. No key
  is ever polled individually.
- **Clock and CPU load** — circadian activity curve and an ectotherm's tempo.

## Multi-monitor

The overlay spans the union of all displays, so walking and flying between
monitors is ordinary movement rather than a mode switch. Displays are passed
into the scene as rects, so the fly never targets the dead corners of a
non-rectangular layout. "Send Fly to Next Display" in the tray menu nudges it
across on demand.

Windows clamps a fixed-size window to one monitor's work area, which would
leave the scene believing it is wider than the window really is — the fly then
walks into coordinates that are not on screen and appears to vanish. The
overlay therefore stays resizable and the scene is always told the window's
*actual* bounds.

## Known limits

- Windows does not composite overlays above **exclusive**-fullscreen apps; the
  fly is hidden there. Borderless fullscreen is fine.
- `koffi` provides the Win32 calls. Without it the fly still runs, but loses
  window ledges and click taps (a warning is printed on startup).

## Layout

| file | contents |
|---|---|
| `main.js` | Electron main: overlay + brain windows, tray, environment senses |
| `preload.mjs` | the only main↔renderer bridge |
| `renderer/overlay.js` | `buildScene` + `Coordinator` from `main.swift` |
| `renderer/brain.js` | port of `BrainView.swift` |
| `src/skilltrainer.js` | bounded reward learner for documented trigger-to-neural-action skills |
| `src/obstacletrainer.js` | Q-learning obstacle-course policy and evaluation |
| `src/sim.js` | port of `Sim.swift` (`LIFSim`, `SpikeBus`, `BrainSignals`) |
| `src/flymodel.js` | port of `FlyModel.swift` (body geometry + behavior) |
| `src/locomotor.js` | MaleCNS nerve-cord simulation and motor readout |
| `src/legdynamics.js` | articulated leg mechanics and ground contact |
| `src/signals.js` | port of `SignalBuilder` |
| `src/win32.js` | user32/dwmapi through koffi |
| `src/environment.js` | circadian curve, CPU-load tempo |
| `src/data.js` | Node-only JSON loading (kept out of `sim.js` for the renderer) |
| `test/` | circuit, behavior, locomotor and skill-training suites |

Data comes from `../data/`: `brain_points.json`, `circuit.json`, and
`locomotor_circuit.json`. Source URLs, releases, extraction details and
limitations for the new circuit are recorded in its metadata,
[`LOCOMOTOR_PROVENANCE.md`](../data/LOCOMOTOR_PROVENANCE.md), and the root README. Old bundles without the locomotor file retain legacy walking;
a malformed locomotor file is an explicit load error.
