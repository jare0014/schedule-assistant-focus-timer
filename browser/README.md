# EquiSync Windows media bridge

`equisync-gsmtc.user.js` is a Tampermonkey candidate for the existing EquiSync Element tab on kilPC. It controls the site's play/pause buttons; it does not create a second EquiSync player or send any network requests.

## Install and test

1. Disable the previous EquiSync bridge script so two scripts cannot compete for the same Media Session handlers.
2. Replace its editor contents with the complete raw contents of `equisync-gsmtc.user.js`, including the metadata header. Do not include Markdown code fences or Markdown-formatted URLs. Save.
3. Reload `https://equisync.eocinstitute.org/meditation/element/` and verify the small bridge status panel appears at bottom right. If absent, first check whether Tampermonkey says this script ran on this tab and whether its editor reports an error.
4. Click the actual EquiSync Play control. If the panel reports an anchor rejection, click **Enable media controls** while EquiSync is playing.
5. Look for **EquiSync Element — EOC Institute** in the Windows media card. Confirm Windows Pause stops the actual EquiSync sound, and Windows Play resumes it. Then test the shared source selector and NoranPC Ctrl+K.

If the panel says the anchor is playing but Windows never lists it, record that exact state and Chrome version. Do not interpret metadata registration or the panel message as proof of GSMTC registration. This silent-anchor technique remains browser-dependent. No audible fallback or browser security changes are performed automatically.

## Changes from the supplied version 2

- Correct raw `@match`/`@namespace`; no embedded Markdown fences.
- Generate a valid 10-second mono PCM WAV. The supplied data URI contains just two bytes of 16-bit audio at 44.1 kHz: one sample, about 23 microseconds. Chrome's documented media notification audio-focus threshold is at least five seconds, so looping that sample does not provide an adequate duration.
- Start the anchor in a direct site Play click handler when possible, and expose rejected playback instead of swallowing errors. An Enable button supplies another explicit user gesture.
- Read computed display/visibility including ancestors, sync initial state, and re-query replaced controls. If visibility is ambiguous, publish no active playback and do not guess which button to click.
- Report actual observed DOM state rather than assuming a requested play/pause succeeded. DOM visibility remains a heuristic; audible playback must be checked on the live site.

## Validation

Run `node --check browser/equisync-gsmtc.user.js` and `node tests/equisync-bridge.cjs` from the project root. Tests use a simulated DOM; they do not verify WAV decoding, live site markup, Chrome audio focus, or Windows GSMTC. No browser installation has been performed by these tests.

References: [Chrome Media Session guidance](https://web.dev/articles/media-session), [Tampermonkey metadata documentation](https://www.tampermonkey.net/documentation.php).
