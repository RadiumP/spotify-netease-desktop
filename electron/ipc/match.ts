import * as stringSimilarity from "string-similarity";
import { SpotifyTrack } from "../../shared/types";

export function normalizeTitle(title: string): string {
  return title
    .replace(/[\(（][^)）]*[\)）]/g, "")
    .replace(/\s*-\s*(remaster|live|remix|mono|stereo).*/i, "")
    .trim()
    .toLowerCase();
}

export function normalizeArtist(artist: string): string {
  return artist.trim().toLowerCase();
}

export function scoreCandidate(
  spotifyTrack: SpotifyTrack,
  candidateName: string,
  candidateArtists: string[]
): number {
  const titleScore = stringSimilarity.compareTwoStrings(
    normalizeTitle(spotifyTrack.name),
    normalizeTitle(candidateName)
  );

  const spotifyArtistsNorm = spotifyTrack.artists.map(normalizeArtist);
  const candidateArtistsNorm = candidateArtists.map(normalizeArtist);

  const artistHit = spotifyArtistsNorm.some((a) =>
    candidateArtistsNorm.some(
      (b) => b.includes(a) || a.includes(b) || stringSimilarity.compareTwoStrings(a, b) > 0.7
    )
  );

  return titleScore * 0.75 + (artistHit ? 0.25 : 0);
}

export const MATCH_THRESHOLD = 0.6;
