#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path'
import { convertTracklistToCue, parseCueFile, splitMp3WithCue } from './utils'

async function main() {
  // argv[2] tracklistFile
  const tracklistFile = process.argv[2]
  // argv[3] audioFile
  const audioFile = process.argv[3]
  // argv[4] albumTitle
  const albumTitle = process.argv[4]
  // argv[5] outputFolder
  const outputFolder = process.argv[5]

  if (!tracklistFile || !audioFile || !albumTitle || !outputFolder) {
    console.error(
      'Usage: pnpm tracklist2mp3 <path/to/your/tracklist.txt> <path/to/your/audio.mp3> "album title" <path/to/your/output_folder>'
    )
    process.exit(1)
  }

  const outputCueFile = join(
    outputFolder,
    `${tracklistFile.split('.').at(0)}.cue`
  )

  await convertTracklistToCue(
    tracklistFile,
    outputCueFile,
    albumTitle,
    audioFile
  )

  try {
    console.log(`Parsing CUE file: ${outputCueFile}`)
    const parsedCue = await parseCueFile(outputCueFile)

    // Resolve the audio file path relative to the CUE file's directory
    const cueDir = dirname(resolve(outputCueFile))
    const inputMp3Path = join(cueDir, parsedCue.audioFileName)

    console.log(`Input MP3 file from CUE: ${inputMp3Path}`)
    console.log(`Found ${parsedCue.tracks.length} tracks.`)

    const generatedFiles = await splitMp3WithCue(
      inputMp3Path,
      parsedCue,
      outputFolder
    )
    console.log('\nGenerated MP3 files:')
    generatedFiles.forEach((file) => console.log(file))
  } catch (error: any) {
    console.error(`\nAn error occurred: ${error.message}`)
    console.error(
      'Please ensure you have "ffmpeg" and "ffprobe" installed and available in your system\'s PATH, and that the CUE file and its referenced MP3 file exist.'
    )
  }
}

main().catch(console.error)
