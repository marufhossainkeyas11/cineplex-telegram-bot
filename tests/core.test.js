import assert from "node:assert/strict";
import test from "node:test";
import {
  diffMovies,
  formatAlertNotification,
  formatLanguageWithSubtitle,
  formatMovieDetailCard,
  formatReleaseCountdown,
  getTrailerUrl,
  searchMovies,
} from "../src/core.js";

const sampleMeta = {
  genresMap: new Map([
    ["action", { slug: "action", name: { en: "Action", bn: "অ্যাকশন" } }],
    ["comedy", { slug: "comedy", name: { en: "Comedy", bn: "কমেডি" } }],
  ]),
  languagesMap: new Map([
    ["en", { code: "en", name: { en: "English", bn: "ইংরেজি" } }],
    ["bn", { code: "bn", name: { en: "Bangla", bn: "বাংলা" } }],
    ["hi", { code: "hi", name: { en: "Hindi", bn: "হিন্দি" } }],
  ]),
  languageDisplay: {
    subtitleNoteEnabled: true,
    subtitleNote: { en: "with English subtitles", bn: "(ইংরেজি সাবটাইটেলসহ)" },
    exemptLanguageCodes: ["bn", "en"],
  },
};

test("formatLanguageWithSubtitle applies language-display exempt rules", () => {
  const en = formatLanguageWithSubtitle(
    "en",
    sampleMeta.languagesMap,
    sampleMeta.languageDisplay,
    "en"
  );
  assert.equal(en, "English");

  const hiEn = formatLanguageWithSubtitle(
    "hi",
    sampleMeta.languagesMap,
    sampleMeta.languageDisplay,
    "en"
  );
  assert.equal(hiEn, "Hindi (with English subtitles)");

  const hiBn = formatLanguageWithSubtitle(
    "hi",
    sampleMeta.languagesMap,
    sampleMeta.languageDisplay,
    "bn"
  );
  assert.equal(hiBn, "হিন্দি (ইংরেজি সাবটাইটেলসহ)");
});

test("getTrailerUrl falls back to enrichment.trailerYoutubeId", () => {
  assert.equal(
    getTrailerUrl({
      trailerUrl: "https://www.youtube.com/watch?v=5HK3wimDxBI",
      enrichment: { trailerYoutubeId: "ignored" },
    }),
    "https://www.youtube.com/watch?v=5HK3wimDxBI"
  );

  assert.equal(
    getTrailerUrl({
      trailerUrl: "",
      enrichment: { trailerYoutubeId: "TcMBFSGVi1c" },
    }),
    "https://www.youtube.com/watch?v=TcMBFSGVi1c"
  );
});

test("diffMovies detects TICKET_RELEASED, RELEASE_DATE_CHANGED, NEW_FORMATS_ADDED, and NEW_UPCOMING", () => {
  const prev = new Map([
    [
      "k-pop-the-debut",
      {
        slug: "k-pop-the-debut",
        isNowShowing: false,
        isUpcoming: true,
        localReleaseDate: "2027-02-26",
        formats: ["2D"],
      },
    ],
    [
      "the-beekeeper-2",
      {
        slug: "the-beekeeper-2",
        isNowShowing: false,
        isUpcoming: true,
        localReleaseDate: "2027-01-15",
        formats: ["2D"],
      },
    ],
  ]);

  const curr = [
    {
      slug: "k-pop-the-debut",
      title: { en: "K-POP: The Debut", bn: "কে-পপ: দ্য ডেবিউ" },
      isNowShowing: true,
      isUpcoming: false,
      localReleaseDate: "2027-02-26",
      formats: ["2D", "3D"],
    },
    {
      slug: "the-beekeeper-2",
      title: { en: "The Beekeeper 2", bn: "দ্য বিকিপার ২" },
      isNowShowing: false,
      isUpcoming: true,
      localReleaseDate: "2027-01-22",
      formats: ["2D"],
    },
    {
      slug: "narnia-the-magicians-nephew",
      title: { en: "Narnia: The Magician's Nephew", bn: "নার্নিয়া" },
      isNowShowing: false,
      isUpcoming: true,
      localReleaseDate: "2027-02-12",
      formats: ["2D"],
    },
  ];

  const events = diffMovies(prev, curr);
  const types = events.map((e) => `${e.slug}:${e.type}`);

  assert.ok(types.includes("k-pop-the-debut:TICKET_RELEASED"));
  assert.ok(types.includes("k-pop-the-debut:NEW_FORMATS_ADDED"));
  assert.ok(types.includes("the-beekeeper-2:RELEASE_DATE_CHANGED"));
  assert.ok(types.includes("narnia-the-magicians-nephew:NEW_UPCOMING"));
});

test("formatMovieDetailCard never leaks internal API domain and shows brand name", () => {
  const movie = {
    slug: "avengers-endgame-encore",
    title: { en: "Avengers Endgame: Encore", bn: "অ্যাভেঞ্জার্স এন্ডগেম" },
    tagline: { en: "Avenge the fallen.", bn: "" },
    synopsis: { en: "Tony Stark sends a message.", bn: "টনি স্টার্ক..." },
    duration: 181,
    certificate: "U",
    language: "en",
    genres: ["action"],
    formats: ["2D", "IMAX"],
    isNowShowing: true,
    isUpcoming: false,
    localReleaseDate: "2026-11-20",
    enrichment: { voteAverage: 8.3 },
    cast: [
      {
        artistName: { en: "Robert Downey Jr.", bn: "রবার্ট ডাউনি জুনিয়র" },
        characterName: "Tony Stark",
      },
    ],
  };

  const card = formatMovieDetailCard(movie, sampleMeta, "bn", "STAR Cineplex");
  assert.ok(card.includes("STAR Cineplex"));
  assert.ok(card.includes("8.3/10"));
  assert.ok(card.includes("Tony Stark"));
  assert.ok(!card.toLowerCase().includes("kichole"));
});

test("searchMovies matches English, Bangla, and slug", () => {
  const movies = [
    {
      slug: "k-pop-the-debut",
      title: { en: "K-POP: The Debut", bn: "কে-পপ" },
    },
  ];
  assert.equal(searchMovies(movies, "debut").length, 1);
  assert.equal(searchMovies(movies, "কে-পপ").length, 1);
  assert.equal(searchMovies(movies, "unknown").length, 0);
});

test("formatReleaseCountdown and formatAlertNotification work cleanly", () => {
  const fixedNow = new Date("2027-02-25T10:00:00+06:00");
  assert.equal(formatReleaseCountdown("2027-02-26", "bn", fixedNow), "আগামীকাল রিলিজ!");
  const alertText = formatAlertNotification(
    {
      type: "TICKET_RELEASED",
      movie: { title: { en: "K-POP: The Debut", bn: "কে-পপ" }, formats: ["2D"] },
    },
    "bn",
    "STAR Cineplex"
  );
  assert.ok(alertText.includes("টিকিট ছেড়ে দিয়েছে!"));
  assert.ok(!alertText.toLowerCase().includes("kichole"));
});
