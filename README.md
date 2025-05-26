# tracklist2cue

## Why?

- Split DJ mixes into individual tracks to better "resume" if you stop listening mid-mix.
- Better [scrobbling](https://en.wikipedia.org/wiki/Last.fm#:~:text=The%20term%20scrobbling%20is%20defined,%2C%20music%2C%20and%20other%20data.) stats (track individual tracks/artists properly)

## How?

- Convert a traditional tracklist (`HH:MM:SS ARTIST_NAME - TRACK_NAME`) to a `.cue` file
- Use the `.cue` file output within a program like `foobar2000` to split up the mix into individual tracks

---

## Scripts

### tracklist2mp3

Comination of `pnpm tracklist2cue` and `pnpm cue2mp3`

Splits an mp3 file given a tracklist (also spits out a `.cue` file too)

```bash
pnpm tracklist2mp3 TRACKLIST_FILE_TXT AUDIO_FILE_MP3 ALBUM_TITLE OUTPUT_FOLDER_PATH

# Example
pnpm tracklist2mp3 "./input/test.txt" "./input/test.mp3" "Test Album" "./output"
```

### tracklist2cue

Converts a tracklist to a `.cue` file

```bash
pnpm tracklist2cue TRACKLIST_FILE_TXT AUDIO_FILE_MP3 OUTPUT_CUE_FILE ALBUM_TITLE

# Example
pnpm tracklist2cue "./input/test.txt" "./input/test.mp3" "./output/test.cue" "Test Album"
```

### cue2mp3

Splits an mp3 file (using `ffmpeg`) with a `.cue` file reference

```bash
pnpm cue2mp3 CUE_FILE_PATH OUTPUT_FOLDER_PATH

# Example
pnpm cue2mp3 "./output/test.cue" "./output"
```