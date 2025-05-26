#!/usr/bin/env node
import { join, resolve, dirname } from 'node:path'
import { parseCueFile, splitMp3WithCue } from './utils'

async function main() {
  // argv[2] cueFile
  const cueFile = process.argv[2]
  // argv[3] outputFolder
  const outputFolder = process.argv[3]

  if (!cueFile || !outputFolder) {
    console.error(
      'Usage: pnpm cue2mp3 <path/to/your/cue_file.cue> <path/to/your/output_folder>'
    )
    process.exit(1)
  }

  try {
    console.log(`Parsing CUE file: ${cueFile}`)
    const parsedCue = await parseCueFile(cueFile)

    // Resolve the audio file path relative to the CUE file's directory
    const cueDir = dirname(resolve(cueFile))
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

// Run the main function
main()
