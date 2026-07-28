function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

// Reviewed data-only serial traces. Callback ownership, deadlines, and source IDs are fixed
// literals; this module deliberately does not import or execute the reducer under test.
export const REPLAY_CASES = deepFreeze([
  {
    "name": "center-match",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 13.081818181818182,
        "audioNow": 13.081818181818182,
        "outputSampleRate": 48000
      }
    ],
    "expected": {
      "finalPhase": "handoff",
      "terminalCause": null,
      "actualClass": "CENTER",
      "assignedClassMatched": true,
      "requiredEffectTypes": [
        "commit-handoff-plan"
      ],
      "traceSha256": "f6ce1eaca5d0ee18311241ca1865cd733c404f21973f3f82f4bde75b14c8ab30",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        }
      ]
    }
  },
  {
    "name": "low-edge-match",
    "runValue": "session-1",
    "thermalState": "warmed",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1558.139534883721,
        "observedNowMs": 1558.139534883721,
        "mappedTapAudioTime": 10.55813953488372,
        "audioNow": 10.55813953488372,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2116.279069767442,
        "observedNowMs": 2116.279069767442,
        "mappedTapAudioTime": 11.116279069767442,
        "audioNow": 11.116279069767442,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2674.4186046511627,
        "observedNowMs": 2674.4186046511627,
        "mappedTapAudioTime": 11.674418604651162,
        "audioNow": 11.674418604651162,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3232.5581395348836,
        "observedNowMs": 3232.5581395348836,
        "mappedTapAudioTime": 12.232558139534884,
        "audioNow": 12.232558139534884,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4132.558139534884,
        "lockDeadlineAudioTime": 13.132558139534884,
        "audioNow": 13.132558139534884,
        "outputSampleRate": 48000
      }
    ],
    "expected": {
      "finalPhase": "handoff",
      "terminalCause": null,
      "actualClass": "LOW_EDGE",
      "assignedClassMatched": true,
      "requiredEffectTypes": [
        "commit-handoff-plan"
      ],
      "traceSha256": "8c09028abebbbf39b9343872de86c130bb7b3c20f6d9fe88cbf770b61b0ffcbd",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        }
      ]
    }
  },
  {
    "name": "high-edge-match",
    "runValue": "session-2",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1533.3333333333335,
        "observedNowMs": 1533.3333333333335,
        "mappedTapAudioTime": 10.533333333333333,
        "audioNow": 10.533333333333333,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2066.666666666667,
        "observedNowMs": 2066.666666666667,
        "mappedTapAudioTime": 11.066666666666666,
        "audioNow": 11.066666666666666,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2600,
        "observedNowMs": 2600,
        "mappedTapAudioTime": 11.6,
        "audioNow": 11.6,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3133.3333333333335,
        "observedNowMs": 3133.3333333333335,
        "mappedTapAudioTime": 12.133333333333333,
        "audioNow": 12.133333333333333,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-2",
        "generationId": 1,
        "deadlineTimestampMs": 4033.3333333333335,
        "lockDeadlineAudioTime": 13.033333333333333,
        "audioNow": 13.033333333333333,
        "outputSampleRate": 48000
      }
    ],
    "expected": {
      "finalPhase": "handoff",
      "terminalCause": null,
      "actualClass": "HIGH_EDGE",
      "assignedClassMatched": true,
      "requiredEffectTypes": [
        "commit-handoff-plan"
      ],
      "traceSha256": "bf4298995e51c8e91d21613f11c63aaf1bef6bafd1059bdcaecda9d2b2a8825c",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        }
      ]
    }
  },
  {
    "name": "just-below-window",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1560.7481876151287,
        "observedNowMs": 1560.7481876151287,
        "mappedTapAudioTime": 10.560748187615129,
        "audioNow": 10.560748187615129,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2121.4963752302574,
        "observedNowMs": 2121.4963752302574,
        "mappedTapAudioTime": 11.121496375230258,
        "audioNow": 11.121496375230258,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2682.2445628453856,
        "observedNowMs": 2682.2445628453856,
        "mappedTapAudioTime": 11.682244562845385,
        "audioNow": 11.682244562845385,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3242.9927504605143,
        "observedNowMs": 3242.9927504605143,
        "mappedTapAudioTime": 12.242992750460514,
        "audioNow": 12.242992750460514,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4142.992750460515,
        "lockDeadlineAudioTime": 13.142992750460515,
        "audioNow": 13.142992750460515,
        "outputSampleRate": 48000
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 20,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "no-match",
      "terminalCause": null,
      "actualClass": null,
      "attemptCount": 0,
      "requiredEffectTypes": [
        "terminate-generation"
      ],
      "traceSha256": "472156366838a10bd43dcd8de9d5140f7c14cec66e9f93688e77581ab6d24894",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "generation-settling",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "terminate-generation"
          ]
        },
        {
          "phase": "no-match",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "just-above-window",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1530.9729814398393,
        "observedNowMs": 1530.9729814398393,
        "mappedTapAudioTime": 10.53097298143984,
        "audioNow": 10.53097298143984,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2061.9459628796785,
        "observedNowMs": 2061.9459628796785,
        "mappedTapAudioTime": 11.06194596287968,
        "audioNow": 11.06194596287968,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2592.9189443195182,
        "observedNowMs": 2592.9189443195182,
        "mappedTapAudioTime": 11.592918944319518,
        "audioNow": 11.592918944319518,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3123.8919257593575,
        "observedNowMs": 3123.8919257593575,
        "mappedTapAudioTime": 12.123891925759358,
        "audioNow": 12.123891925759358,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4023.8919257593575,
        "lockDeadlineAudioTime": 13.023891925759358,
        "audioNow": 13.023891925759358,
        "outputSampleRate": 48000
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 20,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "no-match",
      "terminalCause": null,
      "actualClass": null,
      "attemptCount": 0,
      "requiredEffectTypes": [
        "terminate-generation"
      ],
      "traceSha256": "779ec8e125f093d6a94e90752177be5efb7a07d7ef04536629d4f62270c6634c",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "generation-settling",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "terminate-generation"
          ]
        },
        {
          "phase": "no-match",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "wrong-assigned-class",
    "runValue": "session-1",
    "thermalState": "warmed",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 13.081818181818182,
        "audioNow": 13.081818181818182,
        "outputSampleRate": 48000
      },
      {
        "type": "effect-succeeded",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 20,
        "effectType": "commit-handoff-plan"
      },
      {
        "type": "song-only-boundary",
        "sessionId": "session-1",
        "generationId": 1,
        "sourceId": "generation-1-track-source"
      },
      {
        "type": "end-trial",
        "audioNow": 13.181818181818182
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 22,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "trial-complete",
      "actualClass": "CENTER",
      "assignedClassMatched": false,
      "requiredEffectTypes": [
        "commit-handoff-plan",
        "capture-terminal-draft",
        "terminate-generation"
      ],
      "traceSha256": "7950d167fa28a751634e3ae083fa0cd798c1f8e4a0c75808edf2811055fcfe45",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "playing",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "cancelling",
          "activeGenerationId": 1,
          "terminalCause": "trial-complete",
          "effectTypes": [
            "capture-terminal-draft",
            "terminate-generation"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "trial-complete",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "three-no-match-attempts",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 11000,
        "observedNowMs": 11000,
        "mappedTapAudioTime": 20,
        "audioNow": 20,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 11600,
        "observedNowMs": 11600,
        "mappedTapAudioTime": 20.6,
        "audioNow": 20.6,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 12200,
        "observedNowMs": 12200,
        "mappedTapAudioTime": 21.2,
        "audioNow": 21.2,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 12800,
        "observedNowMs": 12800,
        "mappedTapAudioTime": 21.8,
        "audioNow": 21.8,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 13400,
        "observedNowMs": 13400,
        "mappedTapAudioTime": 22.4,
        "audioNow": 22.4,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 14300,
        "lockDeadlineAudioTime": 23.299999999999997,
        "audioNow": 23.299999999999997,
        "outputSampleRate": 48000
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 20,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      },
      {
        "type": "try-again"
      },
      {
        "type": "tap",
        "eventTimestampMs": 21000,
        "observedNowMs": 21000,
        "mappedTapAudioTime": 30,
        "audioNow": 30,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 21600,
        "observedNowMs": 21600,
        "mappedTapAudioTime": 30.6,
        "audioNow": 30.6,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 22200,
        "observedNowMs": 22200,
        "mappedTapAudioTime": 31.2,
        "audioNow": 31.2,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 22800,
        "observedNowMs": 22800,
        "mappedTapAudioTime": 31.8,
        "audioNow": 31.8,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 23400,
        "observedNowMs": 23400,
        "mappedTapAudioTime": 32.4,
        "audioNow": 32.4,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 2,
        "deadlineTimestampMs": 24300,
        "lockDeadlineAudioTime": 33.3,
        "audioNow": 33.3,
        "outputSampleRate": 48000
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 2,
        "effectId": 38,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      },
      {
        "type": "try-again"
      },
      {
        "type": "tap",
        "eventTimestampMs": 31000,
        "observedNowMs": 31000,
        "mappedTapAudioTime": 40,
        "audioNow": 40,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 31600,
        "observedNowMs": 31600,
        "mappedTapAudioTime": 40.6,
        "audioNow": 40.6,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 32200,
        "observedNowMs": 32200,
        "mappedTapAudioTime": 41.2,
        "audioNow": 41.2,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 32800,
        "observedNowMs": 32800,
        "mappedTapAudioTime": 41.8,
        "audioNow": 41.8,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 33400,
        "observedNowMs": 33400,
        "mappedTapAudioTime": 42.4,
        "audioNow": 42.4,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 3,
        "deadlineTimestampMs": 34300,
        "lockDeadlineAudioTime": 43.3,
        "audioNow": 43.3,
        "outputSampleRate": 48000
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 3,
        "effectId": 57,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "cadence-unqualified",
      "attemptCount": 3,
      "activeGenerationId": null,
      "requiredEffectTypes": [
        "capture-terminal-draft",
        "terminate-generation"
      ],
      "traceSha256": "4cb00fbdaa2cd9f9a0e949036065895865a4bbc4fd63b6c63b49a82abbd5e2db",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "generation-settling",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "terminate-generation"
          ]
        },
        {
          "phase": "no-match",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "tracking",
          "activeGenerationId": 2,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 2,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 2,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 2,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 2,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "generation-settling",
          "activeGenerationId": 2,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "terminate-generation"
          ]
        },
        {
          "phase": "no-match",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "tracking",
          "activeGenerationId": 3,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 3,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 3,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 3,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 3,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "terminating-failure",
          "activeGenerationId": 3,
          "terminalCause": "cadence-unqualified",
          "effectTypes": [
            "capture-terminal-draft",
            "cancel-deadline",
            "terminate-generation"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "cadence-unqualified",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "paired-warmed-auto-failure",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 5,
        "audioNow": 5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "effect-failed",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 3,
        "effectType": "resume-context",
        "cause": "context-resume-failed"
      },
      {
        "type": "application-teardown-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 7,
        "effectType": "application-teardown",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "context-resume-failed",
      "activeGenerationId": null,
      "pairedWarmedAutoFailure": {
        "cause": "paired-session-unavailable",
        "runValue": "session-1",
        "slot": 2,
        "thermalState": "warmed",
        "assignedClass": "LOW_EDGE"
      },
      "requiredEffectTypes": [
        "capture-terminal-draft",
        "application-teardown"
      ],
      "traceSha256": "adeb268a3c29a21c16813e0bdf22c0b1b07f56982ce78379fd1a529f02efaf94",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "terminating-failure",
          "activeGenerationId": 1,
          "terminalCause": "context-resume-failed",
          "effectTypes": [
            "capture-terminal-draft",
            "application-teardown"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "context-resume-failed",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "jitter-outlier-recovery",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1500,
        "observedNowMs": 1500,
        "mappedTapAudioTime": 10.5,
        "audioNow": 10.5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2010,
        "observedNowMs": 2010,
        "mappedTapAudioTime": 11.01,
        "audioNow": 11.01,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2910,
        "observedNowMs": 2910,
        "mappedTapAudioTime": 11.91,
        "audioNow": 11.91,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3405,
        "observedNowMs": 3405,
        "mappedTapAudioTime": 12.405,
        "audioNow": 12.405,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3910,
        "observedNowMs": 3910,
        "mappedTapAudioTime": 12.91,
        "audioNow": 12.91,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 4410,
        "observedNowMs": 4410,
        "mappedTapAudioTime": 13.41,
        "audioNow": 13.41,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 4910,
        "observedNowMs": 4910,
        "mappedTapAudioTime": 13.91,
        "audioNow": 13.91,
        "outputSampleRate": 48000,
        "contextState": "running"
      }
    ],
    "expected": {
      "finalPhase": "armed",
      "terminalCause": null,
      "activeGenerationId": 1,
      "requiredEffectTypes": [
        "schedule-predictions"
      ],
      "traceSha256": "30b9a891699bb7363e580f1db8bce24985ba04e227e541c0b3ee69a5f1c09c60",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "set-lock-deadline",
            "cancel-predictions",
            "schedule-predictions"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        }
      ]
    }
  },
  {
    "name": "unstable-silence",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 5,
        "audioNow": 5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "idle-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 2800
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 6,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "ready",
      "terminalCause": null,
      "activeGenerationId": null,
      "requiredEffectTypes": [
        "terminate-generation"
      ],
      "traceSha256": "b977b109b93b55342613057ff6e16c00775c80973dcf570dd7a072ff8a3c16a4",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "generation-settling",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "terminate-generation"
          ]
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "tap-before-lock",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1500,
        "observedNowMs": 1500,
        "mappedTapAudioTime": 10.5,
        "audioNow": 10.5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2000,
        "observedNowMs": 2000,
        "mappedTapAudioTime": 11,
        "audioNow": 11,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2500,
        "observedNowMs": 2500,
        "mappedTapAudioTime": 11.5,
        "audioNow": 11.5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3000,
        "observedNowMs": 3000,
        "mappedTapAudioTime": 12,
        "audioNow": 12,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3500,
        "observedNowMs": 3500,
        "mappedTapAudioTime": 12.5,
        "audioNow": 12.5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 3900,
        "lockDeadlineAudioTime": 12.9,
        "audioNow": 12.9,
        "outputSampleRate": 48000
      }
    ],
    "expected": {
      "finalPhase": "armed",
      "terminalCause": null,
      "activeGenerationId": 1,
      "traceSha256": "8ac9cd13f5908f4e031556201c75fa139232cf7f652b9eed1c07f68378b44f7b",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "set-lock-deadline",
            "cancel-predictions",
            "schedule-predictions"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "lock-before-tap",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 13.081818181818182,
        "audioNow": 13.081818181818182,
        "outputSampleRate": 48000
      },
      {
        "type": "tap",
        "eventTimestampMs": 3206.818181818182,
        "observedNowMs": 3206.818181818182,
        "mappedTapAudioTime": 12.206818181818182,
        "audioNow": 12.206818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 22,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "trial-cancelled",
      "activeGenerationId": null,
      "requiredEffectTypes": [
        "capture-terminal-draft",
        "terminate-generation"
      ],
      "traceSha256": "a934d90a3aacfee9fb0b4188e2a051de3313793676690d32ed6f7534e54a8e2a",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        },
        {
          "phase": "cancelling",
          "activeGenerationId": 1,
          "terminalCause": "trial-cancelled",
          "effectTypes": [
            "capture-terminal-draft",
            "terminate-generation"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "trial-cancelled",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "armed-destabilization",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1500,
        "observedNowMs": 1500,
        "mappedTapAudioTime": 10.5,
        "audioNow": 10.5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2000,
        "observedNowMs": 2000,
        "mappedTapAudioTime": 11,
        "audioNow": 11,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2500,
        "observedNowMs": 2500,
        "mappedTapAudioTime": 11.5,
        "audioNow": 11.5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3000,
        "observedNowMs": 3000,
        "mappedTapAudioTime": 12,
        "audioNow": 12,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3600,
        "observedNowMs": 3600,
        "mappedTapAudioTime": 12.6,
        "audioNow": 12.6,
        "outputSampleRate": 48000,
        "contextState": "running"
      }
    ],
    "expected": {
      "finalPhase": "tracking",
      "terminalCause": null,
      "activeGenerationId": 1,
      "requiredEffectTypes": [
        "cancel-predictions"
      ],
      "traceSha256": "df9b81048b466465bdc21e630e91827bf7bae3e26a474a2baa75f7c5357e9b9f",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline",
            "cancel-predictions"
          ]
        }
      ]
    }
  },
  {
    "name": "bridge-ownership",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 13.081818181818182,
        "audioNow": 13.081818181818182,
        "outputSampleRate": 48000
      }
    ],
    "expected": {
      "finalPhase": "handoff",
      "terminalCause": null,
      "ownershipDisposition": "bridge",
      "skippedBeatCount": 1,
      "requiredEffectTypes": [
        "commit-handoff-plan"
      ],
      "traceSha256": "f6ce1eaca5d0ee18311241ca1865cd733c404f21973f3f82f4bde75b14c8ab30",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        }
      ]
    }
  },
  {
    "name": "adopt-ownership",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000
      }
    ],
    "expected": {
      "finalPhase": "handoff",
      "terminalCause": null,
      "ownershipDisposition": "adopt",
      "skippedBeatCount": 0,
      "requiredEffectTypes": [
        "commit-handoff-plan"
      ],
      "traceSha256": "15102c02d55d2ac46a026247e5c25eb206cfec96cdd1d13173f249b6746ec5ff",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        }
      ]
    }
  },
  {
    "name": "cancel-ownership",
    "runValue": "session-1",
    "thermalState": "warmed",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1558.139534883721,
        "observedNowMs": 1558.139534883721,
        "mappedTapAudioTime": 10.55813953488372,
        "audioNow": 10.55813953488372,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2116.279069767442,
        "observedNowMs": 2116.279069767442,
        "mappedTapAudioTime": 11.116279069767442,
        "audioNow": 11.116279069767442,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2674.4186046511627,
        "observedNowMs": 2674.4186046511627,
        "mappedTapAudioTime": 11.674418604651162,
        "audioNow": 11.674418604651162,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3232.5581395348836,
        "observedNowMs": 3232.5581395348836,
        "mappedTapAudioTime": 12.232558139534884,
        "audioNow": 12.232558139534884,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4132.558139534884,
        "lockDeadlineAudioTime": 12.232558139534884,
        "audioNow": 12.232558139534884,
        "outputSampleRate": 48000
      }
    ],
    "expected": {
      "finalPhase": "handoff",
      "terminalCause": null,
      "ownershipDisposition": "cancel",
      "skippedBeatCount": 0,
      "requiredEffectTypes": [
        "commit-handoff-plan"
      ],
      "traceSha256": "deea9741720855673196c34bd0a5ed9c71b98e58b921339b93b795e85ab5ee0f",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        }
      ]
    }
  },
  {
    "name": "two-advance-catch-up",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 12.181818181818182,
        "audioNow": 13.273727272727271,
        "outputSampleRate": 48000
      }
    ],
    "expected": {
      "finalPhase": "handoff",
      "terminalCause": null,
      "skippedBeatCount": 2,
      "requiredEffectTypes": [
        "commit-handoff-plan"
      ],
      "traceSha256": "7208febf83188f31b23c1129f2c7d7513e6cb25bbd67ebced616475f71353776",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        }
      ]
    }
  },
  {
    "name": "catch-up-limit",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 13.081818181818182,
        "audioNow": 14.463636363636363,
        "outputSampleRate": 48000
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 21,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "lock-timer-too-late",
      "activeGenerationId": null,
      "requiredEffectTypes": [
        "capture-terminal-draft",
        "terminate-generation"
      ],
      "traceSha256": "dc811bb3eb85322a7245c89164c21a5438677926c70bfde2e8cf3b6d92a95efc",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "terminating-failure",
          "activeGenerationId": 1,
          "terminalCause": "lock-timer-too-late",
          "effectTypes": [
            "capture-terminal-draft",
            "cancel-deadline",
            "terminate-generation"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "lock-timer-too-late",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "smoke-crossfade-complete",
    "runValue": "smoke-crossfade",
    "thermalState": "smoke",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "smoke-crossfade",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 13.081818181818182,
        "audioNow": 13.081818181818182,
        "outputSampleRate": 48000
      },
      {
        "type": "effect-succeeded",
        "sessionId": "smoke-crossfade",
        "generationId": 1,
        "effectId": 20,
        "effectType": "commit-handoff-plan"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3206.818181818182,
        "observedNowMs": 3206.818181818182,
        "mappedTapAudioTime": 12.206818181818182,
        "audioNow": 12.206818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "smoke-crossfade",
        "generationId": 1,
        "effectId": 22,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      },
      {
        "type": "tap",
        "eventTimestampMs": 3207.818181818182,
        "observedNowMs": 3207.818181818182,
        "mappedTapAudioTime": 20,
        "audioNow": 20,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "smoke-probe-settled",
        "sessionId": "smoke-crossfade",
        "generationId": 2,
        "effectId": 25,
        "effectType": "run-smoke-probe",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "trial-cancelled",
      "activeGenerationId": null,
      "smokeStatus": "completed",
      "requiredEffectTypes": [
        "run-smoke-probe"
      ],
      "traceSha256": "660d682cb5e889385894483d2e5e0ec8058dd2966518008032836b4c6691ae53",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "cancelling",
          "activeGenerationId": 1,
          "terminalCause": "trial-cancelled",
          "effectTypes": [
            "capture-terminal-draft",
            "terminate-generation"
          ]
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": "trial-cancelled",
          "effectTypes": []
        },
        {
          "phase": "smoke-probing",
          "activeGenerationId": 2,
          "terminalCause": "trial-cancelled",
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "run-smoke-probe"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "trial-cancelled",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "smoke-playing-complete",
    "runValue": "smoke-playing",
    "thermalState": "smoke",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "smoke-playing",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 13.081818181818182,
        "audioNow": 13.081818181818182,
        "outputSampleRate": 48000
      },
      {
        "type": "effect-succeeded",
        "sessionId": "smoke-playing",
        "generationId": 1,
        "effectId": 20,
        "effectType": "commit-handoff-plan"
      },
      {
        "type": "song-only-boundary",
        "sessionId": "smoke-playing",
        "generationId": 1,
        "sourceId": "generation-1-track-source"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3206.818181818182,
        "observedNowMs": 3206.818181818182,
        "mappedTapAudioTime": 12.206818181818182,
        "audioNow": 12.206818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "smoke-playing",
        "generationId": 1,
        "effectId": 22,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      },
      {
        "type": "tap",
        "eventTimestampMs": 3207.818181818182,
        "observedNowMs": 3207.818181818182,
        "mappedTapAudioTime": 20,
        "audioNow": 20,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "smoke-probe-settled",
        "sessionId": "smoke-playing",
        "generationId": 2,
        "effectId": 25,
        "effectType": "run-smoke-probe",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "trial-cancelled",
      "activeGenerationId": null,
      "smokeStatus": "completed",
      "requiredEffectTypes": [
        "run-smoke-probe"
      ],
      "traceSha256": "f9f0c3d1f86a947eba506cc7c05b6d7570dd119a3e4a92098ca0473894bb5d2f",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "playing",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "cancelling",
          "activeGenerationId": 1,
          "terminalCause": "trial-cancelled",
          "effectTypes": [
            "capture-terminal-draft",
            "terminate-generation"
          ]
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": "trial-cancelled",
          "effectTypes": []
        },
        {
          "phase": "smoke-probing",
          "activeGenerationId": 2,
          "terminalCause": "trial-cancelled",
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "run-smoke-probe"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "trial-cancelled",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "visibility-wins-context-race",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "runtime-interrupted",
        "reason": "hidden",
        "audioNow": 12.191818181818181
      },
      {
        "type": "unexpected-context-closed"
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 21,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      },
      {
        "type": "foreground-restored"
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "runtime-context-interrupted",
      "activeGenerationId": null,
      "requiredEffectTypes": [
        "terminate-generation"
      ],
      "traceSha256": "4dbce5e98efa315dacc80f0fc09fd0ca5e86d78cc42cf349b71de55779d05cb7",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "interrupted",
          "activeGenerationId": 1,
          "terminalCause": "runtime-context-interrupted",
          "effectTypes": [
            "capture-terminal-draft",
            "cancel-deadline",
            "terminate-generation"
          ]
        },
        {
          "phase": "interrupted",
          "activeGenerationId": 1,
          "terminalCause": "runtime-context-interrupted",
          "effectTypes": []
        },
        {
          "phase": "interrupted",
          "activeGenerationId": null,
          "terminalCause": "runtime-context-interrupted",
          "effectTypes": []
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "runtime-context-interrupted",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "context-close-wins-visibility-race",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "unexpected-context-closed"
      },
      {
        "type": "runtime-interrupted",
        "reason": "hidden",
        "audioNow": 12.191818181818181
      },
      {
        "type": "application-teardown-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 20,
        "effectType": "application-teardown",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "runtime-context-closed",
      "activeGenerationId": null,
      "requiredEffectTypes": [
        "application-teardown"
      ],
      "traceSha256": "89379c3235fef7af99a96345c6f87f75adddd876e588ccc182f38f1d53ef0d3d",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "terminating-failure",
          "activeGenerationId": 1,
          "terminalCause": "runtime-context-closed",
          "effectTypes": [
            "capture-terminal-draft",
            "application-teardown"
          ]
        },
        {
          "phase": "terminating-failure",
          "activeGenerationId": 1,
          "terminalCause": "runtime-context-closed",
          "effectTypes": []
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "runtime-context-closed",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "resume-failure",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 5,
        "audioNow": 5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "effect-failed",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 3,
        "effectType": "resume-context",
        "cause": "context-resume-failed"
      },
      {
        "type": "application-teardown-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 7,
        "effectType": "application-teardown",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "context-resume-failed",
      "activeGenerationId": null,
      "pairedWarmedAutoFailure": {
        "cause": "paired-session-unavailable",
        "runValue": "session-1",
        "slot": 2,
        "thermalState": "warmed",
        "assignedClass": "LOW_EDGE"
      },
      "requiredEffectTypes": [
        "capture-terminal-draft",
        "application-teardown"
      ],
      "traceSha256": "adeb268a3c29a21c16813e0bdf22c0b1b07f56982ce78379fd1a529f02efaf94",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "terminating-failure",
          "activeGenerationId": 1,
          "terminalCause": "context-resume-failed",
          "effectTypes": [
            "capture-terminal-draft",
            "application-teardown"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "context-resume-failed",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "teardown-failure",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 5,
        "audioNow": 5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "effect-failed",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 3,
        "effectType": "resume-context",
        "cause": "context-resume-failed"
      },
      {
        "type": "application-teardown-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 7,
        "effectType": "application-teardown",
        "cleanup": {
          "status": "failed",
          "cause": "context-close-failed"
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "context-resume-failed",
      "activeGenerationId": null,
      "pairedWarmedAutoFailure": {
        "cause": "paired-session-unavailable",
        "runValue": "session-1",
        "slot": 2,
        "thermalState": "warmed",
        "assignedClass": "LOW_EDGE"
      },
      "requiredEffectTypes": [
        "capture-terminal-draft",
        "application-teardown"
      ],
      "traceSha256": "b8389dfe7673663fc39f5b6f024afdb5eee9403cb593f7c5859b1aa6dae4d2c1",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "terminating-failure",
          "activeGenerationId": 1,
          "terminalCause": "context-resume-failed",
          "effectTypes": [
            "capture-terminal-draft",
            "application-teardown"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "context-resume-failed",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "natural-end",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 13.081818181818182,
        "audioNow": 13.081818181818182,
        "outputSampleRate": 48000
      },
      {
        "type": "effect-succeeded",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 20,
        "effectType": "commit-handoff-plan"
      },
      {
        "type": "song-only-boundary",
        "sessionId": "session-1",
        "generationId": 1,
        "sourceId": "generation-1-track-source"
      },
      {
        "type": "natural-track-end",
        "sessionId": "session-1",
        "generationId": 1,
        "sourceId": "generation-1-track-source",
        "audioNow": 13.181818181818182
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 22,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "trial-complete",
      "activeGenerationId": null,
      "requiredEffectTypes": [
        "capture-terminal-draft",
        "terminate-generation"
      ],
      "traceSha256": "e7746564255eb3c9eba3dc09f1b612568d7f7889c1186e475ddf3d2c4e6b910d",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "playing",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "cancelling",
          "activeGenerationId": 1,
          "terminalCause": "trial-complete",
          "effectTypes": [
            "capture-terminal-draft",
            "terminate-generation"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "trial-complete",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "end-trial",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 10,
        "audioNow": 10,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 1545.4545454545455,
        "observedNowMs": 1545.4545454545455,
        "mappedTapAudioTime": 10.545454545454545,
        "audioNow": 10.545454545454545,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2090.909090909091,
        "observedNowMs": 2090.909090909091,
        "mappedTapAudioTime": 11.090909090909092,
        "audioNow": 11.090909090909092,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 2636.3636363636365,
        "observedNowMs": 2636.3636363636365,
        "mappedTapAudioTime": 11.636363636363637,
        "audioNow": 11.636363636363637,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "tap",
        "eventTimestampMs": 3181.818181818182,
        "observedNowMs": 3181.818181818182,
        "mappedTapAudioTime": 12.181818181818182,
        "audioNow": 12.181818181818182,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "lock-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 4081.818181818182,
        "lockDeadlineAudioTime": 13.081818181818182,
        "audioNow": 13.081818181818182,
        "outputSampleRate": 48000
      },
      {
        "type": "effect-succeeded",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 20,
        "effectType": "commit-handoff-plan"
      },
      {
        "type": "song-only-boundary",
        "sessionId": "session-1",
        "generationId": 1,
        "sourceId": "generation-1-track-source"
      },
      {
        "type": "end-trial",
        "audioNow": 13.181818181818182
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 22,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      }
    ],
    "expected": {
      "finalPhase": "evidence-pending",
      "terminalCause": "trial-complete",
      "activeGenerationId": null,
      "requiredEffectTypes": [
        "capture-terminal-draft",
        "terminate-generation"
      ],
      "traceSha256": "84f5912ff4e1300a5721a69dbab7025f0abdbe2bf7f31daaa296ed856f36fbc1",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "armed",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "schedule-acknowledgment",
            "cancel-deadline",
            "set-lock-deadline",
            "schedule-predictions"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "cancel-deadline",
            "commit-handoff-plan"
          ]
        },
        {
          "phase": "handoff",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "playing",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "cancelling",
          "activeGenerationId": 1,
          "terminalCause": "trial-complete",
          "effectTypes": [
            "capture-terminal-draft",
            "terminate-generation"
          ]
        },
        {
          "phase": "evidence-pending",
          "activeGenerationId": null,
          "terminalCause": "trial-complete",
          "effectTypes": []
        }
      ]
    }
  },
  {
    "name": "stale-callbacks",
    "runValue": "session-1",
    "thermalState": "cold",
    "events": [
      {
        "type": "tap",
        "eventTimestampMs": 1000,
        "observedNowMs": 1000,
        "mappedTapAudioTime": 5,
        "audioNow": 5,
        "outputSampleRate": 48000,
        "contextState": "running"
      },
      {
        "type": "idle-deadline",
        "sessionId": "session-1",
        "generationId": 1,
        "deadlineTimestampMs": 2800
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 6,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      },
      {
        "type": "generation-cleanup-settled",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 6,
        "effectType": "terminate-generation",
        "cleanup": {
          "status": "succeeded",
          "cause": null
        }
      },
      {
        "type": "effect-succeeded",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 3,
        "effectType": "resume-context"
      },
      {
        "type": "effect-succeeded",
        "sessionId": "session-1",
        "generationId": 1,
        "effectId": 3,
        "effectType": "resume-context"
      },
      {
        "type": "source-ended",
        "sessionId": "session-1",
        "generationId": 1,
        "sourceId": "generation-1-source-unknown"
      }
    ],
    "expected": {
      "finalPhase": "ready",
      "terminalCause": null,
      "activeGenerationId": null,
      "requiredEffectTypes": [
        "reconcile-stale-resume"
      ],
      "traceSha256": "1b4190a27de656d90040dcb78dc8f437232ec8b1ddf9be73c9708dbf49e08e08",
      "transitions": [
        {
          "phase": "tracking",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "resume-context",
            "schedule-acknowledgment",
            "set-idle-deadline"
          ]
        },
        {
          "phase": "generation-settling",
          "activeGenerationId": 1,
          "terminalCause": null,
          "effectTypes": [
            "terminate-generation"
          ]
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": [
            "reconcile-stale-resume"
          ]
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        },
        {
          "phase": "ready",
          "activeGenerationId": null,
          "terminalCause": null,
          "effectTypes": []
        }
      ]
    }
  }
]);
