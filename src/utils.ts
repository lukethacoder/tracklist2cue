#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { join, extname } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { ensureDir } from 'fs-extra'
import * as cueParser from 'cue-parser'

const IS_DEBUG = false

/**
 * Represents a track parsed from a CUE file, simplified for splitting.
 */
interface CueTrack {
  trackNumber: number
  title: string
  trackName: string
  artist: string
  performer: string
  startTimeSeconds: number // Start time in total seconds
}

/**
 * Represents the parsed content of a CUE file, simplified for our use.
 */
interface ParsedCueFile {
  title?: string
  performer?: string
  audioFileName: string
  tracks: CueTrack[]
}

/**
 * Formats a time in seconds into HH:MM:SS.ms format for ffmpeg.
 * @param seconds The time in seconds.
 * @returns A formatted time string.
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  // Pad with leading zeros for HH, MM, SS
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(Math.floor(remainingSeconds)).padStart(2, '0')
  const ms = String(
    Math.round((remainingSeconds - Math.floor(remainingSeconds)) * 1000)
  ).padStart(3, '0')

  return `${hh}:${mm}:${ss}.${ms}`
}

/**
 * Converts MM:SS:FF (minutes:seconds:frames) format to total seconds.
 * Assumes 75 frames per second (standard for audio CDs).
 * @param timeObject The time string in MM:SS:FF format.
 * @returns The total time in seconds.
 */
export function cueTimeToSeconds({
  min,
  sec,
  frame,
}: {
  min: number
  sec: number
  frame: number
}): number {
  return min * 60 + sec + frame / 75
}

/**
 * Parses a .cue file using the 'cue-parser' npm package to extract
 * the audio file name and track information.
 * @param cueFilePath The path to the .cue file.
 * @returns A Promise that resolves with the parsed CUE file data.
 */
export async function parseCueFile(
  cueFilePath: string
): Promise<ParsedCueFile> {
  if (!existsSync(cueFilePath)) {
    throw new Error(`CUE file not found: ${cueFilePath}`)
  }

  let parsedCueSheet: any
  try {
    parsedCueSheet = cueParser.parse(cueFilePath)
  } catch (error: any) {
    throw new Error(`Error parsing CUE file with cue-parser: ${error.message}`)
  }

  if (
    !parsedCueSheet ||
    !parsedCueSheet.files ||
    parsedCueSheet.files.length === 0
  ) {
    throw new Error(`No file entries found in CUE sheet: ${cueFilePath}`)
  }

  if (IS_DEBUG) {
    console.log('parsedCueSheet ', parsedCueSheet)
  }

  // Assuming the first FILE entry is the main audio file
  const audioFileEntry = parsedCueSheet.files[0]
  const audioFileName = audioFileEntry.name

  if (!audioFileEntry.tracks || audioFileEntry.tracks.length === 0) {
    throw new Error(
      `No tracks found for audio file '${audioFileName}' in CUE sheet: ${cueFilePath}`
    )
  }

  const tracks: CueTrack[] = audioFileEntry.tracks
    .map((track: any) => {
      // cue-parser provides indexes as an array, usually INDEX 01 is the relevant one
      const index01 = track.indexes.find((idx: any) => idx.number === 1)
      if (!index01) {
        console.warn(`Track ${track.track} is missing INDEX 01. Skipping.`)
        return null // Return null for invalid tracks
      }

      return {
        trackNumber: track.number,
        trackName: track.title,
        title: track.title,
        performer: track.performer || 'Unknown Artist',
        startTimeSeconds: cueTimeToSeconds(index01.time),
      }
    })
    .filter(Boolean) as CueTrack[] // Filter out any nulls from skipped tracks

  // Sort tracks by start time to ensure correct processing order
  tracks.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)

  return {
    title: parsedCueSheet.title,
    performer: parsedCueSheet.performer,
    audioFileName,
    tracks,
  }
}

/**
 * Gets the duration of an MP3 file using ffprobe.
 * Assumes 'ffprobe' CLI is installed and available in the system's PATH.
 * @param filePath The path to the MP3 file.
 * @returns A Promise that resolves with the duration in seconds.
 */
