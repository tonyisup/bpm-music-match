# Gate 1 Android evidence manifest

This directory preserves the user-supplied Android Chrome screenshots used to adjudicate Gate 1.

## Tested identity

- Device: Pixel 8 Pro
- Android: 16 (`CP1A.260505.005`)
- Chrome: `150.0.7871.181`
- Tested/deployed commit: `11df30f6f6cf90940bee425847614abaf26cc6f1`
- Asset ID: `gate-track-v1`
- Asset SHA-256: `d8be8fdd4f5f1d3222c5df86f15fb509d1844c40b40450fc738f2bef812d0033`
- Calibration: `trackTrim=0.7`, `percussionTrim=0.35`, `masterGain=0.8`

## Files

| File | Purpose | SHA-256 |
| --- | --- | --- |
| `calibration-50-complete.png` | 50% volume calibration natural completion | `7596be5afb4c63a6df333f864f69c598f8f25d73e04d4cbde0534c77ac26b154` |
| `trial-1-complete.png` | 100% volume complete-playback terminal diagnostics | `f2f864356aa9132e47f3baf847487f7b4ceaa183aef188906ae68b81a8b6ba1a` |
| `trial-2-ready.png` | Manual-Stop trial Ready identity and calibration | `c03497aa4a71e6609da03ac9aded78e45b69d317486fbdf7034381b8823a9363` |
| `trial-2-stopped.png` | Manual-Stop terminal diagnostics | `c6b14fd9d83c6a8ffd638ab40025980fbaf4bbd6676cbe237c265a7f8aeeb1b1` |
| `trial-3-interrupted.png` | Foreground-loss terminal diagnostics | `fef37a95bd598a65e1c689de63fb23395510f445c683b0956ffc562832f5e1b2` |
| `trial-3-reloaded-ready.png` | Ready identity supplied after the interruption trial | `c03497aa4a71e6609da03ac9aded78e45b69d317486fbdf7034381b8823a9363` |

## Provenance limitation

`trial-3-reloaded-ready.png` is byte-identical to `trial-2-ready.png`. This is possible because the static Ready UI has no visible dynamic timestamp, but the PNG alone cannot independently prove when it was captured. It is retained as user-supplied post-trial context, not treated as timestamp evidence. The distinct Trial 3 terminal screenshot proves the executed build identity, typed `hidden` interruption, zero active sources, settled teardown, closed context, and no runtime error.

The qualitative observations were user-reported and are recorded in `../gate-1.md`; screenshots do not independently prove subjective audio quality.
