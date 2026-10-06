# Native SEB acceptance

Ordinary Chromium and Playwright WebKit checks establish browser rendering/playback behavior only. They do not establish Safe Exam Browser, macOS assessment-framework, or AAC compatibility.

Use the local or deployed fixture with the real SEB app. The deployed teacher workflow first requires Internal OAuth configuration. Prepare the fixture with a current student window, copy the fragment link, and open that full URL in SEB. Configure the exam's allowed origin and all same-origin PDF.js/API paths. Share fragments must survive SEB's launch/configuration flow.

| Client    | OS       | AAC     | Status                       |
| --------- | -------- | ------- | ---------------------------- |
| SEB 3.6.1 | macOS 26 | Enabled | Operator validation required |
| SEB 3.6.1 | macOS 27 | Enabled | Operator validation required |
| SEB 3.7.1 | macOS 26 | Enabled | Operator validation required |
| SEB 3.7.1 | macOS 27 | Enabled | Operator validation required |

For each available real Mac/client combination:

1. Open the student link before its start and verify no assessment content or audio is delivered.
2. During the valid window, verify the original two-page PDF renders and each labelled question/choice plays the matching clip.
3. Rapidly switch passages; verify one clip plays and the last selected passage wins. Check play/pause/stop and every speed setting, including a first click after app launch.
4. Zoom, rotate through 90/180/270 degrees, and move between pages. Check highlights align with the actual text, including wrapped questions and columns, on Retina displays.
5. Navigate segments by keyboard and inspect focus/labels. Verify media failures produce a visible message.
6. Disable access from the teacher dashboard. The open reader should clear within the five-second policy polling interval; subsequent assets must be refused.
7. Repeat with an expiration boundary, then tab/app suspension and resume. Audio must stop and the PDF/text disappear. Reloading after expiry must not recover content.
8. Check the exam network policy permits same-origin bundled worker, CMaps, fonts, decoders, PDF ranges, manifest, and MP3 requests. Student playback must not need external Google TTS network access.

Record client/macOS versions, AAC configuration, exam configuration, result, and any console/native error. Application-hosted audio avoids relying on macOS Speak Selection, but this does not prove assessment-framework media permission on an untested Mac.