export async function getMp3Duration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // Assume 'ffprobe' is available in the system's PATH
    const ffprobeProcess = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ])
    let durationOutput = ''
    let errorOutput = ''

    ffprobeProcess.stdout.on('data', (data) => {
      durationOutput += data.toString()
    })

    ffprobeProcess.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    ffprobeProcess.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(durationOutput.trim())
        if (!isNaN(duration)) {
          resolve(duration)
        } else {
          reject(
            new Error(
              `Could not parse duration from ffprobe output: ${durationOutput}. Error: ${errorOutput}`
            )
          )
        }
      } else {
        reject(new Error(`ffprobe exited with code ${code}: ${errorOutput}`))
      }
    })

    ffprobeProcess.on('error', (err) => {
      reject(
        new Error(
          `Failed to start ffprobe process. Is 'ffprobe' installed and in your system's PATH? Error: ${err.message}`
        )
      )
    })
  })
}

/**
 * Splits an MP3 file into smaller files based on track information from a CUE file.
 * The splitting is done losslessly using ffmpeg's '-c copy' option.
 * Assumes 'ffmpeg' CLI is installed and available in the system's PATH.
 *
 * @param inputFilePath The path to the input MP3 file.
 * @param tracks An array of track objects parsed from a CUE file.
 * @param outputDirectory The directory where the split MP3 files will be saved.
 * @returns A Promise that resolves with an array of paths to the generated output files.
 */
export async function splitMp3WithCue(
  inputFilePath: string,
  cueMetadata: ParsedCueFile,
  outputDirectory: string
): Promise<string[]> {
  console.log(`splitMp3WithCue: ABOUT TO existsSync?`)
  if (!existsSync(inputFilePath)) {
    throw new Error(`Input audio file not found: ${inputFilePath}`)
  }

  const { title, performer, tracks } = cueMetadata

  if (tracks.length === 0) {
    throw new Error('No tracks provided for splitting.')
  }

  console.log(`Starting to split: ${inputFilePath}`)
  console.log(`Number of tracks to split: ${tracks.length}`)
  console.log(`Output directory: ${outputDirectory}`)

  if (!existsSync(outputDirectory)) {
    await mkdir(outputDirectory, { recursive: true })
  }

  // Ensure the output directory exists
  // await ensureDir(outputDirectory)
  console.log(`Ensured output directory exists: ${outputDirectory}`)

  const totalDuration = await getMp3Duration(inputFilePath)
  console.log(
    `Total duration of input file: ${totalDuration.toFixed(2)} seconds`
  )

  const outputFilePaths: string[] = []
  const fileExtension = extname(inputFilePath) // e.g., ".mp3"

  for (let i = 0; i < tracks.length; i++) {
    const currentTrack = tracks[i]
    const startTime = currentTrack.startTimeSeconds
    const nextTrack = tracks[i + 1]
    const endTime = nextTrack ? nextTrack.startTimeSeconds : totalDuration

    // Skip if the segment is empty or invalid
    if (startTime >= endTime) {
      console.warn(
        `Skipping invalid segment for track ${currentTrack.trackNumber}: start=${startTime}, end=${endTime}`
      )
      continue
    }

    const duration = endTime - startTime

    // Sanitize title and performer for filename
    // Replace non-alphanumeric characters (except spaces, hyphens, underscores) with nothing,
    // then replace multiple spaces with single space, then trim.
    const sanitizedTitle = currentTrack.title
      .replace(/[^a-zA-Z0-9\s\-_.]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const sanitizedPerformer = currentTrack.performer
      .replace(/[^a-zA-Z0-9\s\-_.]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    // Format output filename: "TrackNumber - Performer - Title.mp3"
    const outputFileName = `${sanitizedPerformer} - ${sanitizedTitle}${fileExtension}`
    const outputFilePath = join(outputDirectory, outputFileName)

    outputFilePaths.push(outputFilePath)

    // Assume 'ffmpeg' is available in the system's PATH
    const ffmpegArgs = [
      '-i',
      inputFilePath,
      '-ss',
      formatTime(startTime),
      '-t',
      formatTime(duration),
      // force overwrite
      '-y',
      '-c',
      'copy',
      // set ID3 metadata (https://gist.github.com/eyecatchup/0757b3d8b989fe433979db2ea7d95a01)
      '-metadata',
      `track=${currentTrack.trackNumber}`,
      '-metadata',
      `title=${currentTrack.trackName}`,
      '-metadata',
      `artist=${currentTrack.performer}`,
      '-metadata',
      `album=${title}`,
      '-metadata',
      `album_artist=${performer}`,
      outputFilePath,
    ]

    if (IS_DEBUG) {
      console.log(
        `Processing track ${currentTrack.trackNumber}: "${currentTrack.title}" (from ${formatTime(startTime)} for ${formatTime(duration)})`
      )
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs) // Use 'ffmpeg' directly

      ffmpegProcess.stdout.on('data', (data) => {
        console.log(`ffmpeg stdout: ${data}`) // Uncomment for verbose ffmpeg output
      })

      if (IS_DEBUG) {
        ffmpegProcess.stderr.on('data', (data) => {
          // ffmpeg often outputs progress to stderr, so it's useful for debugging
          console.error(
            `ffmpeg stderr for track ${currentTrack.trackNumber}: ${data.toString().trim()}`
          )
        })
      }

      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`Successfully created: ${outputFileName}`)
          resolvePromise()
        } else {
          const errorMessage = `ffmpeg process exited with code ${code} for ${outputFileName}. Check ffmpeg stderr for details.`
          console.error(errorMessage)
          rejectPromise(new Error(errorMessage))
        }
      })

      ffmpegProcess.on('error', (err) => {
        const errorMessage = `Failed to start ffmpeg process for ${outputFileName}. Is 'ffmpeg' installed and in your system's PATH? Error: ${err.message}`
        console.error(errorMessage)
        rejectPromise(new Error(errorMessage))
      })
    })
  }

  console.log('MP3 splitting complete!')
  return outputFilePaths
}

