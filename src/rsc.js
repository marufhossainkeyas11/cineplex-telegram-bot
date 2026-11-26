/**
 * Next.js App Router RSC payload parser for branch showtime pages.
 * Extracts `shows[]`, `halls[]`, and optional `venue` objects from
 * `self.__next_f.push([1, "..."])` script chunks without brittle regexes.
 */

function extractBalancedJson(source, startIndex) {
  const openChar = source[startIndex];
  const closeChar = openChar === "[" ? "]" : openChar === "{" ? "}" : null;
  if (!closeChar) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}

function extractAllRscPayloads(html) {
  if (!html || typeof html !== "string") return "";

  const chunks = [];
  const pushRegex = /self\.__next_f\.push\(\s*\[\s*\d+\s*,\s*("(?:\\.|[^"\\])*")\s*\]\s*\)/g;
  let match;
  while ((match = pushRegex.exec(html)) !== null) {
    try {
      const decoded = JSON.parse(match[1]);
      if (typeof decoded === "string") {
        chunks.push(decoded);
      }
    } catch {
      // Ignore malformed chunk
    }
  }

  return chunks.join("");
}

function findJsonValueByKey(stream, key, expectedOpenChar) {
  const results = [];
  const needle = `"${key}":`;
  let pos = 0;

  while (pos < stream.length) {
    const idx = stream.indexOf(needle, pos);
    if (idx === -1) break;

    let valueStart = idx + needle.length;
    while (valueStart < stream.length && /\s/.test(stream[valueStart])) {
      valueStart += 1;
    }

    if (!expectedOpenChar || stream[valueStart] === expectedOpenChar) {
      const rawJson = extractBalancedJson(stream, valueStart);
      if (rawJson) {
        try {
          results.push(JSON.parse(rawJson));
        } catch {
          // Ignore non-JSON reference tokens (e.g., "$L12")
        }
      }
    }
    pos = idx + needle.length;
  }

  return results;
}

function isLikelyShowObject(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.id === "string" &&
    typeof obj.movieId === "string" &&
    typeof obj.date === "string" &&
    typeof obj.time === "string"
  );
}

function isLikelyHallObject(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.id === "string" &&
    (obj.name !== undefined || obj.displayName !== undefined || obj.hallName !== undefined)
  );
}

export function parseBranchRscHtml(html) {
  const rscStream = extractAllRscPayloads(html);
  // Fallback to scanning raw HTML too in case payload is serialized inline
  const scanTarget = rscStream.length > 0 ? rscStream : String(html || "");

  let shows = [];
  let halls = [];
  let venue = null;

  // 1. Try parsing `"initial":{...}` first (canonical container)
  const initialObjects = findJsonValueByKey(scanTarget, "initial", "{");
  for (const init of initialObjects) {
    if (Array.isArray(init.shows) && init.shows.some(isLikelyShowObject)) {
      shows = init.shows.filter(isLikelyShowObject);
    }
    if (Array.isArray(init.halls) && init.halls.some(isLikelyHallObject)) {
      halls = init.halls.filter(isLikelyHallObject);
    }
    if (init.venue && typeof init.venue === "object") {
      venue = init.venue;
      if (
        halls.length === 0 &&
        Array.isArray(init.venue.halls) &&
        init.venue.halls.some(isLikelyHallObject)
      ) {
        halls = init.venue.halls.filter(isLikelyHallObject);
      }
    }
  }

  // 2. Direct fallback scan for `"shows":[...]` if not inside `"initial"`
  if (shows.length === 0) {
    const showArrays = findJsonValueByKey(scanTarget, "shows", "[");
    for (const arr of showArrays) {
      if (Array.isArray(arr) && arr.some(isLikelyShowObject)) {
        shows = arr.filter(isLikelyShowObject);
        break;
      }
    }
  }

  // 3. Direct fallback scan for `"halls":[...]`
  if (halls.length === 0) {
    const hallArrays = findJsonValueByKey(scanTarget, "halls", "[");
    for (const arr of hallArrays) {
      if (Array.isArray(arr) && arr.some(isLikelyHallObject)) {
        halls = arr.filter(isLikelyHallObject);
        break;
      }
    }
  }

  return { shows, halls, venue };
}
