# Kaleido

Kaleido plays an audio file and draws a live picture that follows it. The picture can be saved as an MP4 of the section you mark on the timeline.

## Run

```bash
npm install
npm run dev
```

Vite serves the app at http://127.0.0.1:5173/.

```bash
npm run build
npm run preview
```

Open an MP3, WAV, FLAC, OGG, or M4A file, or drop one onto the window.

## Controls

Playback sits at the bottom center. Look and Export start stacked in the top right. Drag a title bar to move a panel, drag its corner to resize it, and click the title to collapse it.

- **Play** and **Pause** keep the playhead where it is. **Stop** pauses and returns to the start.
- The timeline shows the waveform. Drag the pink and aqua marks, or press `I` and `O`, to set the export span. The whole track still plays. **Preview** plays the marked span once.
- **Look** sets the scene, symmetry, smear, intensity, and palette together. Built-in looks are Acid Temple, Deep Void, Aurora Drift, Magma Burst, Halo Choir, and Silk Weave. A look you save is stored in this browser.
- Scenes are Mandala, Tunnel, Liquid, Starfield, Halo, and Weave. They render with WebGL2; without it every scene falls back to Mandala. Symmetry, smear, intensity, and palette apply to each of them.
- **Export** writes an MP4 of the marked span. Sizes are 16:9 at 720p, 16:9 at 1080p, 9:16 at 1080×1920, and 1:1 at 1080×1080. The video carries a Kaleido watermark and the loaded file name. The panels are not in the video.

MP4 export uses the browser video encoder and needs Chrome or Edge. Space toggles play when focus is not in a control. Double-click the picture for full screen.

## License

MIT. See [LICENSE](LICENSE).
