import assert from "node:assert/strict";
import test from "node:test";
import {
  diffMovies,
  evaluateZeroMissAlerts,
  formatAlertNotification,
  formatLanguageWithSubtitle,
  formatMovieDetailCard,
  formatReleaseCountdown,
  formatSeatBadge,
  formatShowPriceRange,
  formatShowtimesByBranch,
  formatTaka,
  formatTicketDropAlertWithShows,
  formatTime12h,
  getTrailerUrl,
  searchMovies,
} from "../src/core.js";
import { parseBranchRscHtml } from "../src/rsc.js";

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

test("parseBranchRscHtml extracts shows[] and halls[] from Next.js __next_f payload", () => {
  const rscPayload = JSON.stringify(
    '1a:["$","$L12",null,{"initial":{"venue":{"id":"v-bashundhara","name":"Bashundhara City"},"halls":[{"id":"h-01","name":"Hall 2 (VIP)"}],"shows":[{"id":"s-001","movieId":"m-001","venueId":"v-bashundhara","hallId":"h-01","date":"2026-11-26","time":"14:00","language":"en","format":"2D","status":"Selling","totalSeats":248,"availableSeats":235,"pricing":[{"category":"premium","price":40000}],"priceRange":{"minPaisa":40000,"maxPaisa":50000},"runtimeMinutes":95}]}}]\n'
  );
  const html = `<html><body><script>self.__next_f.push([1,${rscPayload}])</script></body></html>`;

  const parsed = parseBranchRscHtml(html);
  assert.equal(parsed.shows.length, 1);
  assert.equal(parsed.halls.length, 1);
  assert.equal(parsed.shows[0].id, "s-001");
  assert.equal(parsed.shows[0].availableSeats, 235);
  assert.equal(parsed.halls[0].name, "Hall 2 (VIP)");
});

test("paisa-to-Taka, 12h time, and seat badge formatting", () => {
  assert.equal(formatTaka(40000), "৳400");
  assert.equal(
    formatShowPriceRange({ priceRange: { minPaisa: 40000, maxPaisa: 50000 } }),
    "৳400–৳500"
  );
  assert.equal(formatTime12h("14:00"), "2:00 PM");
  assert.equal(formatTime12h("09:30"), "9:30 AM");
  assert.equal(formatSeatBadge(235, 248, "bn"), "🟢 235/248 সিট");
  assert.equal(formatSeatBadge(0, 248, "bn"), "🔴 হাউসফুল");
});

test("evaluateZeroMissAlerts fires immediately on live Selling shows even before catalog flips", () => {
  const movies = [
    {
      id: "m-001",
      slug: "k-pop-the-debut",
      title: { en: "K-POP: The Debut", bn: "কে-পপ" },
      isNowShowing: false, // Catalog hasn't flipped yet!
      isUpcoming: true,
      formats: ["2D"],
    },
  ];
  const shows = [
    {
      id: "s-001",
      movieId: "m-001",
      venueId: "v-bashundhara",
      hallId: "h-01",
      date: "2026-11-26",
      time: "14:00",
      format: "2D",
      status: "Selling",
      totalSeats: 248,
      availableSeats: 235,
      priceRange: { minPaisa: 40000, maxPaisa: 50000 },
    },
  ];

  const alerts = [
    {
      chatId: "101",
      slug: "k-pop-the-debut",
      movieId: "m-001",
      targetVenueId: "v-bashundhara",
      targetVenueName: "Bashundhara City",
      alertMode: "ticket_drop",
      notifiedShowIds: [],
      ticketNotified: false,
      lang: "bn",
    },
    {
      chatId: "202",
      slug: "k-pop-the-debut",
      movieId: "m-001",
      targetVenueId: "v-sks-tower", // Different branch! Should NOT fire
      targetVenueName: "SKS Tower",
      alertMode: "ticket_drop",
      notifiedShowIds: [],
      ticketNotified: false,
      lang: "bn",
    },
    {
      chatId: "303",
      slug: "k-pop-the-debut",
      movieId: "m-001",
      targetVenueId: null, // All branches! MUST fire
      targetVenueName: "",
      alertMode: "new_shows",
      notifiedShowIds: [],
      ticketNotified: false,
      lang: "en",
    },
  ];

  const dispatches = evaluateZeroMissAlerts({
    alerts,
    currentMovies: movies,
    currentShows: shows,
    prevSnapshotsMap: new Map(),
  });

  const alertedUsers = dispatches.map((d) => d.alert.chatId);
  assert.deepEqual(alertedUsers, ["101", "303"]);
  assert.equal(dispatches[0].shouldRemoveAfterSend, true);
  assert.equal(dispatches[1].shouldRemoveAfterSend, false); // continuous new_shows mode

  // Verify rich alert text contains branch, hall, price in Taka, and NEVER leaks kichole
  const venuesMap = new Map([["v-bashundhara", { id: "v-bashundhara", name: "Bashundhara City" }]]);
  const hallsMap = new Map([["h-01", { id: "h-01", name: "Hall 2 (VIP)" }]]);
  const msg = formatTicketDropAlertWithShows(
    dispatches[0],
    venuesMap,
    hallsMap,
    "bn",
    "STAR Cineplex"
  );
  assert.ok(msg.includes("Bashundhara City"));
  assert.ok(msg.includes("Hall 2 (VIP)"));
  assert.ok(msg.includes("৳400–৳500"));
  assert.ok(msg.includes("2:00 PM"));
  assert.ok(!msg.toLowerCase().includes("kichole"));
});

