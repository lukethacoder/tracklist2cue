#!/usr/bin/env node
import { convertTracklistToCue } from './utils'

async function main() {
  // argv[2] tracklistFile
  const tracklistFile = process.argv[2]
  // argv[3] audioFile
  const audioFile = process.argv[3]
  // argv[4] outputCueFile
  const outputCueFile = process.argv[4]
  // argv[5] albumTitle
  const albumTitle = process.argv[5]

  if (!tracklistFile || !audioFile || !albumTitle) {
    console.error(
      'Usage: pnpm tracklist2cue <path/to/your/tracklist.txt> <path/to/your/audio.mp3> <path/to/output/cue_file.cue> "album title"'
    )
    process.exit(1)
  }

  await convertTracklistToCue(
    tracklistFile,
    outputCueFile,
    albumTitle,
    audioFile
  )
}

main().catch(console.error)
