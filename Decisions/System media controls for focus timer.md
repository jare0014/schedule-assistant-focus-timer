---
type: decision
project_id: schedule-assistant-focus-timer
knowledge_id: focus-timer-system-media-2026-09-15
status: accepted
confidence: confirmed
implementation_status: implemented
applies_to_branch: master
updated: 2026-09-15
code_paths:
  - src/views/TaskTimerView.ts
  - src/services/RemoteServerService.ts
  - AndroidWidget/app/src/main/java/com/example/media/HostedMediaCardService.kt
---

# System media controls for focus timer

The focus timer should control the current system media exposed through kilPC, including Spotify Connect controls when playback is on another device. It should no longer choose tracks from a dropdown or play focus audio in an embedded player. Android should expose native lock-screen/media controls for that hosted session; the Obsidian sidebar can show a compact mirror of that state and a control. The web port and Android companion should share timer/media play and pause behavior with kilPC.

Ctrl+K is routed by AutoHotkey from kilPC, NoranPC, and Citrix to kilPC, where the media is hosted. Pausing from the Android app or media card should pause both music and timer; resuming from the sidebar should resume both. AudioRelay sometimes routes kilPC audio to the phone and does not change which machine owns playback.

Spotify Connect playback controlled from kilPC is acceptable even when audio is on another device. The user resumed playback from Spotify on kilPC and streamed it via RDP to NoranPC. Functional timer/media integration still requires verification; see [[Current State]].