test("evaluateZeroMissAlerts does not double-send already notified shows, but fires on new weekend shows", () => {
  const movies = [{ id: "m-001", slug: "test-movie", title: { en: "Test" }, isNowShowing: true, isUpcoming: false }];
  const shows = [
    { id: "s-001", movieId: "m-001", venueId: "v-1", date: "2026-11-26", time: "14:00", status: "Selling", totalSeats: 100, availableSeats: 50 },
    { id: "s-002", movieId: "m-001", venueId: "v-1", date: "2026-11-27", time: "19:00", status: "Selling", totalSeats: 100, availableSeats: 95 },
  ];

  const dispatches = evaluateZeroMissAlerts({
    alerts: [
      {
        chatId: "303",
        slug: "test-movie",
        movieId: "m-001",
        targetVenueId: "v-1",
        alertMode: "new_shows",
        notifiedShowIds: ["s-001"],
        ticketNotified: true,
        lang: "bn",
      },
    ],
    currentMovies: movies,
    currentShows: shows,
    prevSnapshotsMap: new Map(),
  });

  assert.equal(dispatches.length, 1);
  assert.deepEqual(dispatches[0].newShowIds, ["s-002"]);
});

test("formatShowtimesByBranch renders hall name, price, and seats cleanly", () => {
  const movie = { id: "m-001", title: { en: "Avengers", bn: "অ্যাভেঞ্জার্স" } };
  const venue = { id: "v-1", name: "Bashundhara City" };
  const hallsMap = new Map([["h-1", { id: "h-1", name: "Hall 1" }]]);
  const text = formatShowtimesByBranch(
    movie,
    venue,
    [
      {
        id: "s-1",
        movieId: "m-001",
        hallId: "h-1",
        date: "2026-11-26",
        time: "14:00",
        format: "2D",
        totalSeats: 248,
        availableSeats: 235,
        priceRange: { minPaisa: 40000, maxPaisa: 50000 },
      },
    ],
    hallsMap,
    "bn",
    "STAR Cineplex"
  );
  assert.ok(text.includes("Hall 1"));
  assert.ok(text.includes("৳400–৳500"));
  assert.ok(text.includes("235/248"));
});

test("formatLanguageWithSubtitle, getTrailerUrl, diffMovies, searchMovies, and countdown", () => {
  assert.equal(
    formatLanguageWithSubtitle("hi", sampleMeta.languagesMap, sampleMeta.languageDisplay, "en"),
    "Hindi (with English subtitles)"
  );
  assert.equal(
    getTrailerUrl({ trailerUrl: "", enrichment: { trailerYoutubeId: "TcMBFSGVi1c" } }),
    "https://www.youtube.com/watch?v=TcMBFSGVi1c"
  );
  assert.equal(
    searchMovies([{ slug: "k-pop-the-debut", title: { en: "K-POP", bn: "কে-পপ" } }], "কে-পপ").length,
    1
  );
  assert.equal(
    formatReleaseCountdown("2027-02-26", "bn", new Date("2027-02-25T10:00:00+06:00")),
    "আগামীকাল রিলিজ!"
  );
  const events = diffMovies(
    new Map([["m1", { slug: "m1", isNowShowing: false, isUpcoming: true, localReleaseDate: "2027-01-10", formats: ["2D"] }]]),
    [{ slug: "m1", title: { en: "M1" }, isNowShowing: true, isUpcoming: false, localReleaseDate: "2027-01-10", formats: ["2D", "IMAX"] }]
  );
  assert.ok(events.some((e) => e.type === "TICKET_RELEASED"));
  assert.ok(events.some((e) => e.type === "NEW_FORMATS_ADDED"));
  assert.ok(formatAlertNotification(events[0], "bn", "STAR Cineplex").includes("টিকিট ছেড়ে দিয়েছে!"));
  assert.ok(
    !formatMovieDetailCard(
      { slug: "x", title: { en: "X" }, isNowShowing: true, formats: ["2D"] },
      sampleMeta,
      "bn",
      "STAR Cineplex"
    )
      .toLowerCase()
      .includes("kichole")
  );
});
