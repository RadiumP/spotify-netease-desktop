"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MATCH_THRESHOLD = void 0;
exports.normalizeTitle = normalizeTitle;
exports.normalizeArtist = normalizeArtist;
exports.scoreCandidate = scoreCandidate;
const stringSimilarity = __importStar(require("string-similarity"));
function normalizeTitle(title) {
    return title
        .replace(/[\(（][^)）]*[\)）]/g, "")
        .replace(/\s*-\s*(remaster|live|remix|mono|stereo).*/i, "")
        .trim()
        .toLowerCase();
}
function normalizeArtist(artist) {
    return artist.trim().toLowerCase();
}
function scoreCandidate(spotifyTrack, candidateName, candidateArtists) {
    const titleScore = stringSimilarity.compareTwoStrings(normalizeTitle(spotifyTrack.name), normalizeTitle(candidateName));
    const spotifyArtistsNorm = spotifyTrack.artists.map(normalizeArtist);
    const candidateArtistsNorm = candidateArtists.map(normalizeArtist);
    const artistHit = spotifyArtistsNorm.some((a) => candidateArtistsNorm.some((b) => b.includes(a) || a.includes(b) || stringSimilarity.compareTwoStrings(a, b) > 0.7));
    return titleScore * 0.75 + (artistHit ? 0.25 : 0);
}
exports.MATCH_THRESHOLD = 0.6;