interface Track {
  timestamp: string
  artist: string
  title: string
}
interface Track {
  timestamp: string
  artist: string
  title: string
}

export function after(value: string, delimiter: string): string {
  value = value || ''

  if (value === '') {
    return value
  }

  const substrings = value.split(delimiter)

  return substrings.length === 1
    ? value // delimiter is not part of the string
    : substrings.slice(1).join(delimiter)
}

export function parseTracklist(tracklist: string): Track[] {
  return tracklist
    .trim()
    .split('\n')
    .map((line, index) => {
      const timestamp = line.split(' ').at(0) || '0:00'

      // get string after timestamp
      const withoutTimestamp = after(line, `${timestamp} `).replaceAll('\r', '')
      const title = after(withoutTimestamp, ' - ')
      const artist = withoutTimestamp.replace(` - ${title}`, '')
      return { timestamp: index === 0 ? '00:00' : timestamp, artist, title }
    })
}

export function timeToFrames(time: string): string {
  return time + ':00'
}

export function generateCueFileContent(
  tracks: Track[],
  albumTitle: string,
  filename: string
): string {
  let cueContent = `TITLE "${albumTitle}"\n`
  cueContent += `FILE "${filename}" MP3\n`

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]

    // track.title
    cueContent += `\tTRACK ${String(i + 1).padStart(2, '0')} AUDIO\n`
    cueContent += `\t\tTITLE "${track.title}"\n`
    cueContent += `\t\tPERFORMER "${track.artist}"\n`
    const indexTime = timeToFrames(track.timestamp)
    cueContent += `\t\tINDEX 01 ${indexTime}\n`
  }

  return cueContent.trimEnd() + '\n'
}

export async function convertTracklistToCue(
  inputFilePath: string,
  outputFilePath: string,
  albumTitle: string,
  audioFilename: string
): Promise<void> {
  try {
    const tracklistContent = await readFile(inputFilePath, 'utf-8')
    const tracks = parseTracklist(tracklistContent)
    const cueFileContent = generateCueFileContent(
      tracks,
      albumTitle,
      audioFilename
    )
    await writeFile(outputFilePath, cueFileContent, 'utf-8')
    console.log(`Successfully created CUE file at: ${outputFilePath}`)
  } catch (error) {
    console.error('Error processing files:', error)
  }
}
